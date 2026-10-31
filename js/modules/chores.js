// chores.js — cleaning schedule. Each chore repeats every N days; checking it off
// schedules the next one. "This week" shows what to do to stay on top of things.
import * as store from '../store.js';
import { h, pageHead, card, empty, addBtn, btn, openForm, bar, ymd, addDays, daysBetween, relDay, parseYmd, toast } from '../ui.js';

export const id = 'chores';
export const title = 'Cleaning';
export const glyph = 'clean';

const COL = 'chores'; // { name, room, every (days), lastDone, startOn, history: [dates] }
const EVERY = [['1', 'Every day'], ['2', 'Every 2 days'], ['3', 'Twice a week'], ['7', 'Every week'], ['14', 'Every 2 weeks'], ['30', 'Every month'], ['90', 'Every 3 months'], ['182', 'Every 6 months']];
const EVERY_LABEL = Object.fromEntries(EVERY);
const ROOMS = ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Laundry', 'Whole place', 'Outside', 'Car'];

const STARTERS = [
  { name: 'Clean bathroom (toilet, sink, mirror)', room: 'Bathroom', every: 7 },
  { name: 'Wipe kitchen counters & stove', room: 'Kitchen', every: 3 },
  { name: 'Vacuum / sweep floors', room: 'Whole place', every: 7 },
  { name: 'Laundry', room: 'Laundry', every: 7 },
  { name: 'Take out trash & recycling', room: 'Kitchen', every: 3 },
  { name: 'Change bed sheets', room: 'Bedroom', every: 14 },
  { name: 'Mop floors', room: 'Whole place', every: 14 },
  { name: 'Clean out fridge', room: 'Kitchen', every: 30 },
  { name: 'Dust surfaces', room: 'Whole place', every: 14 },
  { name: 'Shower & tub scrub', room: 'Bathroom', every: 14 },
  { name: 'Wash towels', room: 'Laundry', every: 7 },
  { name: 'Clean microwave & oven', room: 'Kitchen', every: 30 },
];

export const chores = () => store.list(COL);

/** When it's due next: last time done + interval (or the start date if never done). */
export function dueDate(c) {
  const every = Number(c.every) || 7;
  if (c.lastDone) return addDays(c.lastDone, every);
  return c.startOn || (c.created || ymd()).slice(0, 10);
}

/** Monday–Sunday of the week containing `d`. */
function weekOf(d = ymd()) {
  const day = parseYmd(d).getDay(); // 0 = Sun
  const start = addDays(d, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export function dueThisWeek() {
  const { end } = weekOf();
  return chores().filter(c => dueDate(c) <= end);
}

export function markDone(c) {
  const today = ymd();
  const history = [today, ...(c.history || []).filter(d => d !== today)].slice(0, 30);
  store.save(COL, { lastDone: today, history }, c.id);
  toast(`Nice! Next: ${relDay(addDays(today, Number(c.every) || 7))}`);
}

function undoDone(c) {
  const history = (c.history || []).slice(1);
  store.save(COL, { lastDone: history[0] || '', history }, c.id);
}

function editChore(c) {
  openForm({
    title: c ? 'Edit chore' : 'New chore',
    values: c ? { ...c, every: String(c.every) } : { every: '7', startOn: ymd() },
    fields: [
      { name: 'name', label: 'Chore', required: true, autofocus: true, placeholder: 'Clean bathroom, vacuum…' },
      { name: 'room', label: 'Room / area', suggestions: ROOMS },
      { name: 'every', label: 'How often', type: 'select', options: EVERY },
      { name: 'startOn', label: c?.lastDone ? 'First due (ignored once you\'ve done it)' : 'First due', type: 'date' },
    ],
    onSubmit: v => { store.save(COL, { ...v, every: Number(v.every) }, c?.id); },
    onDelete: c ? () => store.remove(c.id) : null,
  });
}

export function choreRow(c) {
  const today = ymd();
  const doneToday = c.lastDone === today;
  const due = dueDate(c);
  const days = daysBetween(today, due);
  const label = doneToday ? 'Done today' : days < 0 ? `Overdue ${-days} day${days === -1 ? '' : 's'}` : days === 0 ? 'Due today' : `Due ${relDay(due)}`;
  return h('div', { class: 'row' + (doneToday ? ' done' : '') },
    h('button', {
      type: 'button', class: 'check' + (doneToday ? ' on' : ''), 'aria-label': doneToday ? 'Undo' : 'Mark done',
      onclick: () => (doneToday ? undoDone(c) : markDone(c)),
    }),
    h('div', { class: 'row-main', onclick: () => editChore(c) },
      h('div', { class: 'row-title' }, c.name),
      h('div', { class: 'row-meta' },
        h('span', { class: !doneToday && days < 0 ? 'tag red' : 'tag' }, label),
        c.room ? h('span', { class: 'tag' }, c.room) : null,
        h('span', { class: 'tag' }, '↻ ' + (EVERY_LABEL[String(c.every)] || `every ${c.every} days`).replace(/^Every /, '')))));
}

/** "4 of 7 done this week" — counts chores due this week plus ones finished this week. */
export function weekProgress() {
  const { start, end } = weekOf();
  const list = chores();
  const doneThisWeek = list.filter(c => (c.history || []).some(d => d >= start && d <= end));
  const stillDue = list.filter(c => dueDate(c) <= end && !doneThisWeek.includes(c));
  return { done: doneThisWeek.length, total: doneThisWeek.length + stillDue.length };
}

export function render(root, ctx) {
  root.append(pageHead('Cleaning', { actions: [addBtn('Chore', () => editChore(null))] }));
  const list = chores();
  const today = ymd();
  const { end } = weekOf();

  if (list.length) {
    const p = weekProgress();
    root.append(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'This week'), h('span', { class: 'muted' }, `${p.done} of ${p.total} done`)),
      bar(p.done, p.total || 1),
      h('p', { class: 'row-sub', style: { marginTop: '8px' } },
        p.total && p.done >= p.total ? '✨ All caught up for the week!' : 'Check things off as you go. Each one reschedules itself.')));

    const byDue = (a, b) => dueDate(a).localeCompare(dueDate(b));
    const overdue = list.filter(c => dueDate(c) < today && c.lastDone !== today).sort(byDue);
    const thisWeek = list.filter(c => (dueDate(c) >= today && dueDate(c) <= end) || c.lastDone === today).sort(byDue);
    const later = list.filter(c => dueDate(c) > end && c.lastDone !== today).sort(byDue);
    const wrap = h('div', { class: 'stack' });
    if (overdue.length) wrap.append(card('Overdue', { cls: 'warn' }, overdue.map(choreRow)));
    wrap.append(card('Due this week', {}, thisWeek.length ? thisWeek.map(choreRow) : empty('Nothing else due this week.')));
    if (later.length) wrap.append(card('Coming up', {}, later.map(choreRow)));
    root.append(wrap);
  }

  const have = new Set(list.map(c => c.name.toLowerCase()));
  const ideas = STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  if (ideas.length && list.length < 12) {
    root.append(card(list.length ? 'Add more' : 'Build your cleaning schedule', {},
      h('p', { class: 'muted' }, 'Tap to add. You can change how often any time.'),
      h('div', { class: 'chip-row' }, ideas.map(s => btn(`${s.name} · ${(EVERY_LABEL[String(s.every)] || '').toLowerCase()}`,
        // spread new chores across the coming days so they don't all land today
        () => store.save(COL, { ...s, startOn: addDays(ymd(), Math.min(chores().length % 4, s.every - 1)) }), 'chip-btn')))));
  }
}
