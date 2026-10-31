// school.js — classes, assignments and grades. Assignments are saved as tasks
// (with a classId), so they also show up in Tasks, Calendar and Today.
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, openForm, toast, ymd, addDays, relDay, fmtTime } from '../ui.js';
import { toggleTask } from './tasks.js';
import { getStatus, callFunction } from '../sync.js';

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
        a.due ? h('span', { class: overdue ? 'tag red' : 'tag' }, relDay(a.due) + (a.dueTime && a.dueTime !== '23:59' ? ' ' + fmtTime(a.dueTime) : '')) : null)),
    graded ? h('div', { class: 'amt' }, `${Math.round((a.score / a.outOf) * 100)}%`, h('div', { class: 'amt-sub' }, `${a.score}/${a.outOf}`)) : null);
}

export const upcomingAssignments = (days = 7) => {
  const limit = ymd(new Date(Date.now() + days * 864e5));
  return assignments().filter(a => !a.done && a.due && a.due <= limit).sort((a, b) => a.due.localeCompare(b.due));
};


// ==== Canvas import =======================================================================
// Canvas gives every student a private calendar link (.ics). We download it through our
// server function (browsers can't fetch it directly), then turn assignments into School
// assignments and other calendar items into Calendar events. Re-importing updates titles
// and due dates but never touches what you've checked off or graded.
const CANVAS_ID = 'settings:canvas'; // { url, last, count }
const canvasCfg = () => store.get(CANVAS_ID) || {};

function unesc(v) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function icsDate(prop) {
  if (!prop) return null;
  const v = prop.val.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { date: ymd(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}
export function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [key, ...params] = line.slice(0, i).split(';');
      cur[key.toUpperCase()] = { val: line.slice(i + 1), params: params.join(';') };
    }
  }
  return out.map(e => ({
    uid: e.UID?.val || '', summary: unesc(e.SUMMARY?.val || ''), url: e.URL?.val || '',
    location: unesc(e.LOCATION?.val || ''), start: icsDate(e.DTSTART), end: icsDate(e.DTEND),
  })).filter(e => e.uid && e.start);
}

const guessKind = t => /quiz/i.test(t) ? 'Quiz' : /exam|midterm|final/i.test(t) ? 'Exam' : /project/i.test(t) ? 'Project'
  : /\blab\b/i.test(t) ? 'Lab' : /paper|essay/i.test(t) ? 'Paper' : /reading|discussion/i.test(t) ? 'Reading' : 'Homework';
const courseCode = s => { const m = s.match(/\b([A-Z]{2,5})[\s-]?(\d{4})\b/); return m ? `${m[1]} ${m[2]}` : ''; };

function findOrCreateClass(courseText) {
  const code = courseCode(courseText);
  const lower = courseText.toLowerCase();
  const hit = classes().find(c => (code && (c.code || '').replace(/[\s-]/g, '').toUpperCase() === code.replace(' ', ''))
    || (c.code && lower.includes(c.code.toLowerCase())) || (c.name && lower.includes(c.name.toLowerCase())));
  if (hit) return hit;
  const name = courseText.replace(/\b[A-Z]{2,5}[\s-]?\d{4}(-\d+)?\b/, '').replace(/\b(Fall|Spring|Summer|Winter)\s+\d{4}\b/i, '').replace(/[\s\-–:]+/g, ' ').trim() || courseText;
  const color = COLORS[classes().length % COLORS.length][0];
  const newId = store.save(CLASSES, { name, code: code || courseText.slice(0, 24), color, source: 'canvas' });
  return store.get(newId);
}

export function importICS(text) {
  const from = addDays(ymd(), -14), to = addDays(ymd(), 150);
  let added = 0, updated = 0, events = 0;
  for (const e of parseICS(text)) {
    if (e.start.date < from || e.start.date > to) continue;
    const id = 'cv:' + e.uid;
    if (store.known(id) && !store.get(id)) continue; // you deleted it; don't bring it back
    const m = e.summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const title = (m ? m[1] : e.summary).trim();
    const course = m ? m[2].trim() : '';
    const isAssignment = /assignment/i.test(e.uid) || /\/assignments\//.test(e.url);
    if (isAssignment) {
      const cls = course ? findOrCreateClass(course) : null;
      const existing = store.get(id);
      const fields = { title, due: e.start.date, dueTime: e.start.time, url: e.url, source: 'canvas' };
      if (cls) Object.assign(fields, { classId: cls.id, list: classLabel(cls) });
      if (!existing) {
        const kind = guessKind(title);
        Object.assign(fields, { kind, done: false, priority: ['Exam', 'Project'].includes(kind) ? 'high' : '' });
        if (!cls) fields.list = 'Canvas';
        added++;
      } else if (existing.title !== title || existing.due !== fields.due || existing.dueTime !== fields.dueTime) updated++;
      else continue;
      store.save(TASKS, fields, id);
    } else {
      const existing = store.get(id);
      const fields = { title: course ? `${title} (${courseCode(course) || course})` : title, date: e.start.date, start: e.start.time,
        end: e.end?.date === e.start.date ? e.end.time : '', location: e.location, kind: 'class', source: 'canvas' };
      if (existing && existing.title === fields.title && existing.date === fields.date && existing.start === fields.start) continue;
      store.save('events', fields, id);
      events++;
    }
  }
  return { added, updated, events };
}

export async function runCanvasImport(quiet = false) {
  const cfg = canvasCfg();
  if (!cfg.url) return null;
  const { ics } = await callFunction('canvas-feed', { url: cfg.url });
  const r = importICS(ics);
  store.save('settings', { last: new Date().toISOString(), lastResult: r }, CANVAS_ID);
  if (!quiet || r.added || r.updated) toast(r.added || r.updated || r.events ? `Canvas: ${r.added} new, ${r.updated} updated${r.events ? `, ${r.events} calendar items` : ''}` : 'Canvas: everything is up to date');
  return r;
}

/** Called when the app opens: refresh from Canvas at most every 6 hours. */
export function autoImportCanvas() {
  const cfg = canvasCfg();
  if (!cfg.url || !getStatus().user) return;
  if (cfg.last && Date.now() - new Date(cfg.last).getTime() < 6 * 3600e3) return;
  runCanvasImport(true).catch(e => console.warn('Canvas import failed', e));
}

function canvasSetup(rerender) {
  const cfg = canvasCfg();
  openForm({
    title: 'Import from Canvas',
    values: { url: cfg.url || '' },
    fields: [{ name: 'url', label: 'Your Canvas calendar feed link', type: 'url', required: true, autofocus: true, placeholder: 'https://….instructure.com/feeds/calendars/user_….ics',
      hint: 'In Canvas (website): Calendar → "Calendar Feed" (bottom right) → copy the link. It\'s private to you, so don\'t share it.' }],
    submitLabel: 'Import',
    onSubmit: v => {
      store.save('settings', { url: v.url }, CANVAS_ID);
      runCanvasImport().then(rerender).catch(e => { toast(e.message); });
    },
    onDelete: cfg.url ? () => store.save('settings', { url: '', last: '' }, CANVAS_ID) : null,
    deleteLabel: 'Stop importing from Canvas',
  });
}

function canvasBar(rerender) {
  const cfg = canvasCfg();
  if (!getStatus().configured) return null;
  if (!cfg.url) {
    return card('Import from Canvas', {},
      h('p', { class: 'muted' }, 'Pull your assignments and due dates in automatically. They update every few hours.'),
      h('ol', { class: 'steps-help' },
        h('li', {}, 'On a computer, open Canvas → Calendar.'),
        h('li', {}, 'Click "Calendar Feed" at the bottom right and copy the link.'),
        h('li', {}, 'Paste it here.')),
      h('div', { class: 'btn-row' }, btn('Paste Canvas link', () => canvasSetup(rerender), 'primary')));
  }
  return h('div', { class: 'canvas-bar' },
    h('span', { class: 'muted' }, `Canvas: ${cfg.last ? 'updated ' + relDay(cfg.last.slice(0, 10)).toLowerCase() + ' ' + new Date(cfg.last).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'not imported yet'}`),
    h('span', {},
      btn('Import now', () => { toast('Importing from Canvas…'); runCanvasImport().then(rerender).catch(e => toast(e.message)); }, 'ghost sm'),
      btn('Settings', () => canvasSetup(rerender), 'ghost sm')));
}

export function render(root, ctx) {
  root.append(pageHead('School', { actions: [addBtn('Assignment', () => editAssignment(null))] }));
  const cb = canvasBar(ctx.rerender);
  if (cb) root.append(cb);
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
