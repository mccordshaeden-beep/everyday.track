// calendar.js — month view, events (incl. repeating class schedules), and the
// tasks due on each day.
import * as store from '../store.js';
import { h, pageHead, card, empty, addBtn, btn, iconBtn, openForm, openSheet, toast, ymd, parseYmd, addDays, addMonths, fmtTime, relDay } from '../ui.js';
import { taskRow, renderTodo, editTask } from './tasks.js';
import { canShare, spaces, spaceById, spaceLabel, spaceIcon, shareOptions, resolveShare, sharedTag, moveTo } from '../share.js';

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

// Which calendars are showing: '' = My calendar, otherwise a shared space id.
const VIEW_ID = 'settings:calview';
const hiddenCals = () => (store.get(VIEW_ID) || {}).hidden || [];
const calOf = ev => store.householdOf(ev.id) || '';
export const visibleEvents = () => store.list(COL).filter(ev => !hiddenCals().includes(calOf(ev)));

export function eventsOn(d) {
  return visibleEvents().filter(ev => occursOn(ev, d))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

export function editEvent(ev, defaults = {}) {
  openForm({
    title: ev ? 'Edit event' : 'New event',
    values: ev ? { ...ev, cal: calOf(ev) } : { date: selected, repeat: '', kind: 'personal', cal: '', ...defaults },
    fields: [
      ...(canShare() ? [{ name: 'cal', label: 'Calendar', type: 'select', options: shareOptions('📅 My calendar (private)'), hint: 'Pick a person or your household to share this event with them.' }] : []),
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
    onSubmit: v => {
      const { cal, ...fields } = v;
      resolveShare(cal || '').then(hh => {
        if (hh === null) hh = ev ? calOf(ev) : '';
        if (!ev) { store.save(COL, fields, undefined, { hh }); return; }
        const id2 = moveTo(COL, { ...ev, ...fields }, hh);
        store.save(COL, fields, id2);
      });
    },
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
      (ev.location || calOf(ev)) ? h('div', { class: 'row-meta' }, calOf(ev) ? sharedTag(ev.id) : null, ev.location ? h('span', { class: 'row-sub' }, ev.location) : null) : null));
}

// ---- calendars bar (show/hide, share a calendar) --------------------------------------------
function calendarsBar(rerender) {
  if (!canShare()) return null;
  const hidden = hiddenCals();
  const toggle = id => { const now = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id]; store.save('settings', { hidden: now }, VIEW_ID); };
  const used = new Set(store.list(COL).map(calOf));
  const cals = [['', '📅 Mine'], ...spaces().filter(g => used.has(g.id)).map(g => [g.id, `${spaceIcon(g)} ${spaceLabel(g)}`])];
  return h('div', { class: 'cal-bar' },
    cals.length > 1 ? cals.map(([id, label]) => h('button', { type: 'button', class: 'chip' + (hidden.includes(id) ? '' : ' on'), 'aria-pressed': String(!hidden.includes(id)), onclick: () => toggle(id), title: hidden.includes(id) ? 'Hidden. Tap to show' : 'Showing. Tap to hide' }, label)) : null,
    h('button', { type: 'button', class: 'btn ghost sm', onclick: shareCalendar }, '👥 Share a calendar'));
}

function shareCalendar() {
  const mine = store.list(COL).filter(ev => !calOf(ev));
  openForm({
    title: 'Share a calendar',
    note: 'A shared calendar shows up for you and the other person (or your household). Anyone in it can add and edit its events. When you add an event, choose this calendar to put it there.',
    fields: [
      { name: 'who', label: 'Share with', type: 'select', options: shareOptions().filter(o => o[0] !== '') },
      { name: 'all', label: `Also move my ${mine.length} existing event${mine.length === 1 ? '' : 's'} onto it`, type: 'checkbox' },
    ],
    values: { who: spaces()[0]?.id || '__new', all: false },
    submitLabel: 'Share',
    onSubmit: v => {
      resolveShare(v.who).then(hh => {
        if (!hh) return;
        if (v.all) for (const ev of mine) moveTo(COL, ev, hh);
        toast(`Shared calendar with ${spaceLabel(spaceById(hh)) || 'them'} ✓`);
      });
    },
  });
}

function monthGrid(ctx) {
  const first = parseYmd(month + '-01');
  const gridStart = addDays(month + '-01', -first.getDay());
  const today = ymd();
  const events = visibleEvents();
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

let tab = 'calendar';
export function setTab(t) { tab = t === 'todo' ? 'todo' : 'calendar'; }

export function render(root, ctx) {
  const open = store.list('tasks').filter(t => !t.done && !t.classId).length;
  root.append(pageHead('Calendar', {
    actions: tab === 'todo' ? [addBtn('To-do', () => editTask(null))] : [
      btn('Today', () => { selected = ymd(); month = selected.slice(0, 7); ctx.rerender(); }, 'ghost'),
      addBtn('Event', () => editEvent(null)),
    ],
  }));
  root.append(h('div', { class: 'seg seg-main' }, [['calendar', '📅 Calendar'], ['todo', `☑ To-do${open ? ` (${open})` : ''}`]].map(([v, l]) =>
    h('button', { type: 'button', class: tab === v ? 'on' : '', onclick: () => { tab = v; ctx.rerender(); } }, l))));
  if (tab === 'todo') { renderTodo(root, ctx); return; }
  const cb = calendarsBar(ctx.rerender);
  if (cb) root.append(cb);

  const evs = eventsOn(selected);
  const due = store.list('tasks').filter(t => t.due === selected);
  const agenda = h('div', { class: 'stack' },
    card(relDay(selected) === 'Today' ? 'Today' : parseYmd(selected).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      { action: btn('+ Event', () => editEvent(null, { date: selected }), 'ghost sm') },
      evs.length ? evs.map(eventRow) : empty('Nothing scheduled.')),
    due.length ? card('Due this day', {}, due.map(taskRow)) : null);

  root.append(h('div', { class: 'split' }, monthGrid(ctx), agenda));
}
