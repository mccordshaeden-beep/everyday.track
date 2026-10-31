// school.js — classes, assignments and grades. Assignments are saved as tasks
// (with a classId), so they also show up in Tasks, Calendar and Today.
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, openForm, ymd, relDay } from '../ui.js';
import { toggleTask } from './tasks.js';

export const id = 'school';
export const title = 'School';
export const glyph = 'school';

const CLASSES = 'classes'; // { name, code, instructor, room, color }
const TASKS = 'tasks';     // assignment = task + { classId, kind, score, outOf }
const KINDS = ['Homework', 'Quiz', 'Exam', 'Project', 'Paper', 'Lab', 'Reading', 'Other'];
const COLORS = [['blue', 'Blue'], ['green', 'Green'], ['orange', 'Orange'], ['purple', 'Purple'], ['red', 'Red'], ['teal', 'Teal']];
let view = 'upcoming';

export const classes = () => store.list(CLASSES).sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
const assignments = () => store.list(TASKS).filter(t => t.classId);
const classLabel = c => c.code || c.name;

function editClass(c) {
  openForm({
    title: c ? classLabel(c) : 'New class',
    values: c || { color: COLORS[classes().length % COLORS.length][0] },
    fields: [
      { name: 'name', label: 'Class name', required: true, autofocus: true, placeholder: 'Intro to Networking' },
      { name: 'code', label: 'Course code (short name)', placeholder: 'CYBR 3400' },
      { name: 'instructor', label: 'Instructor' },
      { name: 'room', label: 'Room / online' },
      { name: 'color', label: 'Color', type: 'select', options: COLORS },
    ],
    onSubmit: v => { store.save(CLASSES, v, c?.id); },
    onDelete: c ? () => {
      store.remove(c.id);
      assignments().filter(a => a.classId === c.id).forEach(a => store.remove(a.id));
    } : null,
    deleteLabel: 'Delete class and its assignments',
  });
}

export function editAssignment(a, defaults = {}) {
  const cls = classes();
  if (!cls.length) { editClass(null); return; }
  openForm({
    title: a ? 'Assignment' : 'New assignment',
    values: a || { classId: cls[0].id, kind: 'Homework', ...defaults },
    fields: [
      { name: 'title', label: 'Assignment', required: true, autofocus: true, placeholder: 'Lab 4, Chapter 6 quiz…' },
      { name: 'classId', label: 'Class', type: 'select', options: cls.map(c => [c.id, classLabel(c)]) },
      { name: 'kind', label: 'Type', type: 'select', options: KINDS },
      { name: 'due', label: 'Due date', type: 'date' },
      { name: 'score', label: 'Points earned (after it\'s graded)', type: 'number', step: 'any', inputmode: 'decimal' },
      { name: 'outOf', label: 'Out of', type: 'number', step: 'any', inputmode: 'decimal' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => {
      const c = cls.find(x => x.id === v.classId);
      const priority = ['Exam', 'Project'].includes(v.kind) ? 'high' : '';
      const graded = v.score !== '' && v.score != null;
      store.save(TASKS, {
        ...v, list: c ? classLabel(c) : '',
        ...(a ? {} : { done: false, priority }),
        ...(graded && !a?.done ? { done: true, doneAt: ymd() } : {}), // a grade means it's finished
      }, a?.id);
    },
    onDelete: a ? () => store.remove(a.id) : null,
  });
}

/** Grade % for a class from graded assignments (points earned ÷ points possible). */
export function classGrade(classId) {
  const graded = assignments().filter(a => a.classId === classId && a.score !== '' && a.score != null && Number(a.outOf) > 0);
  if (!graded.length) return null;
  const earned = graded.reduce((s, a) => s + Number(a.score), 0);
  const possible = graded.reduce((s, a) => s + Number(a.outOf), 0);
  return { pct: (earned / possible) * 100, count: graded.length };
}
const letter = p => p >= 93 ? 'A' : p >= 90 ? 'A-' : p >= 87 ? 'B+' : p >= 83 ? 'B' : p >= 80 ? 'B-' : p >= 77 ? 'C+' : p >= 73 ? 'C' : p >= 70 ? 'C-' : p >= 60 ? 'D' : 'F';

function assignmentRow(a, showClass = true) {
  const c = store.get(a.classId);
  const overdue = a.due && a.due < ymd() && !a.done;
  const graded = a.score !== '' && a.score != null && Number(a.outOf) > 0;
  return h('div', { class: 'row' + (a.done ? ' done' : '') },
    h('button', { type: 'button', class: 'check' + (a.done ? ' on' : ''), 'aria-label': a.done ? 'Mark not done' : 'Mark done', onclick: () => toggleTask(a) }),
    h('div', { class: 'row-main', onclick: () => editAssignment(a) },
      h('div', { class: 'row-title' }, a.title),
      h('div', { class: 'row-meta' },
        showClass && c ? h('span', { class: `tag cls-${c.color || 'blue'}` }, classLabel(c)) : null,
        h('span', { class: 'tag' }, a.kind || 'Homework'),
        a.due ? h('span', { class: overdue ? 'tag red' : 'tag' }, relDay(a.due)) : null)),
    graded ? h('div', { class: 'amt' }, `${Math.round((a.score / a.outOf) * 100)}%`, h('div', { class: 'amt-sub' }, `${a.score}/${a.outOf}`)) : null);
}

export const upcomingAssignments = (days = 7) => {
  const limit = ymd(new Date(Date.now() + days * 864e5));
  return assignments().filter(a => !a.done && a.due && a.due <= limit).sort((a, b) => a.due.localeCompare(b.due));
};

export function render(root, ctx) {
  root.append(pageHead('School', { actions: [addBtn('Assignment', () => editAssignment(null))] }));
  const cls = classes();
  if (!cls.length) {
    root.append(card('Add your classes', {},
      h('p', { class: 'muted' }, 'Add each class once. Then add assignments, exams and projects with due dates. They\'ll show up in Tasks and on your Today screen, and you can track your grades.'),
      h('div', { class: 'btn-row' }, btn('Add a class', () => editClass(null), 'primary'))));
    return;
  }
  root.append(seg([['upcoming', 'Upcoming'], ['classes', 'Classes & grades'], ['done', 'Done']], view, v => { view = v; ctx.rerender(); }));

  if (view === 'upcoming') {
    const open = assignments().filter(a => !a.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const today = ymd();
    const groups = [
      ['Overdue', open.filter(a => a.due && a.due < today)],
      ['Next 7 days', open.filter(a => a.due && a.due >= today && a.due <= ymd(new Date(Date.now() + 7 * 864e5)))],
      ['Later', open.filter(a => !a.due || a.due > ymd(new Date(Date.now() + 7 * 864e5)))],
    ].filter(([, l]) => l.length);
    root.append(groups.length ? h('div', { class: 'stack' }, groups.map(([name, l]) => card(name, { cls: name === 'Overdue' ? 'warn' : '' }, l.map(a => assignmentRow(a)))))
      : empty('Nothing due. Add assignments with the button above.'));
    return;
  }

  if (view === 'done') {
    const done = assignments().filter(a => a.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    root.append(card('Finished', {}, done.length ? done.slice(0, 100).map(a => assignmentRow(a)) : empty('Nothing finished yet.')));
    return;
  }

  root.append(h('div', { class: 'grid' },
    cls.map(c => {
      const g = classGrade(c.id);
      const mine = assignments().filter(a => a.classId === c.id);
      const open = mine.filter(a => !a.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      return h('section', { class: `card class-card cls-border-${c.color || 'blue'}` },
        h('div', { class: 'card-head' },
          h('button', { type: 'button', class: 'card-title link', onclick: () => editClass(c) }, classLabel(c)),
          g ? h('span', { class: 'grade' }, `${letter(g.pct)} · ${g.pct.toFixed(1)}%`) : h('span', { class: 'muted small' }, 'No grades yet')),
        c.code && c.name ? h('p', { class: 'row-sub' }, c.name, c.instructor ? ` · ${c.instructor}` : '', c.room ? ` · ${c.room}` : '') : null,
        open.length ? open.slice(0, 5).map(a => assignmentRow(a, false)) : empty('No open assignments.'),
        h('div', { class: 'btn-row' }, btn('+ Assignment', () => editAssignment(null, { classId: c.id }), 'ghost sm')));
    }),
    h('section', { class: 'card add-card' }, btn('+ Add a class', () => editClass(null), 'ghost'))));
}
