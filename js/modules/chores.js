// chores.js — the Cleaning tab.
//
// Every chore has a real due date. It repeats every N days, can be pinned to a weekday
// ("Bathroom every Saturday"), and can be moved or snoozed to any date. Checking it off
// schedules the next one. The screen shows:
//   • a "home freshness" score (how on top of things you are right now), streak and points
//   • a Mon–Sun week strip with what's due each day
//   • rooms, each with its own freshness bar
//   • ⚡ Quick clean: "I have 15 minutes", which picks the most important chores that fit
import * as store from '../store.js';
import {
  h, pageHead, card, empty, addBtn, btn, iconBtn, icon, openForm, openSheet, toast,
  ymd, addDays, daysBetween, relDay, parseYmd, fmtDay,
} from '../ui.js';

export const id = 'chores';
export const title = 'Cleaning';
export const glyph = 'clean';

const COL = 'chores'; // { name, room, every (days), day (0–6 or ''), minutes, startOn, due (moved date), lastDone, history: [dates] }
const EVERY = [['1', 'Every day'], ['2', 'Every 2 days'], ['3', 'Twice a week'], ['7', 'Every week'], ['14', 'Every 2 weeks'], ['30', 'Every month'], ['90', 'Every 3 months'], ['182', 'Every 6 months']];
const EVERY_LABEL = Object.fromEntries(EVERY);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ROOMS = {
  Kitchen: { emoji: '🍳', color: 'orange' },
  Bathroom: { emoji: '🛁', color: 'blue' },
  Bedroom: { emoji: '🛏️', color: 'purple' },
  'Living room': { emoji: '🛋️', color: 'teal' },
  Laundry: { emoji: '🧺', color: 'pink' },
  'Whole place': { emoji: '🏠', color: 'green' },
  Outside: { emoji: '🌿', color: 'lime' },
  Car: { emoji: '🚗', color: 'gray' },
};
const roomOf = c => ROOMS[c.room] || { emoji: '🧽', color: 'gray' };

const STARTERS = [
  { name: 'Clean bathroom (toilet, sink, mirror)', room: 'Bathroom', every: 7, minutes: 20 },
  { name: 'Shower & tub scrub', room: 'Bathroom', every: 14, minutes: 20 },
  { name: 'Wipe kitchen counters & stove', room: 'Kitchen', every: 3, minutes: 10 },
  { name: 'Take out trash & recycling', room: 'Kitchen', every: 3, minutes: 5 },
  { name: 'Run & empty the dishwasher', room: 'Kitchen', every: 2, minutes: 10 },
  { name: 'Clean out fridge', room: 'Kitchen', every: 30, minutes: 20 },
  { name: 'Clean microwave & oven', room: 'Kitchen', every: 30, minutes: 20 },
  { name: 'Laundry', room: 'Laundry', every: 7, minutes: 15 },
  { name: 'Wash towels', room: 'Laundry', every: 7, minutes: 10 },
  { name: 'Change bed sheets', room: 'Bedroom', every: 14, minutes: 15 },
  { name: 'Tidy desk & nightstand', room: 'Bedroom', every: 7, minutes: 10 },
  { name: 'Vacuum / sweep floors', room: 'Whole place', every: 7, minutes: 20 },
  { name: 'Mop floors', room: 'Whole place', every: 14, minutes: 25 },
  { name: 'Dust surfaces', room: 'Whole place', every: 14, minutes: 15 },
  { name: 'Tidy the couch & coffee table', room: 'Living room', every: 3, minutes: 5 },
  { name: 'Clean out the car', room: 'Car', every: 30, minutes: 20 },
];

let selected = ymd();
let roomFilter = '';
let rr = () => {};

export const chores = () => store.list(COL);

// ---- dates ---------------------------------------------------------------------------------
/** Next weekday `wd` (0–6) on or after date d. */
function onOrAfterWeekday(d, wd) {
  const diff = (Number(wd) - parseYmd(d).getDay() + 7) % 7;
  return addDays(d, diff);
}

/** The date this chore is due next. */
export function dueDate(c) {
  const every = Number(c.every) || 7;
  if (c.due && (!c.lastDone || c.due > c.lastDone)) return c.due; // you moved or snoozed it
  if (!c.lastDone) return c.startOn || (c.created || ymd()).slice(0, 10);
  const base = addDays(c.lastDone, every);
  if (c.day === '' || c.day == null || every < 7) return base;
  // pinned to a weekday: the nearest one around the normal date, never before the day after you did it
  let d = onOrAfterWeekday(addDays(base, -3), c.day);
  if (d <= c.lastDone) d = addDays(d, 7);
  return d;
}

function weekOf(d = ymd()) {
  const day = parseYmd(d).getDay();
  const start = addDays(d, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

// ---- scores -----------------------------------------------------------------------------------
/** 0–100: 100 when not overdue, dropping as it gets overdue (0 once it's a full cycle late). */
function freshness(c, today = ymd()) {
  const late = daysBetween(dueDate(c), today);
  if (late <= 0 || c.lastDone === today) return 100;
  return Math.max(0, Math.round(100 * (1 - late / Math.max(Number(c.every) || 7, 2))));
}
const avg = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 100);
export const homeScore = (list = chores()) => avg(list.map(c => freshness(c)));
const mood = n => n >= 90 ? ['✨', 'Sparkling'] : n >= 70 ? ['😊', 'Pretty clean'] : n >= 45 ? ['🙂', 'Getting messy'] : ['😬', 'Needs some love'];

/** Days in a row (ending today or yesterday) with at least one chore done. */
function streak(list = chores()) {
  const done = new Set(list.flatMap(c => c.history || []));
  let d = done.has(ymd()) ? ymd() : addDays(ymd(), -1);
  let n = 0;
  while (done.has(d) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
const pointsThisWeek = (list = chores()) => {
  const { start, end } = weekOf();
  return list.reduce((s, c) => s + (c.history || []).filter(d => d >= start && d <= end).length * (10 + Math.min(20, Number(c.minutes) || 10)), 0);
};

/** "4 of 7 done this week" — counts chores due this week plus ones finished this week. */
export function weekProgress() {
  const { start, end } = weekOf();
  const list = chores();
  const doneThisWeek = list.filter(c => (c.history || []).some(d => d >= start && d <= end));
  const stillDue = list.filter(c => dueDate(c) <= end && !doneThisWeek.includes(c));
  return { done: doneThisWeek.length, total: doneThisWeek.length + stillDue.length };
}

// ---- actions -------------------------------------------------------------------------------------
export function markDone(c) {
  const today = ymd();
  const history = [today, ...(c.history || []).filter(d => d !== today)].slice(0, 60);
  store.save(COL, { lastDone: today, history, due: '' }, c.id);
  const next = dueDate({ ...c, lastDone: today, due: '' });
  const left = chores().filter(x => x.id !== c.id && dueDate(x) <= today && x.lastDone !== today).length;
  if (!left) { celebrate(); toast('✨ All done for today! Next: ' + relDay(next)); }
  else toast(`Nice! +${10 + Math.min(20, Number(c.minutes) || 10)} points · next ${relDay(next)}`);
}

function undoDone(c) {
  const history = (c.history || []).slice(1);
  store.save(COL, { lastDone: history[0] || '', history }, c.id);
}

const snooze = (c, days = 1) => { const d = addDays(dueDate(c) < ymd() ? ymd() : dueDate(c), days); store.save(COL, { due: d }, c.id); toast(`Moved to ${relDay(d)}`); };

function moveTo(c) {
  openForm({
    title: `Move "${c.name}"`,
    values: { due: dueDate(c) < ymd() ? ymd() : dueDate(c) },
    fields: [{ name: 'due', label: 'Do it on', type: 'date', required: true, hint: 'After you do it, it goes back to its normal schedule.' }],
    onSubmit: v => { store.save(COL, { due: v.due }, c.id); toast(`Moved to ${relDay(v.due)}`); },
  });
}

function choreMenu(c) {
  const r = roomOf(c);
  const due = dueDate(c);
  openSheet({
    title: c.name,
    body: [
      h('div', { class: `chore-hero room-${r.color}` }, h('span', { class: 'chore-hero-emoji' }, r.emoji),
        h('div', {}, h('b', {}, c.room || 'Anywhere'), h('div', { class: 'muted small' }, scheduleText(c)))),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Next due'), h('dd', {}, fmtDay(due, { weekday: 'long', month: 'short', day: 'numeric' })),
        h('dt', {}, 'Last done'), h('dd', {}, c.lastDone ? relDay(c.lastDone) : 'Not yet'),
        h('dt', {}, 'Takes about'), h('dd', {}, `${Number(c.minutes) || 10} min`),
        h('dt', {}, 'Done in the last 30 days'), h('dd', {}, String((c.history || []).filter(d => d >= addDays(ymd(), -30)).length))),
    ],
    actions: [
      c.lastDone === ymd() ? { label: 'Undo today', onClick: () => undoDone(c) } : { label: '✓ Done', cls: 'primary', onClick: () => markDone(c) },
      { label: 'Tomorrow', onClick: () => snooze(c, 1) },
      { label: 'Pick a date', onClick: () => moveTo(c) },
      { label: 'Edit', onClick: () => editChore(c) },
    ],
  });
}

function scheduleText(c) {
  const every = Number(c.every) || 7;
  const base = (EVERY_LABEL[String(every)] || `Every ${every} days`);
  return c.day !== '' && c.day != null && every >= 7 ? `${base} on ${WEEKDAYS[c.day]}s` : base;
}

function editChore(c, defaults = {}) {
  openForm({
    title: c ? 'Edit chore' : 'New chore',
    values: c ? { ...c, every: String(c.every), day: c.day ?? '', minutes: c.minutes || 10, startOn: dueDate(c) } : { every: '7', day: '', minutes: 15, startOn: ymd(), ...defaults },
    fields: [
      { name: 'name', label: 'Chore', required: true, autofocus: true, placeholder: 'Clean bathroom, vacuum…' },
      { name: 'room', label: 'Room', type: 'select', options: [['', 'Anywhere'], ...Object.entries(ROOMS).map(([n, r]) => [n, `${r.emoji} ${n}`])] },
      { name: 'every', label: 'How often', type: 'select', options: EVERY },
      { name: 'day', label: 'On a certain day? (weekly or less often)', type: 'select', options: [['', 'Any day'], ...WEEKDAYS.map((d, i) => [String(i), d + 's'])] },
      { name: 'startOn', label: c ? 'Next due date' : 'First due date', type: 'date', required: true },
      { name: 'minutes', label: 'About how many minutes?', type: 'number', min: '1', step: '1', inputmode: 'numeric', hint: 'Used by ⚡ Quick clean' },
    ],
    onSubmit: v => {
      const fields = { ...v, every: Number(v.every), day: v.day === '' ? '' : Number(v.day), minutes: Number(v.minutes) || 10 };
      if (c) { fields.due = v.startOn; delete fields.startOn; }
      store.save(COL, fields, c?.id);
    },
    onDelete: c ? () => store.remove(c.id) : null,
  });
}

// ---- quick clean ----------------------------------------------------------------------------
function quickClean() {
  const today = ymd();
  const pick = mins => {
    // most overdue first, then due soonest; fill up the time
    const list = chores().filter(c => c.lastDone !== today && dueDate(c) <= addDays(today, 3))
      .sort((a, b) => freshness(a) - freshness(b) || dueDate(a).localeCompare(dueDate(b)));
    const out = []; let total = 0;
    for (const c of list) { const m = Number(c.minutes) || 10; if (total + m <= mins) { out.push(c); total += m; } }
    return { out, total };
  };
  const body = h('div', { class: 'stack' });
  const show = mins => {
    const { out, total } = pick(mins);
    body.replaceChildren(
      h('p', { class: 'muted' }, out.length ? `Here's ${total} minutes of the most important stuff. Put on some music. 🎵` : 'Nothing urgent fits. You\'re in good shape! ✨'),
      ...out.map(c => {
        const r = roomOf(c);
        const row = h('div', { class: 'row' },
          h('button', { type: 'button', class: 'check', 'aria-label': 'Done', onclick: e => { markDone(c); e.currentTarget.classList.add('on'); row.classList.add('done'); } }),
          h('span', { class: `room-dot room-${r.color}` }, r.emoji),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-sub' }, `${Number(c.minutes) || 10} min`)));
        return row;
      }));
  };
  const timeBtns = h('div', { class: 'seg' }, [10, 15, 30, 60].map(m => {
    const b = h('button', { type: 'button', onclick: () => { timeBtns.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(m); } }, m < 60 ? `${m} min` : '1 hour');
    if (m === 15) b.classList.add('on');
    return b;
  }));
  show(15);
  openSheet({ title: '⚡ Quick clean', body: [h('p', { class: 'field-label' }, 'How much time do you have?'), timeBtns, body], actions: [{ label: 'Done', cls: 'primary' }] });
}

// ---- celebrate --------------------------------------------------------------------------------
function celebrate() {
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  const bits = ['✨', '🫧', '🧼', '⭐', '🎉', '💫'];
  for (let i = 0; i < 26; i++) {
    layer.append(h('span', { style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 0.4 + 's', fontSize: 16 + Math.random() * 16 + 'px' } }, bits[i % bits.length]));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

// ---- rows & pieces ----------------------------------------------------------------------------------
function dueLabel(c) {
  const today = ymd();
  if (c.lastDone === today) return ['Done today ✓', 'tag ok-tag'];
  const due = dueDate(c);
  const days = daysBetween(today, due);
  if (days < 0) return [`${-days} day${days === -1 ? '' : 's'} late · was ${fmtDay(due, { month: 'short', day: 'numeric' })}`, 'tag red'];
  if (days === 0) return ['Due today', 'tag due-today'];
  return [`Due ${fmtDay(due, { weekday: 'short', month: 'short', day: 'numeric' })}`, 'tag'];
}

export function choreRow(c) {
  const today = ymd();
  const doneToday = c.lastDone === today;
  const r = roomOf(c);
  const [label, cls] = dueLabel(c);
  return h('div', { class: 'row chore-row' + (doneToday ? ' done' : '') },
    h('button', {
      type: 'button', class: 'check' + (doneToday ? ' on' : ''), 'aria-label': doneToday ? 'Undo' : `Mark ${c.name} done`,
      onclick: () => (doneToday ? undoDone(c) : markDone(c)),
    }),
    h('span', { class: `room-dot room-${r.color}`, title: c.room || '' }, r.emoji),
    h('div', { class: 'row-main', onclick: () => choreMenu(c) },
      h('div', { class: 'row-title' }, c.name),
      h('div', { class: 'row-meta' },
        h('span', { class: cls }, label),
        h('span', { class: 'row-sub' }, `↻ ${scheduleText(c).replace(/^Every /, '').replace(/^\w/, ch => ch.toLowerCase())} · ${Number(c.minutes) || 10} min`))),
    !doneToday ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Snooze ${c.name} to tomorrow`, title: 'Tomorrow', onclick: () => snooze(c, 1) }, '💤') : null);
}

function ring(score) {
  const r = 34, C = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 84 84'); svg.setAttribute('class', 'ring'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle cx="42" cy="42" r="${r}" class="ring-bg"/><circle cx="42" cy="42" r="${r}" class="ring-fg ${score < 45 ? 'low' : score < 70 ? 'mid' : ''}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - score / 100)}"/>`;
  return h('div', { class: 'ring-wrap' }, svg, h('div', { class: 'ring-num' }, h('b', {}, score), h('span', {}, '%')));
}

function hero(list) {
  const score = homeScore(list);
  const [emoji, word] = mood(score);
  const p = weekProgress();
  const s = streak(list);
  return h('section', { class: 'card clean-hero' },
    ring(score),
    h('div', { class: 'clean-hero-text' },
      h('p', { class: 'eyebrow' }, 'Home freshness'),
      h('h2', {}, `${emoji} ${word}`),
      h('div', { class: 'clean-stats' },
        h('span', {}, h('b', {}, `${p.done}/${p.total}`), ' this week'),
        h('span', {}, h('b', {}, `🔥 ${s}`), ` day${s === 1 ? '' : 's'}`),
        h('span', {}, h('b', {}, `⭐ ${pointsThisWeek(list)}`), ' pts')),
      h('button', { type: 'button', class: 'btn quick-btn', onclick: quickClean }, '⚡ Quick clean')));
}

function weekStrip(list) {
  const today = ymd();
  const { start } = weekOf(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dueOn = d => list.filter(c => {
    if (c.lastDone === d) return true;
    const due = dueDate(c);
    return d === today ? (due <= today) : due === d;
  });
  return h('div', { class: 'week-strip-wrap' },
    iconBtn('left', () => { selected = addDays(selected, -7); rr(); }, 'Previous week'),
    h('div', { class: 'week-strip' }, days.map(d => {
      const items = dueOn(d);
      const left = items.filter(c => c.lastDone !== d).length;
      const allDone = items.length && !left;
      const cls = ['wday'];
      if (d === selected) cls.push('sel');
      if (d === today) cls.push('today');
      if (d < today) cls.push('past');
      return h('button', { type: 'button', class: cls.join(' '), 'aria-label': `${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${left} to do`, onclick: () => { selected = d; rr(); } },
        h('span', { class: 'wday-name' }, fmtDay(d, { weekday: 'short' })),
        h('span', { class: 'wday-num' }, Number(d.slice(8))),
        h('span', { class: 'wday-dots' }, allDone ? '✓' : left ? '•'.repeat(Math.min(left, 3)) : ''));
    })),
    iconBtn('right', () => { selected = addDays(selected, 7); rr(); }, 'Next week'));
}

function roomsGrid(list) {
  const rooms = Object.keys(ROOMS).filter(n => list.some(c => c.room === n));
  if (list.some(c => !ROOMS[c.room])) rooms.push('');
  if (rooms.length < 2) return null;
  return h('div', {},
    h('div', { class: 'section-head' }, h('h2', { class: 'card-title' }, 'Rooms'), roomFilter !== '' ? btn('Show all', () => { roomFilter = ''; rr(); }, 'ghost sm') : null),
    h('div', { class: 'rooms' }, rooms.map(n => {
      const mine = list.filter(c => (n ? c.room === n : !ROOMS[c.room]));
      const score = avg(mine.map(c => freshness(c)));
      const r = ROOMS[n] || { emoji: '🧽', color: 'gray' };
      const late = mine.filter(c => dueDate(c) < ymd() && c.lastDone !== ymd()).length;
      return h('button', { type: 'button', class: `room-card room-${r.color}${roomFilter === n ? ' sel' : ''}`, onclick: () => { roomFilter = roomFilter === n ? '' : n; rr(); } },
        h('span', { class: 'room-emoji' }, r.emoji),
        h('span', { class: 'room-name' }, n || 'Anywhere'),
        h('span', { class: 'room-bar' }, h('i', { style: { width: score + '%' } })),
        h('span', { class: 'room-sub' }, late ? `${late} late` : `${score}% fresh`));
    })));
}

// ---- screen -------------------------------------------------------------------------------------------
export function render(root, ctx) {
  rr = ctx.rerender;
  const list = chores();
  root.append(pageHead('Cleaning', { actions: [addBtn('Chore', () => editChore(null))] }));

  if (list.length) {
    const today = ymd();
    const filtered = roomFilter === '' ? list : list.filter(c => (roomFilter ? c.room === roomFilter : !ROOMS[c.room]));
    root.append(hero(list));
    root.append(weekStrip(list));

    // the selected day: overdue ones show on today
    const forDay = filtered.filter(c => c.lastDone === selected || (selected === today ? dueDate(c) <= today : dueDate(c) === selected && c.lastDone !== selected))
      .sort((a, b) => (a.lastDone === selected) - (b.lastDone === selected) || dueDate(a).localeCompare(dueDate(b)));
    const dayTitle = selected === today ? 'Today' : fmtDay(selected, { weekday: 'long', month: 'short', day: 'numeric' });
    const mins = forDay.filter(c => c.lastDone !== selected).reduce((s, c) => s + (Number(c.minutes) || 10), 0);
    const split = h('div', { class: 'split' });
    split.append(card(dayTitle + (roomFilter !== '' ? ` · ${roomFilter || 'Anywhere'}` : ''), {
      action: mins ? h('span', { class: 'muted small' }, `about ${mins} min`) : null,
      cls: 'day-card',
    }, forDay.length ? forDay.map(choreRow)
      : empty(selected < today ? 'Nothing was due this day.' : selected === today ? '✨ Nothing due today. Enjoy it!' : 'Nothing due this day.')));

    // coming up: the next 14 days, by date
    const upcoming = filtered.filter(c => dueDate(c) > (selected > today ? selected : today) && dueDate(c) <= addDays(today, 14) && c.lastDone !== today)
      .sort((a, b) => dueDate(a).localeCompare(dueDate(b)));
    const dates = [...new Set(upcoming.map(dueDate))];
    split.append(card('Coming up', {}, dates.length ? dates.map(d => [
      h('p', { class: 'eyebrow day-sep' }, fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' })),
      upcoming.filter(c => dueDate(c) === d).map(choreRow),
    ]) : empty('Nothing else in the next two weeks.')));
    root.append(split);

    const rg = roomsGrid(list);
    if (rg) root.append(rg);
  } else {
    root.append(h('section', { class: 'card clean-empty' },
      h('div', { class: 'clean-empty-emoji' }, '🧼✨'),
      h('h2', {}, 'Let\'s build your cleaning routine'),
      h('p', { class: 'muted' }, 'Tap the chores below that you want to keep up with. Each one gets a due date, repeats on its own, and you can move it to any day.')));
  }

  const have = new Set(list.map(c => c.name.toLowerCase()));
  const ideas = STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  if (ideas.length && list.length < 14) {
    const rooms = [...new Set(ideas.map(s => s.room))];
    root.append(card(list.length ? 'Add more chores' : 'Pick your chores', {},
      rooms.map(rn => h('div', { class: 'starter-room' },
        h('p', { class: 'eyebrow' }, `${ROOMS[rn]?.emoji || ''} ${rn}`),
        h('div', { class: 'chip-row' }, ideas.filter(s => s.room === rn).map(s => btn(`${s.name} · ${(EVERY_LABEL[String(s.every)] || '').toLowerCase()}`,
          // spread new chores over the next few days so they don't all land today
          () => { store.save(COL, { ...s, day: '', startOn: addDays(ymd(), Math.min(chores().length % 4, s.every - 1)) }); toast(`Added "${s.name}"`); }, 'chip-btn'))))),
      h('div', { class: 'btn-row' }, btn('+ Make my own', () => editChore(null), 'ghost sm'))));
  }
}
