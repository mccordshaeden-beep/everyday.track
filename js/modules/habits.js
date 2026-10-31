// habits.js — habits to build and habits to quit, grouped into morning / afternoon /
// evening routines, shown as tap-to-log rings.
//
// Each day's count is its own record ("hl:<habit>:<date>"), so two devices logging on
// different days never overwrite each other. Also here: schedules (every day, certain
// days, or N times a week), history heatmaps & stats, per-habit reminders (see
// reminders.js), a daily mood & energy check-in with simple insights, milestones,
// streak freezes and badges.
import * as store from '../store.js';
import {
  h, pageHead, card, empty, addBtn, btn, iconBtn, icon, openForm, openSheet, dayNav, toast,
  ymd, addDays, addMonths, parseYmd, fmtDay, relDay, fmtTime,
} from '../ui.js';

export const id = 'habits';
export const title = 'Habits';
export const glyph = 'habits';

const COL = 'habits';      // { name, emoji, color, kind: 'build'|'quit', goal, unit, schedule: 'daily'|'days'|'weekly', days: [0-6], perWeek,
                           //   routine: 'morning'|'afternoon'|'evening'|'anytime', remind: 'HH:MM', startDate, order, milestones: { n: date } }
const LOGS = 'habitlogs';  // { habitId, date, count, frozen }
const MOOD = 'mood';       // id "mood:<date>" → { date, mood 1–5, energy 1–5, note }
const STATS_ID = 'settings:habitstats'; // { unlocked: {badge: date}, perfectDays: [dates], routines }

const COLORS = ['green', 'blue', 'purple', 'orange', 'pink', 'teal', 'red', 'yellow'];
const ROUTINES = [['morning', '🌅 Morning'], ['afternoon', '☀️ Afternoon'], ['evening', '🌙 Evening'], ['anytime', '✨ Anytime']];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const ENERGY = ['😴', '🥱', '🙂', '💪', '⚡'];
const MILESTONES = [3, 7, 14, 21, 30, 50, 66, 100, 200, 365];
const FREEZES_PER_MONTH = 2;

const STARTERS = [
  { emoji: '💧', name: 'Water', goal: 8, unit: 'glasses', routine: 'anytime', color: 'blue' },
  { emoji: '💊', name: 'Vitamins', goal: 1, routine: 'morning', color: 'orange', remind: '08:00' },
  { emoji: '🛏️', name: 'Make the bed', goal: 1, routine: 'morning', color: 'purple' },
  { emoji: '🧘', name: 'Stretch or meditate', goal: 1, unit: '', routine: 'morning', color: 'teal' },
  { emoji: '🏃', name: 'Workout', goal: 1, routine: 'afternoon', color: 'red', schedule: 'weekly', perWeek: 3 },
  { emoji: '📚', name: 'Study', goal: 2, unit: 'hours', routine: 'afternoon', color: 'green', schedule: 'days', days: [1, 2, 3, 4, 5] },
  { emoji: '😴', name: 'Sleep 8 hours', goal: 8, unit: 'hours', routine: 'evening', color: 'purple' },
  { emoji: '📖', name: 'Read', goal: 1, routine: 'evening', color: 'yellow' },
  { emoji: '🦷', name: 'Floss', goal: 1, routine: 'evening', color: 'teal' },
];
const QUIT_STARTERS = [
  { emoji: '📵', name: 'Doomscrolling', color: 'pink' },
  { emoji: '🥤', name: 'Soda', color: 'red' },
  { emoji: '🍟', name: 'Junk food', color: 'orange' },
  { emoji: '🚭', name: 'Vaping / smoking', color: 'gray' },
  { emoji: '💅', name: 'Nail biting', color: 'purple' },
];

let day = ymd();
let rr = () => {};

// ---- data helpers -------------------------------------------------------------------------
export const habits = () => store.list(COL).filter(x => !x.archived)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created || '').localeCompare(b.created || ''));
const logId = (hid, d) => `hl:${hid}:${d}`;
const logOf = (hid, d) => store.get(logId(hid, d));
export const count = (hid, d) => Number(logOf(hid, d)?.count) || 0;
const frozen = (hid, d) => !!logOf(hid, d)?.frozen;
const setCount = (hid, d, n) => store.save(LOGS, { habitId: hid, date: d, count: Math.max(0, n), frozen: false }, logId(hid, d));

export const isQuit = hb => hb.kind === 'quit';
const goalOf = hb => Math.max(1, Number(hb.goal) || 1);
const startOf = hb => hb.startDate || (hb.created || ymd()).slice(0, 10);
const colorOf = hb => hb.color || COLORS[(hb.order ?? 0) % COLORS.length];
const weekStart = d => addDays(d, -((parseYmd(d).getDay() + 6) % 7));

/** Is this habit planned for date d? (weekly-goal habits can be done any day) */
export function scheduled(hb, d) {
  if (d < startOf(hb)) return false;
  if (hb.schedule === 'days') return (hb.days || []).includes(parseYmd(d).getDay());
  return true;
}
/** Did you hit it on date d? (for a habit to quit: no slips that day) */
export function met(hb, d) {
  return isQuit(hb) ? d >= startOf(hb) && d <= ymd() && count(hb.id, d) === 0 : count(hb.id, d) >= goalOf(hb);
}
const okDay = (hb, d) => met(hb, d) || frozen(hb.id, d);
export function weekDone(hb, ws, upto = ymd()) {
  let n = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d <= upto && okDay(hb, d)) n++; }
  return n;
}
const perWeek = hb => Math.max(1, Number(hb.perWeek) || 3);
const unitOf = hb => (hb.schedule === 'weekly' && !isQuit(hb) ? 'week' : 'day');

/** Current streak (days, or weeks for "N times a week" habits). Today doesn't break it until it's over. */
export function streak(hb, today = ymd()) {
  if (isQuit(hb)) {
    let d = today, n = 0;
    while (n < 5000 && d >= startOf(hb) && okDay(hb, d)) { n++; d = addDays(d, -1); }
    return n;
  }
  if (hb.schedule === 'weekly') {
    let ws = weekStart(today), n = 0;
    if (weekDone(hb, ws) < perWeek(hb)) ws = addDays(ws, -7);
    while (n < 1000 && ws >= weekStart(startOf(hb)) && weekDone(hb, ws) >= perWeek(hb)) { n++; ws = addDays(ws, -7); }
    return n;
  }
  let d = today, n = 0, guard = 0;
  if (!okDay(hb, d)) d = addDays(d, -1);
  while (guard++ < 3000 && d >= startOf(hb)) {
    if (!scheduled(hb, d)) { d = addDays(d, -1); continue; }
    if (!okDay(hb, d)) break;
    n++; d = addDays(d, -1);
  }
  return n;
}

function bestStreak(hb) {
  const today = ymd();
  let best = 0, run = 0;
  if (hb.schedule === 'weekly' && !isQuit(hb)) {
    for (let ws = weekStart(startOf(hb)); ws <= weekStart(today); ws = addDays(ws, 7)) {
      if (weekDone(hb, ws) >= perWeek(hb)) best = Math.max(best, ++run); else if (ws !== weekStart(today)) run = 0;
    }
    return best;
  }
  for (let d = startOf(hb), g = 0; d <= today && g < 4000; d = addDays(d, 1), g++) {
    if (!isQuit(hb) && !scheduled(hb, d)) continue;
    if (okDay(hb, d)) best = Math.max(best, ++run); else if (d !== today) run = 0;
  }
  return best;
}

/** % of planned days (or weeks) hit in the last 30 days. */
function successRate(hb) {
  const today = ymd();
  const from = startOf(hb) > addDays(today, -29) ? startOf(hb) : addDays(today, -29);
  if (hb.schedule === 'weekly' && !isQuit(hb)) {
    let total = 0, ok = 0;
    for (let ws = weekStart(from); ws <= weekStart(today); ws = addDays(ws, 7)) {
      const hit = weekDone(hb, ws) >= perWeek(hb);
      if (ws === weekStart(today) && !hit) continue;
      total++; if (hit) ok++;
    }
    return total ? Math.round((ok / total) * 100) : null;
  }
  let total = 0, ok = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    if (!isQuit(hb) && !scheduled(hb, d)) continue;
    if (d === today && !okDay(hb, d)) continue;
    total++; if (okDay(hb, d)) ok++;
  }
  return total ? Math.round((ok / total) * 100) : null;
}

const totalLogged = hb => store.list(LOGS).filter(l => l.habitId === hb.id && (isQuit(hb) ? false : Number(l.count) >= goalOf(hb))).length;
const freezesUsedThisMonth = () => store.list(LOGS).filter(l => l.frozen && l.date?.startsWith(ymd().slice(0, 7))).length;

// ---- logging, milestones, badges ---------------------------------------------------------------
function log(hb, d, n) {
  const before = streak(hb);
  setCount(hb.id, d, n);
  if (d !== ymd()) return;
  const after = streak(hb);
  if (after > before && MILESTONES.includes(after) && !(hb.milestones || {})[after]) {
    store.save(COL, { milestones: { ...(hb.milestones || {}), [after]: ymd() } }, hb.id);
    celebrate();
    toast(`🎉 ${after}-${unitOf(hb)} streak: ${hb.emoji || ''} ${hb.name}!`);
  } else if (!isQuit(hb) && n === goalOf(hb)) {
    toast(`${hb.emoji || '✓'} ${hb.name} done${after > 1 ? ` · 🔥 ${after} ${unitOf(hb)}s` : ''}`);
  }
  recordPerfectDay();
  checkBadges();
}

const stats = () => store.get(STATS_ID) || {};
function recordPerfectDay() {
  const today = ymd();
  const due = habits().filter(hb => !isQuit(hb) && hb.schedule !== 'weekly' && scheduled(hb, today));
  if (!due.length || !due.every(hb => met(hb, today))) return;
  const st = stats();
  if ((st.perfectDays || []).includes(today)) return;
  store.save('settings', { perfectDays: [...(st.perfectDays || []), today].slice(-400) }, STATS_ID);
  setTimeout(() => { celebrate(); toast('🌟 Perfect day: every habit done!'); }, 600);
}
const anyBest = (min, filter = () => true) => habits().filter(filter).some(hb => unitOf(hb) === 'day' && bestStreak(hb) >= min);
const BADGES = [
  { id: 'first', emoji: '🌱', name: 'First step', how: 'Log any habit', test: () => store.list(LOGS).some(l => Number(l.count) > 0) },
  { id: 's7', emoji: '🔥', name: 'Week strong', how: 'Get a 7-day streak', test: () => anyBest(7, hb => !isQuit(hb)) },
  { id: 's30', emoji: '🌟', name: 'Month strong', how: 'Get a 30-day streak', test: () => anyBest(30, hb => !isQuit(hb)) },
  { id: 's100', emoji: '💎', name: 'Century', how: 'Get a 100-day streak', test: () => anyBest(100, hb => !isQuit(hb)) },
  { id: 'perfect', emoji: '✨', name: 'Perfect day', how: 'Finish every habit planned for a day', test: () => (stats().perfectDays || []).length >= 1 },
  { id: 'perfect7', emoji: '🏆', name: 'Perfect 7', how: 'Have 7 perfect days', test: () => (stats().perfectDays || []).length >= 7 },
  { id: 'quit30', emoji: '🛡️', name: 'Clean 30', how: '30 days clean on a habit you\'re quitting', test: () => habits().some(hb => isQuit(hb) && bestStreak(hb) >= 30) },
  { id: 'mood7', emoji: '💭', name: 'Check-in', how: 'Log your mood 7 days', test: () => store.list(MOOD).length >= 7 },
  { id: 'routine5', emoji: '🎯', name: 'Routine pro', how: 'Finish a routine 5 times', test: () => (stats().routines || 0) >= 5 },
];
function checkBadges() {
  const st = stats();
  const unlocked = { ...(st.unlocked || {}) };
  const fresh = BADGES.filter(b => !unlocked[b.id] && b.test());
  if (!fresh.length) return;
  for (const b of fresh) unlocked[b.id] = ymd();
  store.save('settings', { unlocked }, STATS_ID);
  setTimeout(() => { celebrate(); toast(`🏅 New badge: ${fresh.map(b => `${b.emoji} ${b.name}`).join(', ')}`); }, 1200);
}

function celebrate() {
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  const bits = ['🎉', '⭐', '🔥', '✨', '💪', '🌟'];
  for (let i = 0; i < 26; i++) layer.append(h('span', { style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 0.4 + 's', fontSize: 16 + Math.random() * 16 + 'px' } }, bits[i % bits.length]));
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

// ---- editing -----------------------------------------------------------------------------------
function editHabit(hb, defaults = {}) {
  const quit = (hb?.kind || defaults.kind) === 'quit';
  openForm({
    title: hb ? hb.name : quit ? 'Habit to quit' : 'New habit',
    values: hb ? { ...hb, schedule: hb.schedule || 'daily', routine: hb.routine || 'anytime', color: colorOf(hb), perWeek: hb.perWeek || 3, kind: hb.kind || 'build' }
      : { goal: 1, emoji: quit ? '🚫' : '✅', schedule: 'daily', routine: 'anytime', color: COLORS[habits().length % COLORS.length], perWeek: 3, kind: 'build', startDate: ymd(), ...defaults },
    fields: [
      { name: 'name', label: quit ? 'What are you quitting?' : 'Habit', required: true, autofocus: true, placeholder: quit ? 'Soda, vaping, doomscrolling…' : 'Water, stretch, read…' },
      { name: 'emoji', label: 'Emoji', placeholder: '💧' },
      { name: 'kind', label: 'Type', type: 'select', options: [['build', '✅ Build it (do it)'], ['quit', '🚫 Quit it (avoid it)']] },
      { name: 'color', label: 'Color', type: 'select', options: COLORS.map(c => [c, c[0].toUpperCase() + c.slice(1)]) },
      ...(quit ? [{ name: 'startDate', label: 'Quit date', type: 'date', hint: 'Days clean are counted from here.' }] : [
        { name: 'goal', label: 'Daily goal', type: 'number', min: '1', step: '1', inputmode: 'numeric', hint: 'How many times / how much each day (1 = just do it)' },
        { name: 'unit', label: 'Unit (optional)', placeholder: 'glasses, hours, pages…' },
        { name: 'schedule', label: 'How often', type: 'select', options: [['daily', 'Every day'], ['days', 'Certain days'], ['weekly', 'A number of times a week']] },
        { name: 'days', label: 'Which days? (if "certain days")', type: 'weekdays' },
        { name: 'perWeek', label: 'Times a week? (if "a number of times")', type: 'number', min: '1', max: '7', step: '1', inputmode: 'numeric' },
        { name: 'routine', label: 'Part of which routine?', type: 'select', options: ROUTINES },
        { name: 'remind', label: 'Remind me at (optional)', type: 'time', hint: 'Needs Settings → Reminders turned on for this device.' },
      ]),
    ],
    onSubmit: v => {
      if (v.kind === 'quit' && !quit && !hb) { editHabit(null, { ...v, kind: 'quit' }); return; }
      const fields = { ...v, goal: Number(v.goal) || 1, perWeek: Number(v.perWeek) || 3 };
      if (fields.schedule === 'days' && !(fields.days || []).length) { toast('Pick at least one day'); return false; }
      store.save(COL, hb ? fields : { ...fields, order: habits().length }, hb?.id);
    },
    onDelete: hb ? () => store.remove(hb.id) : null,
  });
}

// ---- rings ---------------------------------------------------------------------------------------
function ringSvg(frac, size = 64) {
  const r = 27, C = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'hring');
  svg.innerHTML = `<circle cx="32" cy="32" r="${r}" class="hring-bg"/><circle cx="32" cy="32" r="${r}" class="hring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, frac))}"/>`;
  return svg;
}

function subText(hb, d) {
  const n = count(hb.id, d);
  if (isQuit(hb)) {
    const s = streak(hb);
    return n ? `${n} slip${n > 1 ? 's' : ''} today` : `${s} day${s === 1 ? '' : 's'} clean`;
  }
  const g = goalOf(hb);
  const main = g > 1 ? `${n}/${g}${hb.unit ? ' ' + hb.unit : ''}` : n >= 1 ? 'Done' : hb.unit || 'Tap to do';
  if (hb.schedule === 'weekly') return `${main} · ${weekDone(hb, weekStart(d), d)}/${perWeek(hb)} this week`;
  return main;
}

function tap(hb, d) {
  const n = count(hb.id, d);
  if (isQuit(hb)) {
    if (confirm(`Log a slip for "${hb.name}"? It resets your clean streak, and that's OK. Tomorrow's a new day.`)) log(hb, d, n + 1);
    return;
  }
  const g = goalOf(hb);
  if (g === 1) log(hb, d, n >= 1 ? 0 : 1);
  else log(hb, d, n + 1);
}

function tile(hb, d) {
  const n = count(hb.id, d);
  const g = goalOf(hb);
  const quit = isQuit(hb);
  const done = met(hb, d);
  const restDay = !quit && !scheduled(hb, d);
  const s = streak(hb);
  const frac = quit ? (n ? 0 : 1) : n / g;
  const el = h('div', { class: `htile hc-${colorOf(hb)}${done ? ' done' : ''}${restDay ? ' rest' : ''}${quit ? ' quit' : ''}` },
    h('button', { type: 'button', class: 'hring-btn', 'aria-label': quit ? `Log a slip for ${hb.name}` : `Log ${hb.name}`, onclick: e => {
      tap(hb, d);
      e.currentTarget.closest('.htile')?.classList.add('pop');
    } }, ringSvg(frac), h('span', { class: 'hring-emoji' }, hb.emoji || '•'),
      done && !quit ? h('span', { class: 'hring-check' }, '✓') : null),
    h('button', { type: 'button', class: 'htile-name', onclick: () => details(hb) }, hb.name),
    h('span', { class: 'htile-sub' }, restDay ? 'Rest day' : subText(hb, d)),
    s > 1 && !quit ? h('span', { class: 'htile-streak' }, `🔥 ${s}${unitOf(hb) === 'week' ? 'w' : ''}`) : null,
    n > 0 && !quit && g > 1 ? h('button', { type: 'button', class: 'htile-minus', 'aria-label': `One less ${hb.name}`, onclick: () => log(hb, d, n - 1) }, '−') : null);
  return el;
}

/** Compact row for the Today screen. */
export function habitRow(hb, d) {
  const n = count(hb.id, d), g = goalOf(hb);
  const quit = isQuit(hb);
  return h('div', { class: `row habit-row hc-${colorOf(hb)}${met(hb, d) && !quit ? ' met' : ''}` },
    h('button', { type: 'button', class: 'mini-ring', 'aria-label': `Log ${hb.name}`, onclick: () => tap(hb, d) },
      ringSvg(quit ? (n ? 0 : 1) : n / g, 40), h('span', {}, hb.emoji || '•')),
    h('div', { class: 'row-main', onclick: () => details(hb) },
      h('div', { class: 'row-title' }, hb.name),
      h('div', { class: 'row-sub' }, subText(hb, d), !quit && streak(hb) > 1 ? ` · 🔥 ${streak(hb)}` : '')),
    !quit && g > 1 ? h('div', { class: 'stepper' },
      iconBtn('minus', () => log(hb, d, n - 1), `Less ${hb.name}`),
      iconBtn('plus', () => log(hb, d, n + 1), `More ${hb.name}`)) : null);
}

// ---- details: stats + history heatmap --------------------------------------------------------------
function details(hb) {
  let month = ymd().slice(0, 7);
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const s = streak(hb), best = bestStreak(hb), rate = successRate(hb);
    const u = unitOf(hb);
    const first = parseYmd(month + '-01');
    const gridStart = addDays(month + '-01', -((first.getDay() + 6) % 7));
    const today = ymd();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const inMonth = d.slice(0, 7) === month;
      const n = count(hb.id, d);
      const lvl = d > today || d < startOf(hb) ? 'none'
        : frozen(hb.id, d) ? 'frozen'
        : isQuit(hb) ? (n ? 'slip' : 'full')
        : !scheduled(hb, d) && hb.schedule === 'days' ? 'rest'
        : n >= goalOf(hb) ? 'full' : n > 0 ? 'part' : d === today ? 'none' : 'miss';
      cells.push(h('button', {
        type: 'button', class: `hm-cell lvl-${lvl}${inMonth ? '' : ' out'}${d === today ? ' today' : ''}`, disabled: d > today,
        'aria-label': `${fmtDay(d, { month: 'long', day: 'numeric' })}: ${lvl}`,
        onclick: () => dayMenu(hb, d, draw),
      }, Number(d.slice(8))));
    }
    body.replaceChildren(...[
      h('div', { class: `habit-hero hc-${colorOf(hb)}` },
        h('span', { class: 'habit-hero-emoji' }, hb.emoji || '•'),
        h('div', {}, h('b', {}, isQuit(hb) ? 'Quitting' : scheduleText(hb)), h('div', { class: 'muted small' }, isQuit(hb) ? `Since ${fmtDay(startOf(hb), { month: 'short', day: 'numeric', year: 'numeric' })}` : `${ROUTINES.find(r => r[0] === (hb.routine || 'anytime'))[1]}${hb.remind ? ` · ⏰ ${fmtTime(hb.remind)}` : ''}`))),
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' }, h('b', {}, `${s}`), h('span', {}, isQuit(hb) ? 'days clean' : `${u} streak`)),
        h('div', { class: 'stat' }, h('b', {}, `${best}`), h('span', {}, `best ${isQuit(hb) ? 'run' : 'streak'}`)),
        h('div', { class: 'stat' }, h('b', {}, rate == null ? '—' : `${rate}%`), h('span', {}, 'last 30 days'))),
      h('div', { class: 'hm-head' },
        iconBtn('left', () => { month = addMonths(month + '-01', -1).slice(0, 7); draw(); }, 'Previous month'),
        h('b', {}, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        iconBtn('right', () => { if (month < ymd().slice(0, 7)) { month = addMonths(month + '-01', 1).slice(0, 7); draw(); } }, 'Next month')),
      h('div', { class: `heatmap hc-${colorOf(hb)}` }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => h('span', { class: 'hm-dow' }, x)), cells),
      h('p', { class: 'hint' }, isQuit(hb) ? 'Green = clean day, red = slip. Tap a day to change it.' : `Tap a day to change it. 🧊 Missed a day? Use a streak freeze (${FREEZES_PER_MONTH - freezesUsedThisMonth()} left this month).`),
      Object.keys(hb.milestones || {}).length ? h('div', { class: 'chip-row' }, Object.keys(hb.milestones).map(Number).sort((a, b) => a - b).map(m => h('span', { class: 'tag ok-tag' }, `🏁 ${m} ${unitOf(hb)}s`))) : null,
      !isQuit(hb) ? h('p', { class: 'muted small' }, `Completed ${totalLogged(hb)} time${totalLogged(hb) === 1 ? '' : 's'} in total.`) : null,
    ].filter(Boolean));
  };
  draw();
  openSheet({ title: hb.name, body: [body], actions: [{ label: 'Edit habit', onClick: () => editHabit(hb) }, { label: 'Close', cls: 'primary' }] });
}

function dayMenu(hb, d, redraw) {
  const n = count(hb.id, d);
  const fields = isQuit(hb)
    ? [{ name: 'count', label: `Slips on ${fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}`, type: 'number', min: '0', step: '1', inputmode: 'numeric' }]
    : [{ name: 'count', label: `${fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}: how many${hb.unit ? ' ' + hb.unit : ''}? (goal ${goalOf(hb)})`, type: 'number', min: '0', step: '1', inputmode: 'numeric' }];
  const canFreeze = !isQuit(hb) && d < ymd() && n < goalOf(hb) && !frozen(hb.id, d) && freezesUsedThisMonth() < FREEZES_PER_MONTH;
  if (canFreeze) fields.push({ name: 'freeze', label: `🧊 Use a streak freeze for this day (${FREEZES_PER_MONTH - freezesUsedThisMonth()} left this month)`, type: 'checkbox' });
  openForm({
    title: hb.name,
    values: { count: n, freeze: false },
    fields,
    onSubmit: v => {
      if (v.freeze) { store.save(LOGS, { habitId: hb.id, date: d, count: Number(v.count) || 0, frozen: true }, logId(hb.id, d)); toast('🧊 Streak protected'); }
      else log(hb, d, Number(v.count) || 0);
      setTimeout(redraw, 50);
    },
  });
}

function scheduleText(hb) {
  if (hb.schedule === 'weekly') return `${perWeek(hb)}× a week`;
  if (hb.schedule === 'days') {
    const ds = hb.days || [];
    if (ds.length === 5 && [1, 2, 3, 4, 5].every(x => ds.includes(x))) return 'Weekdays';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((_, i) => ds.includes(i)).join(', ');
  }
  return 'Every day';
}

// ---- routines ------------------------------------------------------------------------------------
function startRoutine(key, list) {
  const todo = list.filter(hb => !met(hb, day));
  if (!todo.length) { toast('Already done ✓'); return; }
  let i = 0;
  const body = h('div', { class: 'routine' });
  let dlg;
  const finish = () => {
    dlg?.close();
    if (list.every(hb => met(hb, day))) {
      store.save('settings', { routines: (stats().routines || 0) + 1 }, STATS_ID);
      celebrate();
      toast(`${ROUTINES.find(r => r[0] === key)[1]} routine complete!`);
      checkBadges();
    }
  };
  const show = () => {
    if (i >= todo.length) return finish();
    const hb = todo[i];
    body.replaceChildren(
      h('div', { class: 'routine-dots' }, todo.map((_, j) => h('span', { class: j < i ? 'on' : j === i ? 'cur' : '' }))),
      h('div', { class: `routine-card hc-${colorOf(hb)}` },
        h('div', { class: 'routine-emoji' }, hb.emoji || '•'),
        h('h3', {}, hb.name),
        h('p', { class: 'muted' }, goalOf(hb) > 1 ? `Goal: ${goalOf(hb)}${hb.unit ? ' ' + hb.unit : ''}` : hb.unit || '')),
      h('div', { class: 'btn-row routine-btns' },
        btn('Skip', () => { i++; show(); }, 'ghost'),
        btn(goalOf(hb) > 1 ? `Done (${goalOf(hb)})` : 'Done ✓', () => { log(hb, day, goalOf(hb)); i++; show(); }, 'primary')));
  };
  show();
  dlg = openSheet({ title: `${ROUTINES.find(r => r[0] === key)[1]} routine`, body: [body] });
}

// ---- mood & energy ---------------------------------------------------------------------------------
const moodOf = d => store.get(`mood:${d}`);
function moodCard() {
  const m = moodOf(day) || {};
  const pick = (key, v) => store.save(MOOD, { date: day, [key]: v }, `mood:${day}`);
  const row = (label, key, set) => h('div', { class: 'mood-row' },
    h('span', { class: 'mood-label' }, label),
    h('div', { class: 'mood-btns' }, set.map((e, i) => h('button', {
      type: 'button', class: 'mood-btn' + (m[key] === i + 1 ? ' on' : ''), 'aria-label': `${label} ${i + 1} of 5`, 'aria-pressed': String(m[key] === i + 1),
      onclick: () => { pick(key, i + 1); checkBadges(); },
    }, e))));
  // last 14 days strip
  const strip = h('div', { class: 'mood-strip' }, Array.from({ length: 14 }, (_, k) => {
    const d = addDays(ymd(), k - 13);
    const mm = moodOf(d);
    return h('span', { title: fmtDay(d), class: mm?.mood ? '' : 'empty' }, mm?.mood ? MOODS[mm.mood - 1] : '·');
  }));
  return card(day === ymd() ? 'How are you today?' : `How were you ${fmtDay(day, { weekday: 'short' })}?`, { cls: 'mood-card' },
    row('Mood', 'mood', MOODS), row('Energy', 'energy', ENERGY),
    h('button', { type: 'button', class: 'mini-link', onclick: () => openForm({
      title: 'Note for the day', values: { note: m.note || '' },
      fields: [{ name: 'note', label: 'Anything on your mind?', type: 'textarea', rows: 4 }],
      onSubmit: v => { store.save(MOOD, { date: day, note: v.note }, `mood:${day}`); },
    }) }, m.note ? '📝 Edit note' : '📝 Add a note'),
    h('p', { class: 'eyebrow', style: { marginTop: '12px' } }, 'Last 2 weeks'), strip,
    insights());
}

/** "Your mood is 0.8 higher on days you Workout": simple averages, at least 4 days each way. */
function insights() {
  const since = addDays(ymd(), -60);
  const moods = store.list(MOOD).filter(m => m.date >= since && m.mood);
  if (moods.length < 8) return h('p', { class: 'hint' }, `Check in for ${8 - moods.length} more day${8 - moods.length === 1 ? '' : 's'} to see how your habits and mood connect.`);
  const out = [];
  for (const hb of habits().filter(x => !isQuit(x))) {
    const yes = [], no = [];
    for (const m of moods) { if (!scheduled(hb, m.date)) continue; (met(hb, m.date) ? yes : no).push(m.mood); }
    if (yes.length < 4 || no.length < 4) continue;
    const diff = yes.reduce((a, b) => a + b, 0) / yes.length - no.reduce((a, b) => a + b, 0) / no.length;
    if (Math.abs(diff) >= 0.4) out.push({ hb, diff });
  }
  out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  if (!out.length) return h('p', { class: 'hint' }, 'No clear patterns between your habits and mood yet. Keep checking in.');
  return h('div', { class: 'insights' },
    out.slice(0, 3).map(({ hb, diff }) => h('p', {}, diff > 0 ? '📈 ' : '📉 ',
      `Your mood averages ${Math.abs(diff).toFixed(1)} ${diff > 0 ? 'higher' : 'lower'} on days you do `, h('b', {}, `${hb.emoji || ''} ${hb.name}`), '.')),
    h('p', { class: 'hint' }, 'Based on the last 60 days. These are patterns, not proof of cause.'));
}

// ---- screen ------------------------------------------------------------------------------------------
function badgeShelf() {
  const unlocked = stats().unlocked || {};
  const n = BADGES.filter(b => unlocked[b.id]).length;
  return card(`Badges · ${n}/${BADGES.length}`, {}, h('div', { class: 'badges' }, BADGES.map(b => {
    const got = unlocked[b.id];
    return h('button', { type: 'button', class: 'badge' + (got ? ' got' : ''), onclick: () => toast(got ? `${b.emoji} ${b.name}: earned ${relDay(got)}` : b.how) },
      h('span', { class: 'badge-emoji' }, got ? b.emoji : '🔒'), h('span', { class: 'badge-name' }, b.name));
  })));
}

function summaryCard(list) {
  const build = list.filter(hb => !isQuit(hb) && scheduled(hb, day) && hb.schedule !== 'weekly');
  const done = build.filter(hb => met(hb, day)).length;
  const frac = build.length ? done / build.length : 0;
  const best = list.reduce((m, hb) => (streak(hb) > m.s ? { s: streak(hb), hb } : m), { s: 0, hb: null });
  return h('section', { class: 'card habit-summary' },
    h('div', { class: 'big-ring' }, ringSvg(frac, 86), h('div', { class: 'big-ring-num' }, h('b', {}, `${done}/${build.length}`))),
    h('div', {},
      h('p', { class: 'eyebrow' }, day === ymd() ? 'Today' : fmtDay(day, { weekday: 'long' })),
      h('h2', {}, build.length && done === build.length ? '🌟 All done!' : done ? 'Keep going 💪' : 'Let\'s go 🌱'),
      best.hb ? h('p', { class: 'muted small' }, `Longest streak: ${best.hb.emoji || ''} ${best.hb.name} · 🔥 ${best.s} ${unitOf(best.hb)}s`) : null,
      h('p', { class: 'muted small' }, `🧊 ${FREEZES_PER_MONTH - freezesUsedThisMonth()} streak freeze${FREEZES_PER_MONTH - freezesUsedThisMonth() === 1 ? '' : 's'} left this month`)));
}

export function render(root, ctx) {
  rr = ctx.rerender;
  const list = habits();
  root.append(pageHead('Habits', { actions: [addBtn('Habit', () => editHabit(null))] }));
  root.append(dayNav(day, d => { if (d <= ymd()) { day = d; rr(); } }));

  if (list.length) {
    root.append(summaryCard(list));
    const build = list.filter(hb => !isQuit(hb));
    const grid = h('div', { class: 'grid habit-grid' });
    for (const [key, label] of ROUTINES) {
      const group = build.filter(hb => (hb.routine || 'anytime') === key);
      if (!group.length) continue;
      const due = group.filter(hb => scheduled(hb, day));
      const done = due.filter(hb => met(hb, day)).length;
      grid.append(card(`${label} · ${done}/${due.length}`, {
        cls: `routine-${key}`,
        action: due.length > 1 && done < due.length ? btn('▶ Start', () => startRoutine(key, due), 'ghost sm') : null,
      }, h('div', { class: 'htiles' }, group.map(hb => tile(hb, day)))));
    }
    const quits = list.filter(isQuit);
    if (quits.length) grid.append(card('🚫 Quitting', { cls: 'quit-card' },
      h('div', { class: 'htiles' }, quits.map(hb => tile(hb, day))),
      h('p', { class: 'hint' }, 'Tap the ring if you slip. Tap the name for your history.')));
    root.append(grid);
  }

  root.append(moodCard());

  if (list.length) root.append(badgeShelf());

  const have = new Set(list.map(x => x.name.toLowerCase()));
  const ideas = STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  const quitIdeas = QUIT_STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  if ((ideas.length || quitIdeas.length) && list.length < 10) {
    root.append(card(list.length ? 'More ideas' : 'Start with a few habits', {},
      h('p', { class: 'muted' }, 'Tap to add. You can change goals, days and reminders any time.'),
      h('p', { class: 'eyebrow', style: { marginTop: '8px' } }, 'Build'),
      h('div', { class: 'chip-row' }, ideas.map(s => btn(`${s.emoji} ${s.name}`, () => {
        store.save(COL, { kind: 'build', schedule: 'daily', ...s, startDate: ymd(), order: habits().length }); toast(`Added ${s.name}`);
      }, 'chip-btn'))),
      quitIdeas.length ? [h('p', { class: 'eyebrow', style: { marginTop: '12px' } }, 'Quit'),
        h('div', { class: 'chip-row' }, quitIdeas.map(s => btn(`${s.emoji} ${s.name}`, () => {
          store.save(COL, { ...s, kind: 'quit', startDate: ymd(), order: habits().length }); toast(`Tracking days without ${s.name.toLowerCase()}`);
        }, 'chip-btn')))] : null,
      h('div', { class: 'btn-row' }, btn('+ Make my own', () => editHabit(null), 'ghost sm'), btn('+ Something to quit', () => editHabit(null, { kind: 'quit' }), 'ghost sm'))));
  }
}
