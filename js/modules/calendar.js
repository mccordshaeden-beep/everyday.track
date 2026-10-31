// calendar.js — month view, events (incl. repeating class schedules), and the
// tasks due on each day.
import * as store from '../store.js';
import { h, pageHead, card, empty, addBtn, btn, iconBtn, openForm, ymd, parseYmd, addDays, addMonths, fmtTime, relDay } from '../ui.js';
import { taskRow } from './tasks.js';

export const id = 'calendar';
export const title = 'Calendar';
export const glyph = 'calendar';

const COL = 'events';
const KINDS = [['class', 'Class'], ['work', 'Work'], ['personal', 'Personal'], ['other', 'Other']];
let month = ymd().slice(0, 7); // "YYYY-MM"
let selected = ymd();

/** Does this event happen on date d ("YYYY-MM-DD")? Handles repeats. */
export function occursOn(ev, d) {
  if (!ev.date || d < ev.date) return false;
  if (ev.until && d > ev.until) return false;
  const day = parseYmd(d), start = parseYmd(ev.date);
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekly': {
      const days = ev.days?.length ? ev.days : [start.getDay()];
      return days.includes(day.getDay());
    }
    case 'monthly': return day.getDate() === start.getDate();
    case 'yearly': return d.slice(5) === ev.date.slice(5);
    default: return d === ev.date;
  }
}

export function eventsOn(d) {
  return store.list(COL).filter(ev => occursOn(ev, d))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

export function editEvent(ev, defaults = {}) {
  openForm({
    title: ev ? 'Edit event' : 'New event',
    values: ev || { date: selected, repeat: '', kind: 'personal', ...defaults },
    fields: [
      { name: 'title', label: 'Title', required: true, autofocus: true, placeholder: 'Class, work shift, dinner…' },
      { name: 'date', label: 'Date (first day, if it repeats)', type: 'date', required: true },
      { name: 'start', label: 'Start time (blank = all day)', type: 'time' },
      { name: 'end', label: 'End time', type: 'time' },
      { name: 'location', label: 'Location' },
      { name: 'kind', label: 'Type', type: 'select', options: KINDS },
      { name: 'repeat', label: 'Repeats', type: 'select', options: [['', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']] },
      { name: 'days', label: 'On these days (weekly repeats)', type: 'weekdays', hint: 'e.g. M W F for a class' },
      { name: 'until', label: 'Repeat until (optional)', type: 'date', hint: 'Set to the last day of the semester for classes' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => { store.save(COL, v, ev?.id); },
    onDelete: ev ? () => store.remove(ev.id) : null,
    deleteLabel: ev?.repeat ? 'Delete all repeats' : 'Delete',
  });
}

export function eventRow(ev) {
  return h('div', { class: 'row', onclick: () => editEvent(ev) },
    h('div', { class: 'ev-time' }, ev.start ? fmtTime(ev.start) : 'All day',
      ev.end ? h('small', {}, fmtTime(ev.end)) : null),
    h('span', { class: `kind-bar k-${ev.kind || 'other'}` }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, ev.title),
      ev.location ? h('div', { class: 'row-sub' }, ev.location) : null));
}

function monthGrid(ctx) {
  const first = parseYmd(month + '-01');
  const gridStart = addDays(month + '-01', -first.getDay());
  const today = ymd();
  const events = store.list(COL);
  const tasks = store.list('tasks').filter(t => !t.done && t.due);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const evs = events.filter(ev => occursOn(ev, d));
    const hasTask = tasks.some(t => t.due === d);
    const cls = ['day'];
    if (d.slice(0, 7) !== month) cls.push('other-month');
    if (d === today) cls.push('today');
    if (d === selected) cls.push('selected');
    cells.push(h('button', {
      type: 'button', class: cls.join(' '), 'aria-label': relDay(d),
      onclick: () => { selected = d; if (d.slice(0, 7) !== month) month = d.slice(0, 7); ctx.rerender(); },
    },
    h('span', { class: 'num' }, Number(d.slice(8))),
    h('span', { class: 'dots' },
      evs.slice(0, 3).map(ev => h('i', { class: `k-${ev.kind || 'other'}` })),
      hasTask ? h('i', { class: 'task-dot' }) : null)));
  }
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return h('section', { class: 'card cal-card' },
    h('div', { class: 'cal-head' },
      iconBtn('left', () => { month = addMonths(month + '-01', -1).slice(0, 7); ctx.rerender(); }, 'Previous month'),
      h('h2', {}, label),
      iconBtn('right', () => { month = addMonths(month + '-01', 1).slice(0, 7); ctx.rerender(); }, 'Next month')),
    h('div', { class: 'cal' },
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(l => h('span', { class: 'dow' }, l)),
      cells));
}

export function render(root, ctx) {
  root.append(pageHead('Calendar', {
    actions: [
      btn('Today', () => { selected = ymd(); month = selected.slice(0, 7); ctx.rerender(); }, 'ghost'),
      addBtn('Event', () => editEvent(null)),
    ],
  }));

  const evs = eventsOn(selected);
  const due = store.list('tasks').filter(t => t.due === selected);
  const agenda = h('div', { class: 'stack' },
    card(relDay(selected) === 'Today' ? 'Today' : parseYmd(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      { action: btn('+ Event', () => editEvent(null, { date: selected }), 'ghost sm') },
      evs.length ? evs.map(eventRow) : empty('Nothing scheduled.')),
    due.length ? card('Due this day', {}, due.map(taskRow)) : null);

  root.append(h('div', { class: 'split' }, monthGrid(ctx), agenda));
}
