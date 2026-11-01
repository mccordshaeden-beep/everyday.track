// workouts.js — training: your goal (bulk / maintain / shred), workout plans you build or
// pick from a library, guided sessions that tell you when to add weight, an exercise
// library by equipment, a calisthenics section, and progress charts.
import * as store from '../store.js';
import {
  h, pageHead, card, empty, seg, addBtn, btn, iconBtn, icon, openForm, openSheet, barChart, toast,
  ymd, addDays, relDay, fmtDay,
} from '../ui.js';
import { EXERCISES, EX, EQUIP_GROUPS, MUSCLES, PLANS, CALI_PLANS, CALI_SKILLS, CALI_GUIDE } from '../data/exercises.js';

export const id = 'workouts';
export const title = 'Workouts';
export const glyph = 'workout';

const COL = 'workouts';   // sessions: { date, title, planId, day, minutes, sets: [{ ex, name, lo, hi, hold, sets: [{ w, r }] }], exercises (text), notes }
const PLANS_COL = 'plans'; // { name, desc, group, days: [{ name, items: [[exId, sets, lo, hi]] }], active, fromId }
const FIT_ID = 'settings:fitness'; // { goal, units, weight, heightFt, heightIn, age, sex, activity, syncFood }
const CALI_ID = 'settings:cali';   // { [skillId]: levelIndex }

let view = 'train';
let picked = '';
let editId = '';
let libEquip = 'all', libMuscle = '', libQuery = '';
let rr = () => {};
export function setTab(t) { view = t; }

// ---- goal & food targets -------------------------------------------------------------------
export const GOALS = {
  bulk: { label: 'Bulk', emoji: '💪', blurb: 'Build muscle', rest: '2–3 min on big lifts, 90 sec on small ones', extraSet: true,
    tip: 'Eat a small surplus, push to add reps and weight every week or two, and get 7–9 hours of sleep.' },
  maintain: { label: 'Maintain', emoji: '⚖️', blurb: 'Stay where you are, get stronger', rest: '90 sec – 2 min',
    tip: 'Eat around maintenance and keep progressing slowly.' },
  shred: { label: 'Shred', emoji: '🔥', blurb: 'Lose fat, keep muscle', rest: '60–90 sec',
    tip: 'Keep lifting heavy so your body keeps its muscle. Holding your strength while cutting is a win. Protein high, deficit moderate.' },
};
export const fitness = () => ({ goal: 'maintain', units: 'lb', syncFood: true, activity: '1.55', ...(store.get(FIT_ID) || {}) });
const U = () => fitness().units || 'lb';

/** Estimated daily calories & protein (Mifflin–St Jeor × activity, then ± for the goal). */
export function foodTargets(f = fitness()) {
  const lb = Number(f.weight); if (!lb) return null;
  const kg = U() === 'kg' ? lb : lb * 0.4536;
  const cm = (Number(f.heightFt) || 0) * 30.48 + (Number(f.heightIn) || 0) * 2.54;
  const age = Number(f.age) || 25;
  if (!cm) return null;
  const sexAdj = f.sex === 'male' ? 5 : f.sex === 'female' ? -161 : -78;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + sexAdj;
  const tdee = bmr * (Number(f.activity) || 1.55);
  const adj = { bulk: 300, maintain: 0, shred: -500 }[f.goal] ?? 0;
  const calories = Math.round(Math.max(bmr, tdee + adj) / 10) * 10;
  const lbs = kg / 0.4536;
  const protein = Math.round(lbs * (f.goal === 'shred' ? 1.0 : 0.8) / 5) * 5;
  return { calories, protein, tdee: Math.round(tdee / 10) * 10 };
}

function editGoal() {
  const f = fitness();
  openForm({
    title: 'Your goal',
    values: { ...f, syncFood: f.syncFood !== false },
    fields: [
      { name: 'goal', label: 'Goal', type: 'select', options: Object.entries(GOALS).map(([k, g]) => [k, `${g.emoji} ${g.label}: ${g.blurb}`]) },
      { name: 'units', label: 'Weight units', type: 'select', options: [['lb', 'Pounds (lb)'], ['kg', 'Kilograms (kg)']] },
      { name: 'weight', label: 'Body weight (for food targets)', type: 'number', min: '50', step: '0.1', inputmode: 'decimal' },
      { name: 'heightFt', label: 'Height (feet)', type: 'number', min: '3', max: '8', step: '1', inputmode: 'numeric' },
      { name: 'heightIn', label: 'Height (inches)', type: 'number', min: '0', max: '11', step: '1', inputmode: 'numeric' },
      { name: 'age', label: 'Age', type: 'number', min: '13', max: '100', step: '1', inputmode: 'numeric' },
      { name: 'sex', label: 'Sex (used in the calorie formula)', type: 'select', options: [['', 'Prefer not to say'], ['male', 'Male'], ['female', 'Female']] },
      { name: 'activity', label: 'How active are you outside the gym?', type: 'select', options: [['1.2', 'Mostly sitting'], ['1.375', 'Lightly active'], ['1.55', 'Moderately active'], ['1.725', 'Very active']] },
      { name: 'syncFood', label: 'Use this to set my calorie & protein targets in Food', type: 'checkbox' },
    ],
    note: 'Calorie targets are estimates from a standard formula. Your real needs vary, so adjust based on how your weight changes over 2–3 weeks.',
    onSubmit: v => {
      store.save('settings', v, FIT_ID);
      const t = foodTargets({ ...fitness(), ...v });
      if (v.syncFood && t) {
        store.save('settings', { calories: t.calories, protein: t.protein, fromFitness: true }, 'settings:food');
        toast(`Food targets set: ${t.calories.toLocaleString()} cal · ${t.protein} g protein`);
      } else toast(`Goal: ${GOALS[v.goal].label}`);
    },
  });
}

function goalCard() {
  const f = fitness();
  const g = GOALS[f.goal] || GOALS.maintain;
  const t = foodTargets(f);
  return h('section', { class: `card goal-card goal-${f.goal}` },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Your goal'), btn('Change', editGoal, 'ghost sm')),
    h('div', { class: 'goal-pick' }, Object.entries(GOALS).map(([k, x]) => h('button', {
      type: 'button', class: 'goal-opt' + (f.goal === k ? ' on' : ''), 'aria-pressed': String(f.goal === k),
      onclick: () => { store.save('settings', { goal: k }, FIT_ID); const tt = foodTargets({ ...fitness(), goal: k }); if (fitness().syncFood !== false && tt) store.save('settings', { calories: tt.calories, protein: tt.protein, fromFitness: true }, 'settings:food'); },
    }, h('span', { class: 'goal-emoji' }, x.emoji), h('b', {}, x.label), h('span', {}, x.blurb)))),
    h('p', { class: 'muted small' }, g.tip, ' Rest ', g.rest, '.'),
    t ? h('p', { class: 'goal-food' }, '🍽 Food targets: ', h('b', {}, `${t.calories.toLocaleString()} cal`), ' · ', h('b', {}, `${t.protein} g protein`), ` a day${fitness().syncFood !== false ? ' (set in Food)' : ''}`)
      : h('button', { type: 'button', class: 'mini-link', onclick: editGoal }, '➕ Add your height & weight to get calorie and protein targets'));
}

// ---- plans -------------------------------------------------------------------------------------
const myPlans = () => store.list(PLANS_COL).sort((a, b) => (b.active === true) - (a.active === true) || (a.created || '').localeCompare(b.created || ''));
export const activePlan = () => myPlans().find(p => p.active);
const sessions = () => store.list(COL).sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));

function usePlan(tpl, activate = true) {
  if (activate) for (const p of myPlans()) if (p.active) store.save(PLANS_COL, { active: false }, p.id);
  const newId = store.save(PLANS_COL, { name: tpl.name, desc: tpl.desc, group: tpl.group, perWeek: tpl.perWeek, days: JSON.parse(JSON.stringify(tpl.days)), fromId: tpl.id, active: activate });
  toast(`"${tpl.name}" is your plan now`);
  return newId;
}
function setActive(p) { for (const x of myPlans()) store.save(PLANS_COL, { active: x.id === p.id }, x.id); }

/** Which day of the plan is next: the one after the last day you did. */
export function nextDayIndex(p) {
  const last = sessions().find(s => s.planId === p.id);
  if (!last) return 0;
  return ((Number(last.day) || 0) + 1) % p.days.length;
}

/** Sets/reps adjusted for your goal. */
function target(item) {
  const [exId, sets, lo, hi] = item;
  const ex = EX[exId] || {};
  const g = fitness().goal;
  const s = g === 'bulk' && ex.compound && !ex.hold ? Math.min(5, sets + (sets >= 5 ? 0 : 1)) : sets;
  return { exId, ex, sets: s, lo, hi, hold: !!ex.hold };
}
const repText = (lo, hi, hold) => (hold ? (lo === hi ? `${lo}s` : `${lo}–${hi}s`) : lo === hi ? `${lo}` : `${lo}–${hi}`);

// ---- progression (when to go up) --------------------------------------------------------------
function lastFor(exId, name) {
  for (const s of sessions()) {
    for (const e of s.sets || []) if (e.ex === exId || (name && e.name === name)) return { ...e, date: s.date };
  }
  return null;
}
function increment(ex) {
  const kg = U() === 'kg';
  if (['dumbbell', 'kettlebell'].includes(ex.equip)) return kg ? 2 : 5;
  if (ex.lower) return kg ? 5 : 10;
  return kg ? 2.5 : 5;
}
/** Advice for next time based on last session: { kind: 'up'|'stay'|'down'|'harder'|'new', weight, text } */
export function advice(t) {
  const last = lastFor(t.exId, t.ex.name);
  if (!last || !last.sets?.length) return { kind: 'new', weight: '', text: t.hold ? 'First time: find a hold you can keep with good form.' : 'First time: pick a weight you could do 2–3 more reps with.' };
  const reps = last.sets.map(s => Number(s.r) || 0);
  const w = Math.max(0, ...last.sets.map(s => Number(s.w) || 0));
  const allTop = reps.length >= t.sets && reps.every(r => r >= t.hi);
  const anyLow = reps.some(r => r < t.lo);
  const goal = fitness().goal;
  const bodyweight = !w;
  if (allTop) {
    if (bodyweight) return { kind: 'harder', weight: '', text: `You hit ${repText(t.hi, t.hi, t.hold)} on every set. Move to a harder variation (see Calisthenics) or add weight.` };
    if (goal === 'shred' && !reps.every(r => r >= t.hi + 2)) return { kind: 'stay', weight: w, text: `Strong. Keep ${w} ${U()} while you're cutting. Adding reps is a bonus.` };
    const nw = w + increment(t.ex);
    return { kind: 'up', weight: nw, text: `⬆ Go up to ${nw} ${U()}. You hit the top of the range on every set last time.` };
  }
  if (anyLow && w) {
    const misses = (() => { let n = 0; for (const s of sessions()) { const e = (s.sets || []).find(x => x.ex === t.exId); if (!e) continue; if (e.sets.some(x => Number(x.r) < t.lo)) n++; else break; } return n; })();
    if (misses >= 2) { const nw = Math.round((w * 0.9) / increment(t.ex)) * increment(t.ex); return { kind: 'down', weight: nw, text: `Stalled twice. Drop to about ${nw} ${U()} and build back up.` }; }
    return { kind: 'stay', weight: w, text: `Stay at ${w} ${U()} and aim for ${repText(t.lo, t.hi)} reps.` };
  }
  return { kind: 'stay', weight: w, text: w ? `Stay at ${w} ${U()}. Add a rep where you can (top of range: ${t.hi}).` : `Beat last time: ${reps.join(', ')} reps.` };
}

// ---- guided session ------------------------------------------------------------------------------
function startSession(p, dayIdx) {
  const day = p.days[dayIdx];
  const started = Date.now();
  const blocks = day.items.map(item => {
    const t = target(item);
    const a = advice(t);
    const last = lastFor(t.exId, t.ex.name);
    const rows = Array.from({ length: t.sets }, (_, i) => {
      const prev = last?.sets?.[i];
      const w = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', placeholder: t.ex.equip === 'bodyweight' || t.ex.equip === 'bar' || t.ex.equip === 'dip' ? '—' : U(), value: a.weight !== '' && a.weight != null ? a.weight : '', 'aria-label': `Set ${i + 1} weight` });
      const r = h('input', { type: 'number', inputmode: 'numeric', min: '0', placeholder: t.hold ? 'sec' : String(t.lo), value: '', 'aria-label': `Set ${i + 1} ${t.hold ? 'seconds' : 'reps'}` });
      const done = h('button', { type: 'button', class: 'set-check', 'aria-label': `Set ${i + 1} done`, onclick: () => {
        if (!r.value) r.value = prev?.r && Number(prev.r) >= t.lo ? String(Math.min(t.hi, Number(prev.r))) : String(t.lo);
        done.classList.toggle('on');
      } }, '✓');
      return { w, r, done, el: h('div', { class: 'set-row' }, h('span', { class: 'set-n' }, String(i + 1)), w, h('span', { class: 'x' }, '×'), r, done,
        prev ? h('span', { class: 'set-prev' }, `last ${prev.w ? prev.w + '×' : ''}${prev.r}`) : null) };
    });
    return { t, rows, el: h('div', { class: 'ex-block' },
      h('div', { class: 'ex-head' },
        h('button', { type: 'button', class: 'ex-name', onclick: () => howTo(t.ex) }, t.ex.name || t.exId, h('span', { class: 'muted small' }, ' ⓘ')),
        h('span', { class: 'muted small' }, `${t.sets} × ${repText(t.lo, t.hi, t.hold)}`)),
      h('p', { class: `advice adv-${a.kind}` }, a.text),
      h('div', { class: 'set-head' }, h('span', {}, 'Set'), h('span', {}, t.hold ? '' : U()), h('span', {}), h('span', {}, t.hold ? 'Sec' : 'Reps')),
      rows.map(x => x.el)) };
  });
  const g = GOALS[fitness().goal];
  openSheet({
    title: `${day.name}`,
    body: [h('p', { class: 'muted small' }, `${p.name} · ${g.emoji} ${g.label} · rest ${g.rest}`), ...blocks.map(b => b.el),
      h('p', { class: 'hint' }, 'Weights are filled in from your last session and the advice above. Tap ✓ when a set is done (it fills in the reps if empty).')],
    actions: [{ label: 'Finish workout', cls: 'primary', onClick: () => {
      const sets = blocks.map(b => ({ ex: b.t.exId, name: b.t.ex.name, lo: b.t.lo, hi: b.t.hi, hold: b.t.hold,
        sets: b.rows.filter(x => x.r.value || x.done.classList.contains('on')).map(x => ({ w: Number(x.w.value) || 0, r: Number(x.r.value) || 0 })) }))
        .filter(e => e.sets.length);
      if (!sets.length) { toast('Nothing logged. Fill in at least one set.'); return; }
      const text = sets.map(e => {
        const w = Math.max(...e.sets.map(s => s.w)), r = Math.min(...e.sets.map(s => s.r));
        return `${e.name} ${e.sets.length}x${r}${w ? ' ' + w : ''}`;
      }).join('\n');
      const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
      store.save(COL, { date: ymd(), title: day.name, planId: p.id, day: dayIdx, sets, exercises: text, minutes: minutes > 3 ? minutes : '' });
      const ups = sets.filter(e => { const t = { exId: e.ex, ex: EX[e.ex] || { name: e.name }, sets: e.sets.length, lo: e.lo, hi: e.hi, hold: e.hold }; return advice(t).kind === 'up'; }).length;
      toast(`💪 ${day.name} saved${ups ? ` · ${ups} lift${ups > 1 ? 's' : ''} ready to go up next time` : ''}`);
    } }],
  });
}

// ---- free-form log (still available) --------------------------------------------------------------
function editWorkout(w, defaults = {}) {
  openForm({
    title: w ? 'Workout' : 'Log a workout',
    values: w || { date: ymd(), ...defaults },
    fields: [
      { name: 'title', label: 'Workout', required: true, autofocus: true, placeholder: 'Run, basketball, push day…', suggestions: [...new Set(store.list(COL).map(x => x.title))] },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'minutes', label: 'Minutes', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'exercises', label: 'Exercises (one per line)', type: 'textarea', rows: 6, placeholder: 'Bench press 3x8 135\nRun 2 miles', hint: 'Write sets×reps then the weight, e.g. "Squat 5x5 185", to track progress.' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => { store.save(COL, v, w?.id); },
    onDelete: w ? () => store.remove(w.id) : null,
  });
}

/** "Bench press 3x8 135" → { name, sets, reps, weight } */
export function parseLine(line) {
  const s = line.trim();
  const m = s.match(/^(.*?)\s+(\d+)\s*[x×]\s*(\d+)(?:\s*(?:@|at)?\s*(\d+(?:\.\d+)?)\s*(lbs?|kg)?)?\s*$/i);
  if (m) return { name: m[1].trim(), sets: +m[2], reps: +m[3], weight: m[4] ? +m[4] : null, unit: m[5] || '' };
  return { name: s, sets: null, reps: null, weight: null, text: s };
}
const exLines = w => String(w.exercises || '').split('\n').map(l => l.trim()).filter(Boolean);
const keyOf = n => n.toLowerCase().replace(/\s+/g, ' ').trim();

// ---- exercise how-to & library -----------------------------------------------------------------------
function howTo(ex, onAdd) {
  if (!ex?.how) return;
  const group = EQUIP_GROUPS.find(g => g[2].includes(ex.equip));
  openSheet({
    title: ex.name,
    body: [
      h('div', { class: 'row-meta' }, h('span', { class: 'tag' }, ex.muscle), group ? h('span', { class: 'tag' }, group[1]) : null, ex.compound ? h('span', { class: 'tag' }, 'Compound') : null),
      h('h3', {}, 'How to do it'), h('ol', { class: 'steps' }, ex.how.map(s => h('li', {}, s))),
      h('p', { class: 'tip' }, '💡 ', ex.cue),
      h('a', { class: 'small', href: `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' proper form')}`, target: '_blank', rel: 'noopener' }, '▶ Watch form videos ↗'),
    ],
    actions: onAdd ? [{ label: 'Add to day', cls: 'primary', onClick: () => onAdd(ex) }] : [],
  });
}

function libraryList(onPick) {
  const groups = [['all', 'All'], ...EQUIP_GROUPS.map(g => [g[0], g[1]])];
  const q = libQuery.trim().toLowerCase();
  const list = EXERCISES.filter(e => (libEquip === 'all' || EQUIP_GROUPS.find(g => g[0] === libEquip)[2].includes(e.equip))
    && (!libMuscle || e.muscle === libMuscle) && (!q || e.name.toLowerCase().includes(q)));
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    const ql = libQuery.trim().toLowerCase();
    const l = EXERCISES.filter(e => (libEquip === 'all' || EQUIP_GROUPS.find(g => g[0] === libEquip)[2].includes(e.equip))
      && (!libMuscle || e.muscle === libMuscle) && (!ql || e.name.toLowerCase().includes(ql)));
    results.replaceChildren(...(l.length ? l.map(e => h('div', { class: 'row' },
      h('div', { class: 'row-main', onclick: () => howTo(e, onPick) },
        h('div', { class: 'row-title' }, e.name),
        h('div', { class: 'row-sub' }, `${e.muscle} · ${EQUIP_GROUPS.find(g => g[2].includes(e.equip))?.[1] || ''}`)),
      onPick ? btn('Add', () => onPick(e), 'ghost sm') : icon('right', 18))) : [empty('No exercises match.')]));
  };
  const results = h('div', {});
  wrap.append(
    h('div', { class: 'chip-row equip-chips' }, groups.map(([k, l]) => h('button', { type: 'button', class: 'chip' + (libEquip === k ? ' on' : ''), onclick: e => {
      libEquip = k; e.currentTarget.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
    } }, l))),
    h('div', { class: 'quick' },
      h('input', { type: 'search', placeholder: 'Search exercises', value: libQuery, 'aria-label': 'Search exercises', oninput: e => { libQuery = e.target.value; draw(); } }),
      (() => { const s = h('select', { 'aria-label': 'Muscle', onchange: e => { libMuscle = e.target.value; draw(); } }, h('option', { value: '' }, 'All muscles'), MUSCLES.map(m => h('option', {}, m))); s.value = libMuscle; return s; })()),
    results);
  draw();
  void list;
  return wrap;
}

function renderLibrary(root) {
  root.append(card(`Exercise library (${EXERCISES.length})`, {}, h('p', { class: 'muted' }, 'Tap any exercise for step-by-step form tips.'), libraryList(null)));
}

// ---- plan editor --------------------------------------------------------------------------------------
function defaultsFor(ex) {
  if (ex.hold) return [3, 20, 40];
  return ex.compound ? [3, 6, 10] : [3, 10, 15];
}
function addExercise(p, di) {
  const picker = h('div', {});
  const dlg = openSheet({ title: `Add to ${p.days[di].name}`, body: [picker] });
  picker.append(libraryList(ex => {
    const days = JSON.parse(JSON.stringify(p.days));
    days[di].items.push([ex.id, ...defaultsFor(ex)]);
    store.save(PLANS_COL, { days }, p.id);
    toast(`Added ${ex.name}`);
    dlg.close();
    rr();
  }));
}
function editItem(p, di, ii) {
  const [exId, sets, lo, hi] = p.days[di].items[ii];
  const ex = EX[exId] || {};
  openForm({
    title: ex.name || exId,
    values: { sets, lo, hi },
    fields: [
      { name: 'sets', label: 'Sets', type: 'number', min: '1', max: '10', step: '1', inputmode: 'numeric', required: true },
      { name: 'lo', label: ex.hold ? 'Hold from (seconds)' : 'Reps from', type: 'number', min: '1', step: '1', inputmode: 'numeric', required: true },
      { name: 'hi', label: ex.hold ? 'Hold up to (seconds)' : 'Reps up to', type: 'number', min: '1', step: '1', inputmode: 'numeric', required: true, hint: 'When you hit the top on every set, the app tells you to go up in weight.' },
    ],
    onSubmit: v => {
      const days = JSON.parse(JSON.stringify(p.days));
      const lo2 = Math.min(Number(v.lo), Number(v.hi)), hi2 = Math.max(Number(v.lo), Number(v.hi));
      days[di].items[ii] = [exId, Number(v.sets), lo2, hi2];
      store.save(PLANS_COL, { days }, p.id);
    },
    onDelete: () => { const days = JSON.parse(JSON.stringify(p.days)); days[di].items.splice(ii, 1); store.save(PLANS_COL, { days }, p.id); },
    deleteLabel: 'Remove from this day',
  });
}
function renderEditor(root, p) {
  const save = days => store.save(PLANS_COL, { days }, p.id);
  root.append(h('div', { class: 'section-head' },
    btn('‹ Back to plans', () => { editId = ''; rr(); }, 'ghost sm'),
    h('span', {}, p.active ? h('span', { class: 'tag ok-tag' }, 'Active') : btn('Make active', () => { setActive(p); rr(); }, 'ghost sm'))));
  root.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('button', { type: 'button', class: 'card-title link plan-title', onclick: () => openForm({
        title: 'Rename plan', values: { name: p.name, desc: p.desc || '' },
        fields: [{ name: 'name', label: 'Plan name', required: true }, { name: 'desc', label: 'Description', type: 'textarea', rows: 2 }],
        onSubmit: v => { store.save(PLANS_COL, v, p.id); },
      }) }, p.name, ' ✎')),
    p.desc ? h('p', { class: 'muted small' }, p.desc) : null));
  p.days.forEach((d, di) => {
    root.append(h('section', { class: 'card plan-day' },
      h('div', { class: 'card-head' },
        h('button', { type: 'button', class: 'card-title link', onclick: () => openForm({
          title: 'Day name', values: { name: d.name },
          fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'Push, Legs, Day A…' }],
          onSubmit: v => { const days = JSON.parse(JSON.stringify(p.days)); days[di].name = v.name; save(days); },
          onDelete: p.days.length > 1 ? () => { const days = JSON.parse(JSON.stringify(p.days)); days.splice(di, 1); save(days); } : null,
          deleteLabel: 'Delete this day',
        }) }, `${di + 1}. ${d.name} ✎`),
        btn('▶ Start', () => startSession(p, di), 'ghost sm')),
      d.items.length ? d.items.map((item, ii) => {
        const t = target(item);
        return h('div', { class: 'row plan-item' },
          h('div', { class: 'row-main', onclick: () => editItem(p, di, ii) },
            h('div', { class: 'row-title' }, t.ex.name || item[0]),
            h('div', { class: 'row-sub' }, `${t.sets} × ${repText(t.lo, t.hi, t.hold)}${t.sets !== item[1] ? ' (goal +1 set)' : ''} · ${t.ex.muscle || ''}`)),
          h('div', { class: 'row-actions' },
            iconBtn('up', () => { if (!ii) return; const days = JSON.parse(JSON.stringify(p.days)); const a = days[di].items; [a[ii - 1], a[ii]] = [a[ii], a[ii - 1]]; save(days); }, 'Move up'),
            iconBtn('down', () => { const days = JSON.parse(JSON.stringify(p.days)); const a = days[di].items; if (ii >= a.length - 1) return; [a[ii + 1], a[ii]] = [a[ii], a[ii + 1]]; save(days); }, 'Move down')));
      }) : empty('No exercises yet.'),
      h('div', { class: 'btn-row' }, btn('+ Add exercise', () => addExercise(p, di), 'ghost sm'))));
  });
  root.append(h('div', { class: 'btn-row' },
    btn('+ Add a day', () => { const days = JSON.parse(JSON.stringify(p.days)); days.push({ name: `Day ${days.length + 1}`, items: [] }); save(days); }, 'ghost'),
    btn('Delete plan', () => { if (confirm(`Delete "${p.name}"? Your logged workouts are kept.`)) { store.remove(p.id); editId = ''; } }, 'danger')));
}

function newPlan() {
  openForm({
    title: 'Build a plan',
    values: { days: '3', equip: 'gym' },
    fields: [
      { name: 'name', label: 'Plan name', required: true, autofocus: true, placeholder: 'My split, Summer cut…' },
      { name: 'days', label: 'How many different workout days?', type: 'select', options: ['1', '2', '3', '4', '5', '6'].map(n => [n, n]) },
    ],
    submitLabel: 'Create',
    onSubmit: v => {
      const n = Number(v.days);
      editId = store.uid(); // set before saving so the screen redraws straight into the editor
      store.save(PLANS_COL, { name: v.name, days: Array.from({ length: n }, (_, i) => ({ name: `Day ${String.fromCharCode(65 + i)}`, items: [] })), active: !activePlan() }, editId);
      toast('Now add exercises to each day');
    },
  });
}

function planCard(tpl, mine) {
  const nEx = tpl.days.reduce((s, d) => s + d.items.length, 0);
  return h('section', { class: 'card tpl-card' + (mine?.active ? ' active-plan' : '') },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, tpl.name), mine?.active ? h('span', { class: 'tag ok-tag' }, 'Active') : tpl.level ? h('span', { class: 'tag' }, tpl.level) : null),
    tpl.desc ? h('p', { class: 'muted small' }, tpl.desc) : null,
    h('p', { class: 'small' }, `${tpl.days.length} workout${tpl.days.length > 1 ? 's' : ''}: ${tpl.days.map(d => d.name).join(' · ')}${tpl.perWeek ? ` · ${tpl.perWeek}×/week` : ''} · ${nEx} exercises`),
    h('div', { class: 'btn-row' },
      mine ? [btn(mine.active ? 'Edit' : 'Edit', () => { editId = mine.id; rr(); }, 'ghost sm'), !mine.active ? btn('Make active', () => setActive(mine), 'ghost sm') : null]
        : [btn('Use this plan', () => usePlan(tpl), 'primary sm'), btn('Preview', () => previewPlan(tpl), 'ghost sm')]));
}

function previewPlan(tpl) {
  openSheet({
    title: tpl.name,
    body: [h('p', { class: 'muted' }, tpl.desc), ...tpl.days.map(d => h('div', {},
      h('h3', {}, d.name),
      h('ul', { class: 'ex-list' }, d.items.map(([ex, s, lo, hi]) => h('li', {}, h('span', {}, EX[ex]?.name || ex), h('span', { class: 'muted' }, `${s} × ${repText(lo, hi, EX[ex]?.hold)}`))))))],
    actions: [{ label: 'Use this plan', cls: 'primary', onClick: () => usePlan(tpl) }, { label: 'Copy & customize', onClick: () => { editId = usePlan(tpl, !activePlan()); view = 'plans'; rr(); } }],
  });
}

function renderPlans(root) {
  if (editId) { const p = store.get(editId); if (p) { renderEditor(root, p); return; } editId = ''; }
  const mine = myPlans();
  root.append(card('My plans', { action: addBtn('Build', newPlan) },
    mine.length ? h('div', { class: 'stack' }, mine.map(p => planCard(p, p))) : empty('Build your own plan, or pick a ready-made one below. You can customize any of them.')));
  for (const [g, label] of EQUIP_GROUPS.filter(x => x[0] !== 'bar')) {
    const list = PLANS.filter(p => p.group === g);
    if (!list.length) continue;
    root.append(h('p', { class: 'eyebrow plan-group' }, label), h('div', { class: 'grid' }, list.map(t => planCard(t))));
  }
  root.append(h('p', { class: 'hint' }, 'Calisthenics plans are in the Calisthenics tab.'));
}

// ---- calisthenics --------------------------------------------------------------------------------------
function renderCali(root) {
  const lv = store.get(CALI_ID) || {};
  root.append(h('section', { class: 'card cali-hero' },
    h('h2', {}, '🤸 Calisthenics'),
    h('p', { class: 'muted' }, 'Build real strength with just your bodyweight, at home, in a park, anywhere. Start with the guide, find your level on each ladder, then pick a plan.')));
  root.append(card('How to do calisthenics', {}, CALI_GUIDE.map(([t, d], i) => h('details', { class: 'guide', open: i < 2 }, h('summary', {}, t), h('p', {}, d)))));
  root.append(h('p', { class: 'eyebrow plan-group' }, 'Skill ladders (tap your current level)'));
  root.append(h('div', { class: 'grid' }, CALI_SKILLS.map(sk => {
    const cur = Number(lv[sk.id] ?? 0);
    return h('section', { class: 'card ladder' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, `${sk.emoji} ${sk.name}`), h('span', { class: 'muted small' }, `Level ${cur + 1}/${sk.levels.length}`)),
      h('ol', { class: 'ladder-steps' }, sk.levels.map(([name, goal, how], i) => h('li', { class: i < cur ? 'passed' : i === cur ? 'current' : '' },
        h('button', { type: 'button', onclick: () => openSheet({
          title: name, body: [h('p', {}, how), h('p', { class: 'tip' }, `🎯 Move on when you can do ${goal} with clean form, two workouts in a row.`)],
          actions: [{ label: i === cur ? '✓ I can do this now. Level up' : 'Set as my level', cls: 'primary', onClick: () => store.save('settings', { [sk.id]: i === cur ? Math.min(sk.levels.length - 1, i + 1) : i }, CALI_ID) }],
        }) }, h('span', { class: 'lvl-dot' }, i < cur ? '✓' : String(i + 1)), h('span', { class: 'lvl-name' }, name), h('span', { class: 'lvl-goal' }, goal))))));
  })));
  root.append(h('p', { class: 'eyebrow plan-group' }, 'Calisthenics plans'));
  root.append(h('div', { class: 'grid' }, CALI_PLANS.map(t => planCard(t, myPlans().find(p => p.fromId === t.id)))));
}

// ---- progress --------------------------------------------------------------------------------------------
function history() {
  const map = new Map();
  for (const w of store.list(COL)) {
    if (w.sets?.length) {
      for (const e of w.sets) {
        const k = keyOf(e.name || e.ex);
        if (!map.has(k)) map.set(k, { name: e.name || e.ex, ex: e.ex, lo: e.lo, hi: e.hi, entries: [] });
        map.get(k).entries.push({ date: w.date, sets: e.sets.length, reps: Math.min(...e.sets.map(s => s.r)), weight: Math.max(...e.sets.map(s => s.w)) || null, all: e.sets });
      }
    } else {
      for (const e of exLines(w).map(parseLine)) {
        const k = keyOf(e.name);
        if (!map.has(k)) map.set(k, { name: e.name, entries: [] });
        map.get(k).entries.push({ ...e, date: w.date });
      }
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
    h('div', { class: 'stat' }, h('b', {}, best ? `${best}` : '—'), h('span', {}, `best ${U()}`)),
    h('div', { class: 'stat' }, h('b', {}, relDay(last.date)), h('span', {}, 'last time'))));
  if (ex.ex && ex.lo) {
    const a = advice({ exId: ex.ex, ex: EX[ex.ex] || { name: ex.name }, sets: last.sets, lo: ex.lo, hi: ex.hi, hold: EX[ex.ex]?.hold });
    root.append(h('p', { class: `advice adv-${a.kind}` }, 'Next time: ', a.text));
  }
  if (weighted.length >= 2) {
    const pts = weighted.slice(0, 8).reverse();
    root.append(card('Weight over time', {}, barChart(pts.map((e, i) => ({ label: fmtDay(e.date, { month: 'numeric', day: 'numeric' }), value: e.weight, highlight: i === pts.length - 1 })), { caption: 'Tap a bar to see that day.' })));
  }
  root.append(card('History', {}, ex.entries.slice(0, 30).map(e => h('div', { class: 'row compact' },
    h('span', { class: 'slot' }, fmtDay(e.date, { month: 'short', day: 'numeric' })),
    h('div', { class: 'row-main' }, e.all ? e.all.map(s => `${s.w ? s.w + '×' : ''}${s.r}`).join(', ') : e.sets ? `${e.sets}×${e.reps}${e.weight != null ? ` @ ${e.weight}` : ''}` : e.text)))));
}

// ---- train (home) ----------------------------------------------------------------------------------------
function readyToGoUp(p) {
  const out = [];
  const seen = new Set();
  for (const d of p.days) for (const item of d.items) {
    if (seen.has(item[0])) continue; seen.add(item[0]);
    const t = target(item); const a = advice(t);
    if (a.kind === 'up' || a.kind === 'harder') out.push({ t, a });
  }
  return out;
}

function sessionCard(s) {
  return h('div', { class: 'row', onclick: () => editWorkout(s) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.title),
      h('div', { class: 'row-sub' }, `${relDay(s.date)}${s.minutes ? ` · ${s.minutes} min` : ''} · ${(s.sets?.length || exLines(s).length)} exercises`)),
    icon('right', 18));
}

function renderTrain(root) {
  root.append(goalCard());
  const p = activePlan();
  if (p) {
    const di = nextDayIndex(p);
    const d = p.days[di];
    const doneToday = sessions().find(s => s.date === ymd() && s.planId === p.id);
    root.append(h('section', { class: 'card next-card' },
      h('div', { class: 'card-head' }, h('p', { class: 'eyebrow' }, doneToday ? `✓ Done today: ${doneToday.title}` : 'Next workout'), btn('Plan', () => { view = 'plans'; editId = p.id; rr(); }, 'ghost sm')),
      h('h2', {}, d.name), h('p', { class: 'muted small' }, `${p.name} · ${d.items.length} exercises`),
      h('ul', { class: 'ex-list' }, d.items.map(item => { const t = target(item); return h('li', {}, h('span', {}, t.ex.name || item[0]), h('span', { class: 'muted' }, `${t.sets} × ${repText(t.lo, t.hi, t.hold)}`)); })),
      h('div', { class: 'btn-row' }, btn(`▶ Start ${d.name}`, () => startSession(p, di), 'primary'),
        p.days.length > 1 ? btn('Pick a different day', () => openSheet({ title: 'Which workout?', body: [], actions: p.days.map((x, i) => ({ label: x.name, onClick: () => startSession(p, i) })) }), 'ghost') : null)));
    const ups = readyToGoUp(p);
    if (ups.length) root.append(card('⬆ Ready to go up', {}, ups.map(({ t, a }) => h('div', { class: 'row compact' },
      h('div', { class: 'row-main' }, h('b', {}, t.ex.name), h('div', { class: 'row-sub' }, a.text))))));
  } else {
    root.append(card('Pick a workout plan', {},
      h('p', { class: 'muted' }, 'Plans tell you what to do each workout and when to add weight. Choose a ready-made plan (gym, dumbbells, bands, kettlebell, no equipment, calisthenics) or build your own.'),
      h('div', { class: 'btn-row' }, btn('Browse plans', () => { view = 'plans'; rr(); }, 'primary'), btn('Calisthenics', () => { view = 'cali'; rr(); }, 'ghost'))));
  }
  const list = sessions();
  const weekAgo = addDays(ymd(), -6);
  root.append(card(`Recent workouts${list.length ? ` · ${list.filter(w => w.date >= weekAgo).length} this week` : ''}`, { action: btn('+ Log other', () => editWorkout(null), 'ghost sm') },
    list.length ? list.slice(0, 10).map(sessionCard) : empty('No workouts logged yet.')));
}

/** Card for the Today screen. */
export function todayWorkoutCard(navigate) {
  const p = activePlan();
  if (!p) return null;
  const done = sessions().find(s => s.date === ymd());
  const di = nextDayIndex(p);
  return card('Workout', { link: () => { view = 'train'; navigate('workouts'); } },
    done ? h('p', {}, `✓ ${done.title} done today${done.minutes ? ` · ${done.minutes} min` : ''}`)
      : [h('p', {}, h('b', {}, p.days[di].name), h('span', { class: 'muted' }, ` · ${p.days[di].items.length} exercises`)),
        h('div', { class: 'btn-row' }, btn('▶ Start', () => startSession(p, di), 'primary sm'))]);
}

export function render(root, ctx) {
  rr = ctx.rerender;
  root.append(pageHead('Workouts', { actions: [addBtn('Log', () => editWorkout(null))] }));
  root.append(seg([['train', 'Train'], ['plans', 'Plans'], ['library', 'Exercises'], ['cali', 'Calisthenics'], ['progress', 'Progress']], view, v => { view = v; editId = ''; rr(); }));
  if (view === 'plans') renderPlans(root);
  else if (view === 'library') renderLibrary(root);
  else if (view === 'cali') renderCali(root);
  else if (view === 'progress') renderProgress(root);
  else renderTrain(root);
}
