// habits.js — habits to build and habits to quit, grouped into morning / afternoon /
// evening routines, shown as tap-to-log rings.
//
// Each day's count is its own record ("hl:<habit>:<date>"), so two devices logging on
// different days never overwrite each other. Also here: schedules (every day, certain
// days, or N times a week), history heatmaps & stats, per-habit reminders (see
// reminders.js), a daily mood & energy check-in with simple insights, milestones,
// streak freezes and badges.
import * as store from '../store.js';
import { getStatus } from '../sync.js';
import { canShare, spaceById, spaceLabel, shareOptions, resolveShare, sharedTag, others } from '../share.js';
import {
  h, pageHead, card, empty, addBtn, btn, iconBtn, icon, openForm, openSheet, dayNav, toast, barChart,
  ymd, addDays, addMonths, parseYmd, fmtDay, relDay, fmtTime,
} from '../ui.js';

export const id = 'habits';
export const title = 'Habits';
export const glyph = 'habits';

const COL = 'habits';      // { name, emoji, color, kind: 'build'|'quit', goal, unit, target: 'atleast'|'atmost'|'exactly', step,
                           //   schedule: 'daily'|'days'|'weekly'|'interval'|'monthly', days: [0-6], perWeek, every, perMonth,
                           //   routine, remind: 'HH:MM', startDate, endDate, pausedFrom, archived, order, milestones: { n: date } }
const LOGS = 'habitlogs';  // { habitId, date, count, frozen, note }
const MOOD = 'mood';       // id "mood:<date>" → { date, mood 1–5, energy 1–5, note }
const STATS_ID = 'settings:habitstats'; // { unlocked: {badge: date}, perfectDays: [dates], routines }

const COLORS = ['green', 'blue', 'purple', 'orange', 'pink', 'teal', 'red', 'yellow'];
const ROUTINES = [['morning', '🌅 Morning'], ['afternoon', '☀️ Afternoon'], ['evening', '🌙 Evening'], ['anytime', '✨ Anytime']];
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const MOOD_WORDS = ['Low', 'Meh', 'OK', 'Good', 'Great'];
const ENERGY_WORDS = ['Drained', 'Low', 'OK', 'Good', 'High'];
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
let showArchived = false;
/** Calm (default) = quieter look; Fun = emojis, confetti and badges up front. */
const fun = () => !!(store.get('settings:habitstats') || {}).fun;
const routineLabel = key => { const r = ROUTINES.find(x => x[0] === key)[1]; return fun() ? r : r.replace(/^\S+\s/, ''); };

// ---- data helpers -------------------------------------------------------------------------
export const habits = () => store.list(COL).filter(x => !x.archived)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created || '').localeCompare(b.created || ''));
// Shared habits: everyone keeps their own log (id includes the person), shared with the group.
const meId = () => getStatus().user?.id || 'me';
const spaceOf = hid => store.householdOf(hid);
const logId = (hid, d, uid) => (spaceOf(hid) ? `hl:${hid}:${uid || meId()}:${d}` : `hl:${hid}:${d}`);
const logOf = (hid, d) => store.get(logId(hid, d));
export const count = (hid, d) => Number(logOf(hid, d)?.count) || 0;
const countFor = (hid, uid, d) => Number(store.get(logId(hid, d, uid))?.count) || 0;
const frozen = (hid, d) => !!logOf(hid, d)?.frozen;
const mine = l => !l.by || l.by === meId();
const saveLog = (hid, d, fields) => store.save(LOGS, { habitId: hid, date: d, ...(spaceOf(hid) ? { by: meId() } : {}), ...fields }, logId(hid, d), { hh: spaceOf(hid) || '' });
const setCount = (hid, d, n, note) => saveLog(hid, d, { count: Math.max(0, Math.round(n * 100) / 100), frozen: false, ...(note !== undefined ? { note } : {}) });
const noteOf = (hid, d) => logOf(hid, d)?.note || '';

export const isQuit = hb => hb.kind === 'quit';
const goalOf = hb => { const g = Number(hb.goal); return hb.target === 'atmost' ? Math.max(0, g || 0) : Math.max(0.01, g || 1); };
const stepOf = hb => Math.max(0.01, Number(hb.step) || 1);
const targetWord = hb => ({ atmost: 'at most', exactly: 'exactly' })[hb.target] || (goalOf(hb) > 1 ? 'at least' : '');
const fmtN = n => (Math.round(n * 100) / 100).toLocaleString();
const startOf = hb => hb.startDate || (hb.created || ymd()).slice(0, 10);
const colorOf = hb => hb.color || COLORS[(hb.order ?? 0) % COLORS.length];
const weekStart = d => addDays(d, -((parseYmd(d).getDay() + 6) % 7));

/** Is this habit planned for date d? (weekly-goal habits can be done any day) */
export function scheduled(hb, d) {
  if (d < startOf(hb)) return false;
  if (hb.endDate && d > hb.endDate) return false;
  if (hb.pausedFrom && d >= hb.pausedFrom) return false;
  if (hb.schedule === 'days') return (hb.days || []).includes(parseYmd(d).getDay());
  if (hb.schedule === 'interval') {
    const every = Math.max(1, Number(hb.every) || 2);
    return Math.round((parseYmd(d) - parseYmd(startOf(hb))) / 864e5) % every === 0;
  }
  return true;
}
const isPeriodic = hb => !isQuit(hb) && (hb.schedule === 'weekly' || hb.schedule === 'monthly');
/** Did you hit it on date d? (for a habit to quit: no slips that day) */
export function met(hb, d) {
  if (isQuit(hb)) return d >= startOf(hb) && d <= ymd() && count(hb.id, d) === 0;
  const n = count(hb.id, d), g = goalOf(hb);
  if (hb.target === 'atmost') return d <= ymd() && n <= g && (d < ymd() || !!logOf(hb.id, d));
  if (hb.target === 'exactly') return Math.abs(n - g) < 1e-9;
  return n >= g;
}
const okDay = (hb, d) => met(hb, d) || frozen(hb.id, d);
export function weekDone(hb, ws, upto = ymd()) {
  let n = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d <= upto && okDay(hb, d)) n++; }
  return n;
}
const perWeek = hb => Math.max(1, Number(hb.perWeek) || 3);
const perMonth = hb => Math.max(1, Number(hb.perMonth) || 8);
const unitOf = hb => (isQuit(hb) ? 'day' : hb.schedule === 'weekly' ? 'week' : hb.schedule === 'monthly' ? 'month' : 'day');
export function monthDone(hb, ym, upto = ymd()) {
  let n = 0;
  for (let d = ym + '-01'; d.startsWith(ym) && d <= upto; d = addDays(d, 1)) if (okDay(hb, d)) n++;
  return n;
}
const prevMonth = ym => addMonths(ym + '-01', -1).slice(0, 7);

/** Current streak (days, or weeks for "N times a week" habits). Today doesn't break it until it's over. */
export function streak(hb, today = ymd()) {
  if (isQuit(hb)) {
    let d = today, n = 0;
    while (n < 5000 && d >= startOf(hb) && okDay(hb, d)) { n++; d = addDays(d, -1); }
    return n;
  }
  if (hb.schedule === 'monthly') {
    let ym = today.slice(0, 7), n = 0;
    if (monthDone(hb, ym) < perMonth(hb)) ym = prevMonth(ym);
    while (n < 240 && ym >= startOf(hb).slice(0, 7) && monthDone(hb, ym) >= perMonth(hb)) { n++; ym = prevMonth(ym); }
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
  if (hb.schedule === 'monthly' && !isQuit(hb)) {
    for (let ym = startOf(hb).slice(0, 7); ym <= today.slice(0, 7); ym = addMonths(ym + '-01', 1).slice(0, 7)) {
      if (monthDone(hb, ym) >= perMonth(hb)) best = Math.max(best, ++run); else if (ym !== today.slice(0, 7)) run = 0;
    }
    return best;
  }
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
  if (hb.schedule === 'monthly' && !isQuit(hb)) {
    const pct = Math.min(1, monthDone(hb, today.slice(0, 7)) / perMonth(hb));
    return Math.round(pct * 100);
  }
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

const totalLogged = hb => store.list(LOGS).filter(l => l.habitId === hb.id && mine(l) && (isQuit(hb) ? false : Number(l.count) >= goalOf(hb))).length;
const freezesUsedThisMonth = () => store.list(LOGS).filter(l => l.frozen && mine(l) && l.date?.startsWith(ymd().slice(0, 7))).length;

// ---- logging, milestones, badges ---------------------------------------------------------------
function log(hb, d, n, note) {
  const before = streak(hb);
  setCount(hb.id, d, n, note);
  if (d !== ymd()) return;
  const after = streak(hb);
  if (after > before && MILESTONES.includes(after) && !(hb.milestones || {})[after]) {
    store.save(COL, { milestones: { ...(hb.milestones || {}), [after]: ymd() } }, hb.id);
    celebrate();
    toast(fun() ? `🎉 ${after}-${unitOf(hb)} streak: ${hb.emoji || ''} ${hb.name}!` : `Milestone: ${after}-${unitOf(hb)} streak on ${hb.name}`);
  } else if (!isQuit(hb) && met(hb, d) && hb.target !== 'atmost') {
    toast(fun() ? `${hb.emoji || '✓'} ${hb.name} done${after > 1 ? ` · 🔥 ${after} ${unitOf(hb)}s` : ''}` : `${hb.name}: done${after > 1 ? ` · ${after}-${unitOf(hb)} streak` : ''}`);
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
  setTimeout(() => { celebrate(); toast(fun() ? '🌟 Perfect day: every habit done!' : 'Every habit done today.'); }, 600);
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
  if (fun()) setTimeout(() => { celebrate(); toast(`🏅 New badge: ${fresh.map(b => `${b.emoji} ${b.name}`).join(', ')}`); }, 1200);
}

function celebrate() {
  if (!fun()) return; // calm mode: no confetti
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
    values: hb ? { ...hb, share: spaceOf(hb.id) || '', schedule: hb.schedule || 'daily', routine: hb.routine || 'anytime', color: colorOf(hb), perWeek: hb.perWeek || 3, perMonth: hb.perMonth || 8, every: hb.every || 2, step: hb.step || 1, target: hb.target || 'atleast', kind: hb.kind || 'build', startDate: startOf(hb) }
      : { goal: 1, step: 1, target: 'atleast', every: 2, perMonth: 8, emoji: quit ? '🚫' : '✅', schedule: 'daily', routine: 'anytime', color: COLORS[habits().length % COLORS.length], perWeek: 3, kind: 'build', startDate: ymd(), ...defaults },
    fields: [
      { name: 'name', label: quit ? 'What are you quitting?' : 'Habit', required: true, autofocus: true, placeholder: quit ? 'Soda, vaping, doomscrolling…' : 'Water, stretch, read…' },
      { name: 'emoji', label: 'Emoji', placeholder: '💧' },
      { name: 'kind', label: 'Type', type: 'select', options: [['build', '✅ Build it (do it)'], ['quit', '🚫 Quit it (avoid it)']] },
      { name: 'color', label: 'Color', type: 'select', options: COLORS.map(c => [c, c[0].toUpperCase() + c.slice(1)]) },
      ...(quit ? [{ name: 'startDate', label: 'Quit date', type: 'date', hint: 'Days clean are counted from here.' }] : [
        { name: 'target', label: 'Goal type', type: 'select', options: [['atleast', 'At least (do this much or more)'], ['atmost', 'At most (stay under, e.g. screen time)'], ['exactly', 'Exactly']] },
        { name: 'goal', label: 'Daily amount', type: 'number', min: '0', step: 'any', inputmode: 'decimal', hint: 'e.g. 1 (just do it), 8 glasses, 30 minutes, 10000 steps, 2 hours' },
        { name: 'unit', label: 'Unit (optional)', placeholder: 'glasses, minutes, steps, L, pages…' },
        { name: 'step', label: 'Each tap adds', type: 'number', min: '0.01', step: 'any', inputmode: 'decimal', hint: 'e.g. 1 glass, 15 minutes, 0.25 L. You can always type an exact amount too.' },
        { name: 'schedule', label: 'How often', type: 'select', options: [['daily', 'Every day'], ['days', 'Certain days of the week'], ['interval', 'Every few days'], ['weekly', 'A number of times a week'], ['monthly', 'A number of times a month']] },
        { name: 'days', label: 'Which days? (certain days)', type: 'weekdays' },
        { name: 'every', label: 'Every how many days? (every few days)', type: 'number', min: '2', max: '60', step: '1', inputmode: 'numeric' },
        { name: 'perWeek', label: 'Times a week?', type: 'number', min: '1', max: '7', step: '1', inputmode: 'numeric' },
        { name: 'perMonth', label: 'Times a month?', type: 'number', min: '1', max: '31', step: '1', inputmode: 'numeric' },
        { name: 'startDate', label: 'Start date', type: 'date' },
        { name: 'endDate', label: 'End date (optional, e.g. a 30-day challenge)', type: 'date' },
        { name: 'routine', label: 'Part of which routine?', type: 'select', options: ROUTINES },
        { name: 'remind', label: 'Remind me at (optional)', type: 'time', hint: 'Needs Settings → Reminders turned on for this device.' },
      ]),
      ...(canShare() ? [{ name: 'share', label: 'Do it together with', type: 'select', options: shareOptions('Just me'), hint: 'Shared habits: everyone tracks their own progress and can see each other\'s.' }] : []),
    ],
    onSubmit: v => {
      if (v.kind === 'quit' && !quit && !hb) { editHabit(null, { ...v, kind: 'quit' }); return; }
      const fields = { ...v, goal: v.goal === '' ? 1 : Number(v.goal), perWeek: Number(v.perWeek) || 3, perMonth: Number(v.perMonth) || 8, every: Number(v.every) || 2, step: Number(v.step) || 1 };
      if (fields.endDate && fields.startDate && fields.endDate < fields.startDate) { toast('End date is before the start date'); return false; }
      if (fields.schedule === 'days' && !(fields.days || []).length) { toast('Pick at least one day'); return false; }
      const { share, ...clean } = fields;
      resolveShare(share || '').then(hh => {
        if (hh === null) hh = hb ? spaceOf(hb.id) || '' : '';
        if (!hb) { store.save(COL, { ...clean, order: habits().length }, undefined, { hh }); return; }
        if ((spaceOf(hb.id) || '') === hh) { store.save(COL, clean, hb.id); return; }
        // moving to/from a shared space: copy the habit and your own logs
        const myLogs = store.list(LOGS).filter(l => l.habitId === hb.id && mine(l));
        const { id: _o, ...data } = hb;
        const newId = store.save(COL, { ...data, ...clean }, undefined, { hh });
        for (const l of myLogs) { const { id: lid, habitId, ...ld } = l; saveLog(newId, l.date, ld); store.remove(lid); }
        store.remove(hb.id);
        toast(hh ? `Shared with ${spaceLabel(spaceById(hh))}` : 'Made private');
      });
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

/** "Jordan ✓ · Sam 3/8" under a shared habit. */
function partnersLine(hb, d) {
  const g = spaceById(spaceOf(hb.id));
  if (!g) return null;
  const ps = others(g);
  if (!ps.length) return null;
  return h('span', { class: 'htile-partners' }, ps.map(p => {
    const n = countFor(hb.id, p.id, d);
    const ok = isQuit(hb) ? !n : hb.target === 'atmost' ? n <= goalOf(hb) : n >= goalOf(hb);
    return `${p.name} ${isQuit(hb) ? (n ? '✗' : '✓') : ok ? '✓' : goalOf(hb) !== 1 ? `${fmtN(n)}/${fmtN(goalOf(hb))}` : '–'}`;
  }).join(' · '));
}

function ringFrac(hb, d) {
  const n = count(hb.id, d), g = goalOf(hb);
  if (isQuit(hb)) return n ? 0 : 1;
  if (hb.target === 'atmost') return g ? Math.max(0, 1 - n / g) : n ? 0 : 1; // fills down as you use up your allowance
  return g ? n / g : 0;
}

function subText(hb, d) {
  const n = count(hb.id, d);
  if (isQuit(hb)) {
    const s = streak(hb);
    return n ? `${n} slip${n > 1 ? 's' : ''} today` : `${s} day${s === 1 ? '' : 's'} clean`;
  }
  const g = goalOf(hb);
  const u = hb.unit ? ' ' + hb.unit : '';
  const main = hb.target === 'atmost' ? `${fmtN(n)}${u} (max ${fmtN(g)})`
    : hb.target === 'exactly' ? `${fmtN(n)}/${fmtN(g)}${u} exactly`
    : g !== 1 || hb.unit ? `${fmtN(n)}/${fmtN(g)}${u}` : n >= 1 ? 'Done' : 'Tap to do';
  if (hb.schedule === 'weekly') return `${main} · ${weekDone(hb, weekStart(d), d)}/${perWeek(hb)} this week`;
  if (hb.schedule === 'monthly') return `${main} · ${monthDone(hb, d.slice(0, 7), d)}/${perMonth(hb)} this month`;
  return main + (noteOf(hb.id, d) ? ' · 📝' : '');
}

function tap(hb, d) {
  const n = count(hb.id, d);
  if (isQuit(hb)) {
    if (confirm(`Log a slip for "${hb.name}"? It resets your clean streak, and that's OK. Tomorrow's a new day.`)) log(hb, d, n + 1);
    return;
  }
  const g = goalOf(hb);
  if (g === 1 && (hb.target || 'atleast') === 'atleast' && !hb.unit && stepOf(hb) === 1) log(hb, d, n >= 1 ? 0 : 1);
  else log(hb, d, n + stepOf(hb));
}

/** Log an exact amount and/or a note for a day. */
function logSheet(hb, d, after) {
  const n = count(hb.id, d);
  const amount = h('input', { type: 'number', step: 'any', min: '0', inputmode: 'decimal', value: String(n), 'aria-label': 'Amount' });
  const note = h('textarea', { rows: 3, placeholder: 'How did it go? (optional)' }); note.value = noteOf(hb.id, d);
  const st = stepOf(hb);
  const quick = isQuit(hb) ? [] : [[`+${fmtN(st)}`, st], [`+${fmtN(st * 2)}`, st * 2], ['Goal', null], ['Reset', 0]];
  openSheet({
    title: `${hb.name} · ${relDay(d)}`,
    body: [
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, isQuit(hb) ? 'Slips' : `Amount${hb.unit ? ` (${hb.unit})` : ''} · goal: ${targetWord(hb)} ${fmtN(goalOf(hb))}`), amount),
      quick.length ? h('div', { class: 'chip-row' }, quick.map(([l, v]) => h('button', { type: 'button', class: 'chip', onclick: () => {
        amount.value = String(v === null ? goalOf(hb) : v === 0 ? 0 : (Number(amount.value) || 0) + v);
      } }, l))) : null,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note'), note),
    ],
    actions: [{ label: 'Save', cls: 'primary', onClick: () => { log(hb, d, Number(amount.value) || 0, note.value.trim()); after?.(); } }],
  });
}

function tile(hb, d) {
  const n = count(hb.id, d);
  const g = goalOf(hb);
  const quit = isQuit(hb);
  const done = met(hb, d);
  const restDay = !quit && !scheduled(hb, d);
  const s = streak(hb);
  const frac = ringFrac(hb, d);
  const el = h('div', { class: `htile hc-${colorOf(hb)}${done ? ' done' : ''}${restDay ? ' rest' : ''}${quit ? ' quit' : ''}` },
    h('button', { type: 'button', class: 'hring-btn', 'aria-label': quit ? `Log a slip for ${hb.name}` : `Log ${hb.name}`, onclick: e => {
      tap(hb, d);
      e.currentTarget.closest('.htile')?.classList.add('pop');
    } }, ringSvg(frac), h('span', { class: 'hring-emoji' }, hb.emoji || '•'),
      done && !quit ? h('span', { class: 'hring-check' }, '✓') : null),
    h('button', { type: 'button', class: 'htile-name', onclick: () => details(hb) }, hb.name),
    h('span', { class: 'htile-sub' }, restDay ? (hb.pausedFrom && d >= hb.pausedFrom ? '⏸ Paused' : hb.endDate && d > hb.endDate ? 'Finished' : 'Rest day') : subText(hb, d)),
    s > 1 && !quit ? h('span', { class: 'htile-streak' }, `${fun() ? '🔥 ' : ''}${s}${unitOf(hb) === 'week' ? 'w' : 'd'} streak`) : null,
    partnersLine(hb, d),
    !quit ? h('button', { type: 'button', class: 'htile-edit', 'aria-label': `Enter amount or note for ${hb.name}`, onclick: () => logSheet(hb, d) }, '✎') : null);
  return el;
}

/** Compact row for the Today screen. */
export function habitRow(hb, d) {
  const n = count(hb.id, d), g = goalOf(hb);
  const quit = isQuit(hb);
  return h('div', { class: `row habit-row hc-${colorOf(hb)}${met(hb, d) && !quit ? ' met' : ''}` },
    h('button', { type: 'button', class: 'mini-ring', 'aria-label': `Log ${hb.name}`, onclick: () => tap(hb, d) },
      ringSvg(ringFrac(hb, d), 40), h('span', {}, hb.emoji || '•')),
    h('div', { class: 'row-main', onclick: () => details(hb) },
      h('div', { class: 'row-title' }, hb.name),
      h('div', { class: 'row-sub' }, subText(hb, d), !quit && streak(hb) > 1 ? ` · 🔥 ${streak(hb)}` : '')),
    !quit && (g !== 1 || hb.unit) ? h('div', { class: 'stepper' },
      iconBtn('minus', () => log(hb, d, Math.max(0, n - stepOf(hb))), `Less ${hb.name}`),
      iconBtn('plus', () => log(hb, d, n + stepOf(hb)), `More ${hb.name}`)) : null);
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
        : !scheduled(hb, d) && (hb.schedule === 'interval' || hb.pausedFrom || hb.endDate) ? 'rest'
        : met(hb, d) ? 'full' : hb.target === 'atmost' ? (logOf(hb.id, d) ? 'miss' : 'none') : n > 0 ? 'part' : d === today ? 'none' : 'miss';
      cells.push(h('button', {
        type: 'button', class: `hm-cell lvl-${lvl}${inMonth ? '' : ' out'}${d === today ? ' today' : ''}`, disabled: d > today,
        'aria-label': `${fmtDay(d, { month: 'long', day: 'numeric' })}: ${lvl}`,
        onclick: () => dayMenu(hb, d, draw),
      }, Number(d.slice(8))));
    }
    body.replaceChildren(...[
      h('div', { class: `habit-hero hc-${colorOf(hb)}` },
        h('span', { class: 'habit-hero-emoji' }, hb.emoji || '•'),
        h('div', {}, h('b', {}, isQuit(hb) ? 'Quitting' : scheduleText(hb)), h('div', { class: 'muted small' }, isQuit(hb) ? `Since ${fmtDay(startOf(hb), { month: 'short', day: 'numeric', year: 'numeric' })}` : `${routineLabel(hb.routine || 'anytime')}${goalOf(hb) !== 1 || hb.unit ? ` · ${targetWord(hb)} ${fmtN(goalOf(hb))}${hb.unit ? ' ' + hb.unit : ''} a day` : ''}${hb.remind ? ` · ⏰ ${fmtTime(hb.remind)}` : ''}${hb.endDate ? ` · ends ${fmtDay(hb.endDate, { month: 'short', day: 'numeric' })}` : ''}`),
          hb.pausedFrom ? h('div', { class: 'tag', style: { marginTop: '4px', display: 'inline-block' } }, `⏸ Paused since ${relDay(hb.pausedFrom)}`) : null)),
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
      partnersWeek(hb),
      trend(hb),
      logHistory(hb, draw),
      !isQuit(hb) ? h('p', { class: 'muted small' }, `Completed ${totalLogged(hb)} time${totalLogged(hb) === 1 ? '' : 's'} in total.`) : null,
    ].filter(Boolean));
  };
  draw();
  openSheet({ title: hb.name, body: [body], actions: [
    { label: 'Edit habit', onClick: () => editHabit(hb) },
    hb.pausedFrom ? { label: '▶ Resume', onClick: () => { store.save(COL, { pausedFrom: '' }, hb.id); toast(`${hb.name} resumed`); } }
      : { label: '⏸ Pause', onClick: () => { store.save(COL, { pausedFrom: ymd() }, hb.id); toast(`${hb.name} paused. Your streak is kept.`); } },
    hb.archived ? { label: 'Unarchive', onClick: () => store.save(COL, { archived: false }, hb.id) }
      : { label: 'Archive', onClick: () => { store.save(COL, { archived: true }, hb.id); toast(`${hb.name} archived (history kept)`); } },
  ] });
}

function partnersWeek(hb) {
  const g = spaceById(spaceOf(hb.id));
  if (!g) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ymd(), i - 6));
  const row = (name, uid) => h('div', { class: 'pw-row' }, h('span', { class: 'pw-name' }, name),
    days.map(d => { const n = uid ? countFor(hb.id, uid, d) : count(hb.id, d); const ok = isQuit(hb) ? !n : hb.target === 'atmost' ? n <= goalOf(hb) : n >= goalOf(hb);
      return h('span', { class: 'pw-dot' + (ok && (n || isQuit(hb) || hb.target === 'atmost') ? ' on' : ''), title: fmtDay(d) }); }));
  return h('div', { class: 'partners-week' }, h('p', { class: 'field-label' }, `Together with ${spaceLabel(g)} · last 7 days`),
    row('You', ''), others(g).map(p => row(p.name, p.id)));
}

/** Last 14 days as a bar chart, for habits you measure. */
function trend(hb) {
  if (isQuit(hb) || (goalOf(hb) === 1 && !hb.unit)) return null;
  const vals = Array.from({ length: 14 }, (_, i) => { const d = addDays(ymd(), i - 13); return { label: fmtDay(d, { weekday: 'narrow' }), value: count(hb.id, d), highlight: d === ymd() }; });
  if (!vals.some(v => v.value)) return null;
  const avg = vals.reduce((a, v) => a + v.value, 0) / 14;
  return h('div', {}, h('p', { class: 'field-label' }, `Last 14 days${hb.unit ? ` (${hb.unit})` : ''}`),
    barChart(vals, { format: v => fmtN(v), caption: `Average ${fmtN(Math.round(avg * 10) / 10)}${hb.unit ? ' ' + hb.unit : ''} a day · goal ${targetWord(hb)} ${fmtN(goalOf(hb))}` }));
}

/** Recent logs with amounts and notes (journal). */
function logHistory(hb, redraw) {
  const logs = store.list(LOGS).filter(l => l.habitId === hb.id && mine(l) && (Number(l.count) || l.note || l.frozen)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  if (!logs.length) return null;
  const u = hb.unit ? ' ' + hb.unit : '';
  return h('div', {}, h('p', { class: 'field-label' }, 'Log & notes'),
    logs.map(l => h('button', { type: 'button', class: 'row log-row', onclick: () => logSheet(hb, l.date, () => setTimeout(redraw, 50)) },
      h('span', { class: 'slot' }, fmtDay(l.date, { month: 'short', day: 'numeric' })),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, l.frozen ? '🧊 Freeze' : isQuit(hb) ? `${l.count} slip${l.count > 1 ? 's' : ''}` : `${fmtN(Number(l.count) || 0)}${u}${met(hb, l.date) ? ' ✓' : ''}`),
        l.note ? h('div', { class: 'row-sub' }, l.note) : null))),
    h('p', { class: 'hint' }, 'Tap an entry to change the amount or note.'));
}

function dayMenu(hb, d, redraw) {
  const n = count(hb.id, d);
  const fields = isQuit(hb)
    ? [{ name: 'count', label: `Slips on ${fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}`, type: 'number', min: '0', step: '1', inputmode: 'numeric' }]
    : [{ name: 'count', label: `${fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' })}: how much${hb.unit ? ' (' + hb.unit + ')' : ''}? (goal: ${targetWord(hb)} ${fmtN(goalOf(hb))})`, type: 'number', min: '0', step: 'any', inputmode: 'decimal' }];
  fields.push({ name: 'note', label: 'Note (optional)', type: 'textarea', rows: 2 });
  const canFreeze = !isQuit(hb) && d < ymd() && n < goalOf(hb) && !frozen(hb.id, d) && freezesUsedThisMonth() < FREEZES_PER_MONTH;
  if (canFreeze) fields.push({ name: 'freeze', label: `🧊 Use a streak freeze for this day (${FREEZES_PER_MONTH - freezesUsedThisMonth()} left this month)`, type: 'checkbox' });
  openForm({
    title: hb.name,
    values: { count: n, freeze: false, note: noteOf(hb.id, d) },
    fields,
    onSubmit: v => {
      if (v.freeze) { saveLog(hb.id, d, { count: Number(v.count) || 0, frozen: true }); toast('🧊 Streak protected'); }
      else log(hb, d, Number(v.count) || 0, v.note || '');
      setTimeout(redraw, 50);
    },
  });
}

function scheduleText(hb) {
  if (hb.schedule === 'weekly') return `${perWeek(hb)}× a week`;
  if (hb.schedule === 'monthly') return `${perMonth(hb)}× a month`;
  if (hb.schedule === 'interval') return `Every ${Math.max(2, Number(hb.every) || 2)} days`;
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
      toast(`${routineLabel(key)} routine complete${fun() ? '!' : '.'}`);
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
        btn(hb.target === 'atmost' ? 'Stayed under ✓' : goalOf(hb) !== 1 ? `Done (${fmtN(goalOf(hb))}${hb.unit ? ' ' + hb.unit : ''})` : 'Done ✓', () => { log(hb, day, hb.target === 'atmost' ? count(hb.id, day) : goalOf(hb)); i++; show(); }, 'primary')));
  };
  show();
  dlg = openSheet({ title: `${routineLabel(key)} routine`, body: [body] });
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
    if (!fun()) return h('span', { title: `${fmtDay(d)}${mm?.mood ? ': ' + MOOD_WORDS[mm.mood - 1] : ''}`, class: 'mood-bar' + (mm?.mood ? '' : ' empty') }, h('i', { style: { height: `${(mm?.mood || 0) * 20}%` } }));
    return h('span', { title: fmtDay(d), class: mm?.mood ? '' : 'empty' }, mm?.mood ? MOODS[mm.mood - 1] : '·');
  }));
  return card(day === ymd() ? 'Daily check-in' : `Check-in · ${fmtDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}`, { cls: 'mood-card' + (fun() ? '' : ' calm') },
    row('Mood', 'mood', fun() ? MOODS : MOOD_WORDS), row('Energy', 'energy', fun() ? ENERGY : ENERGY_WORDS),
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
    out.slice(0, 3).map(({ hb, diff }) => h('p', {}, fun() ? (diff > 0 ? '📈 ' : '📉 ') : (diff > 0 ? '↑ ' : '↓ '),
      `Your mood averages ${Math.abs(diff).toFixed(1)} points ${diff > 0 ? 'higher' : 'lower'} (out of 5) on days you do `, h('b', {}, fun() ? `${hb.emoji || ''} ${hb.name}` : hb.name), '.')),
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
  const build = list.filter(hb => !isQuit(hb) && scheduled(hb, day) && !isPeriodic(hb));
  const done = build.filter(hb => met(hb, day)).length;
  const frac = build.length ? done / build.length : 0;
  const best = list.reduce((m, hb) => (streak(hb) > m.s ? { s: streak(hb), hb } : m), { s: 0, hb: null });
  return h('section', { class: 'card habit-summary' },
    h('div', { class: 'big-ring' }, ringSvg(frac, 86), h('div', { class: 'big-ring-num' }, h('b', {}, `${done}/${build.length}`))),
    h('div', {},
      h('p', { class: 'eyebrow' }, day === ymd() ? 'Today' : fmtDay(day, { weekday: 'long' })),
      h('h2', {}, fun() ? (build.length && done === build.length ? '🌟 All done!' : done ? 'Keep going 💪' : 'Let\'s go 🌱')
        : build.length ? `${done} of ${build.length} done` : 'Nothing scheduled'),
      best.hb ? h('p', { class: 'muted small' }, `Longest streak: ${best.hb.name} · ${best.s} ${unitOf(best.hb)}s`) : null,
      h('p', { class: 'muted small' }, `${FREEZES_PER_MONTH - freezesUsedThisMonth()} streak freeze${FREEZES_PER_MONTH - freezesUsedThisMonth() === 1 ? '' : 's'} left this month`)));
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
    for (const [key] of ROUTINES) {
      const label = routineLabel(key);
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
    if (quits.length) grid.append(card(fun() ? '🚫 Quitting' : 'Quitting', { cls: 'quit-card' },
      h('div', { class: 'htiles' }, quits.map(hb => tile(hb, day))),
      h('p', { class: 'hint' }, 'Tap the ring if you slip. Tap the name for your history.')));
    root.append(grid);
  }

  root.append(moodCard());

  if (list.length) {
    if (fun()) root.append(badgeShelf());
    else {
      const unlocked = stats().unlocked || {};
      root.append(h('details', { class: 'card calm-badges' }, h('summary', {}, `Badges (${BADGES.filter(b => unlocked[b.id]).length}/${BADGES.length})`), badgeShelf()));
    }
  }
  const archived = store.list(COL).filter(x => x.archived);
  root.append(h('div', { class: 'habit-foot' },
    h('div', { class: 'seg look-seg' }, [['calm', 'Calm look'], ['fun', 'Fun look']].map(([v, l]) => h('button', {
      type: 'button', class: (fun() ? 'fun' : 'calm') === v ? 'on' : '', onclick: () => store.save('settings', { fun: v === 'fun' }, STATS_ID),
    }, l))),
    archived.length ? btn(showArchived ? 'Hide archived' : `Archived (${archived.length})`, () => { showArchived = !showArchived; rr(); }, 'ghost sm') : null));
  if (showArchived && archived.length) root.append(card('Archived habits', {}, archived.map(hb => h('div', { class: 'row', onclick: () => details(hb) },
    h('span', { class: 'emoji' }, hb.emoji || '•'), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, hb.name), h('div', { class: 'row-sub' }, 'Tap to see history or unarchive'))))));

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
