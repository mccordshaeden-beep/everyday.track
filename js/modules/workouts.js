// workouts.js — log workouts and see progress per exercise.
// Exercises are typed one per line, e.g. "Bench press 3x8 135" or "Run 2 miles".
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, openForm, barChart, ymd, relDay, fmtDay } from '../ui.js';

export const id = 'workouts';
export const title = 'Workouts';
export const glyph = 'workout';

const COL = 'workouts'; // { date, title, minutes, exercises (text, one per line), notes }
let view = 'log';
let picked = '';

/** "Bench press 3x8 135" → { name, sets, reps, weight } */
export function parseLine(line) {
  const s = line.trim();
  const m = s.match(/^(.*?)\s+(\d+)\s*[x×]\s*(\d+)(?:\s*(?:@|at)?\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)?)?\s*$/i);
  if (m) return { name: m[1].trim(), sets: +m[2], reps: +m[3], weight: m[4] ? +m[4] : null, unit: m[5] || '' };
  return { name: s, sets: null, reps: null, weight: null, text: s };
}
const exLines = w => String(w.exercises || '').split('\n').map(l => l.trim()).filter(Boolean);
const keyOf = n => n.toLowerCase().replace(/\s+/g, ' ').trim();

function editWorkout(w, defaults = {}) {
  openForm({
    title: w ? 'Workout' : 'Log a workout',
    values: w || { date: ymd(), ...defaults },
    fields: [
      { name: 'title', label: 'Workout', required: true, autofocus: true, placeholder: 'Push day, legs, run…', suggestions: [...new Set(store.list(COL).map(x => x.title))] },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'minutes', label: 'Minutes', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'exercises', label: 'Exercises (one per line)', type: 'textarea', rows: 7, placeholder: 'Bench press 3x8 135\nIncline dumbbell 3x10 40\nPush-ups 3x15\nRun 2 miles', hint: 'Write sets×reps then the weight, e.g. "Squat 5x5 185", to track progress.' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => { store.save(COL, v, w?.id); },
    onDelete: w ? () => store.remove(w.id) : null,
  });
}

function workoutCard(w) {
  const ex = exLines(w).map(parseLine);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('button', { type: 'button', class: 'card-title link', onclick: () => editWorkout(w) }, w.title),
      h('span', { class: 'muted small' }, relDay(w.date), w.minutes ? ` · ${w.minutes} min` : '')),
    ex.length ? h('ul', { class: 'ex-list' }, ex.map(e => h('li', {},
      h('span', {}, e.name),
      e.sets ? h('span', { class: 'muted' }, `${e.sets}×${e.reps}${e.weight != null ? ` · ${e.weight}${e.unit ? ' ' + e.unit : ''}` : ''}`) : null))) : null,
    w.notes ? h('p', { class: 'row-sub' }, w.notes) : null,
    h('div', { class: 'btn-row' }, btn('Do again today', () => editWorkout(null, { title: w.title, exercises: w.exercises, minutes: w.minutes }), 'ghost sm')));
}

/** Every logged set of each exercise, newest first. */
function history() {
  const map = new Map();
  for (const w of store.list(COL)) {
    for (const e of exLines(w).map(parseLine)) {
      const k = keyOf(e.name);
      if (!map.has(k)) map.set(k, { name: e.name, entries: [] });
      map.get(k).entries.push({ ...e, date: w.date });
    }
  }
  for (const v of map.values()) v.entries.sort((a, b) => b.date.localeCompare(a.date));
  return [...map.values()].sort((a, b) => b.entries[0].date.localeCompare(a.entries[0].date));
}

function renderProgress(root) {
  const all = history();
  if (!all.length) { root.append(empty('Log a few workouts and your progress for each exercise shows up here.')); return; }
  if (!picked || !all.some(x => keyOf(x.name) === picked)) picked = keyOf(all[0].name);
  const sel = h('select', { 'aria-label': 'Exercise', onchange: e => { picked = e.target.value; rr(); } }, all.map(x => h('option', { value: keyOf(x.name) }, x.name)));
  sel.value = picked;
  root.append(sel);
  const ex = all.find(x => keyOf(x.name) === picked);
  const weighted = ex.entries.filter(e => e.weight != null);
  const best = weighted.reduce((m, e) => Math.max(m, e.weight), 0);
  const last = ex.entries[0];
  root.append(h('div', { class: 'stat-row' },
    h('div', { class: 'stat' }, h('b', {}, String(ex.entries.length)), h('span', {}, 'times logged')),
    h('div', { class: 'stat' }, h('b', {}, best ? String(best) : '—'), h('span', {}, 'best weight')),
    h('div', { class: 'stat' }, h('b', {}, relDay(last.date)), h('span', {}, 'last time'))));
  if (weighted.length >= 2) {
    const pts = weighted.slice(0, 8).reverse();
    root.append(card('Weight over time', {}, barChart(pts.map((e, i) => ({ label: fmtDay(e.date, { month: 'numeric', day: 'numeric' }), value: e.weight, highlight: i === pts.length - 1 })), { caption: 'Tap a bar to see that day.' })));
  }
  root.append(card('History', {}, ex.entries.slice(0, 30).map(e => h('div', { class: 'row compact' },
    h('span', { class: 'slot' }, fmtDay(e.date, { month: 'short', day: 'numeric' })),
    h('div', { class: 'row-main' }, e.sets ? `${e.sets}×${e.reps}${e.weight != null ? ` @ ${e.weight}${e.unit ? ' ' + e.unit : ''}` : ''}` : e.text)))));
}

let rr = () => {};
export function render(root, ctx) {
  rr = ctx.rerender;
  root.append(pageHead('Workouts', { actions: [addBtn('Workout', () => editWorkout(null))] }));
  root.append(seg([['log', 'Log'], ['progress', 'Progress']], view, v => { view = v; rr(); }));
  if (view === 'progress') { renderProgress(root); return; }
  const list = store.list(COL).sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
  const weekAgo = ymd(new Date(Date.now() - 6 * 864e5));
  const thisWeek = list.filter(w => w.date >= weekAgo).length;
  if (list.length) root.append(h('p', { class: 'muted' }, `${thisWeek} workout${thisWeek === 1 ? '' : 's'} in the last 7 days`));
  root.append(list.length ? h('div', { class: 'grid' }, list.slice(0, 40).map(workoutCard))
    : empty('No workouts yet. Tap "Workout" to log one. Write exercises like "Squat 5x5 185" to track progress over time.'));
}
