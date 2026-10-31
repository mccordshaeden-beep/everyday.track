// tasks.js — to-do list with due dates, lists (School, Work…) and priority.
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, icon, openForm, ymd, addDays, relDay } from '../ui.js';

export const id = 'tasks';
export const title = 'Tasks';
export const glyph = 'tasks'; // which icon to show in the menu (see ICONS in ui.js)

const COL = 'tasks';
let view = 'open';

const listNames = () => [...new Set(store.list(COL).map(t => t.list).filter(Boolean))].sort();

export function editTask(task, defaults = {}) {
  openForm({
    title: task ? 'Edit task' : 'New task',
    values: task || defaults,
    fields: [
      { name: 'title', label: 'Task', required: true, autofocus: true, placeholder: 'What needs doing?' },
      { name: 'due', label: 'Due date', type: 'date' },
      { name: 'list', label: 'List', suggestions: ['School', 'Work', 'Home', ...listNames()], placeholder: 'School, Work, Home…' },
      { name: 'priority', label: 'Priority', type: 'select', options: [['', 'Normal'], ['high', 'High'], ['low', 'Low']] },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    onSubmit: v => { store.save(COL, task ? v : { ...v, done: false }, task?.id); },
    onDelete: task ? () => store.remove(task.id) : null,
  });
}

export function toggleTask(t) {
  store.save(COL, { done: !t.done, doneAt: !t.done ? ymd() : '' }, t.id);
}

export function taskRow(t) {
  const overdue = t.due && t.due < ymd() && !t.done;
  return h('div', { class: 'row' + (t.done ? ' done' : '') },
    h('button', {
      type: 'button', class: 'check' + (t.done ? ' on' : ''),
      'aria-label': t.done ? 'Mark not done' : 'Mark done', onclick: () => toggleTask(t),
    }),
    h('div', { class: 'row-main', onclick: () => editTask(t) },
      h('div', { class: 'row-title' }, t.priority === 'high' ? h('span', { class: 'pri' }, '!') : null, t.title),
      (t.due || t.list) ? h('div', { class: 'row-meta' },
        t.due ? h('span', { class: overdue ? 'tag red' : 'tag' }, relDay(t.due)) : null,
        t.list ? h('span', { class: 'tag' }, t.list) : null) : null));
}

/** "Read ch. 4 tomorrow" → { title: 'Read ch. 4', due: <tomorrow> } */
export function parseQuick(text, fallbackDue = '') {
  const m = text.match(/\s+(today|tod|tomorrow|tmrw|tmr)$/i);
  if (!m) return { title: text, due: fallbackDue };
  const word = m[1].toLowerCase();
  return { title: text.slice(0, m.index).trim(), due: word.startsWith('tod') ? ymd() : addDays(ymd(), 1) };
}

export function quickAdd({ key = 'task-quick', due = '', placeholder = 'Add a task… (end with "tomorrow" to set a date)' } = {}) {
  const input = h('input', { type: 'text', placeholder, 'data-fk': key, enterkeyhint: 'done', 'aria-label': 'New task' });
  return h('form', {
    class: 'quick',
    onsubmit: e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      store.save(COL, { ...parseQuick(text, due), done: false, priority: '' });
    },
  }, input, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add task' }, icon('plus', 20)));
}

const byPriority = (a, b) => (b.priority === 'high') - (a.priority === 'high') || (a.priority === 'low') - (b.priority === 'low');

export function render(root, ctx) {
  const today = ymd();
  const all = store.list(COL);
  root.append(pageHead('Tasks', { actions: [addBtn('New', () => editTask(null))] }));
  root.append(seg([['open', `To do (${all.filter(t => !t.done).length})`], ['done', 'Done']], view, v => { view = v; ctx.rerender(); }));

  if (view === 'done') {
    const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    root.append(card('Completed', {
      action: done.length ? btn('Clear all', () => {
        if (confirm(`Delete ${done.length} completed task(s)?`)) done.forEach(t => store.remove(t.id));
      }, 'ghost sm') : null,
    }, done.length ? done.slice(0, 100).map(taskRow) : empty('Nothing finished yet. You got this.')));
    return;
  }

  root.append(quickAdd());
  const open = all.filter(t => !t.done);
  const groups = [
    ['Overdue', open.filter(t => t.due && t.due < today)],
    ['Today', open.filter(t => t.due === today)],
    ['Upcoming', open.filter(t => t.due && t.due > today)],
    ['Someday', open.filter(t => !t.due)],
  ];
  let shown = 0;
  const wrap = h('div', { class: 'stack' });
  for (const [name, list] of groups) {
    if (!list.length) continue;
    shown += list.length;
    list.sort((a, b) => (a.due || '').localeCompare(b.due || '') || byPriority(a, b));
    wrap.append(card(name, { cls: name === 'Overdue' ? 'warn' : '' }, list.map(taskRow)));
  }
  root.append(shown ? wrap : empty('No tasks. Add one above.'));
}
