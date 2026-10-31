// search.js — one search box across everything you've saved.
import * as store from '../store.js';
import { h, pageHead, empty, icon, relDay } from '../ui.js';
import { isOn } from './settings.js';
import { LIBRARY } from '../data/recipes.js';

export const id = 'search';
export const title = 'Search';
export const glyph = 'search';

let query = '';

// collection → where it lives and how to describe it
const SOURCES = [
  { col: 'tasks', mod: 'tasks', label: t => (t.classId ? 'Assignment' : 'Task'), title: x => x.title, text: x => `${x.title} ${x.notes || ''} ${x.list || ''}`, sub: x => (x.due ? `Due ${relDay(x.due)}` : '') + (x.done ? ' · done' : '') },
  { col: 'events', mod: 'calendar', label: () => 'Event', title: x => x.title, text: x => `${x.title} ${x.location || ''} ${x.notes || ''}`, sub: x => x.date ? relDay(x.date) : '' },
  { col: 'notes', mod: 'notes', label: () => 'Note', title: x => x.title || (x.body || '').slice(0, 40), text: x => `${x.title || ''} ${x.body || ''}` },
  { col: 'foods', mod: 'food', tab: 'recipes', label: x => (x.kind === 'snack' ? 'Snack' : 'Recipe'), title: x => x.name, text: x => `${x.name} ${x.ingredients || ''} ${x.notes || ''}` },
  { col: 'pantry', mod: 'food', tab: 'pantry', label: x => x.where || 'Pantry', title: x => x.name, text: x => x.name },
  { col: 'groceries', mod: 'food', tab: 'groceries', label: () => 'Grocery list', title: x => x.name, text: x => `${x.name} ${x.note || ''}`, sub: x => (x.got ? 'in cart' : 'to buy') },
  { col: 'meallog', mod: 'food', tab: 'log', label: () => 'Ate', title: x => x.name, text: x => `${x.name} ${x.notes || ''}`, sub: x => x.date ? relDay(x.date) : '' },
  { col: 'subs', mod: 'money', tab: 'spending', label: () => 'Subscription', title: x => x.name, text: x => `${x.name} ${x.notes || ''}` },
  { col: 'bills', mod: 'money', tab: 'bills', label: () => 'Bill', title: x => x.name, text: x => `${x.name} ${x.notes || ''}` },
  { col: 'goals', mod: 'money', tab: 'goals', label: () => 'Savings goal', title: x => x.name, text: x => x.name },
  { col: 'txns', mod: 'money', tab: 'spending', label: () => 'Spending', title: x => x.note || x.category, text: x => `${x.note || ''} ${x.category || ''}`, sub: x => x.date ? relDay(x.date) : '' },
  { col: 'chores', mod: 'chores', label: () => 'Chore', title: x => x.name, text: x => `${x.name} ${x.room || ''}` },
  { col: 'classes', mod: 'school', label: () => 'Class', title: x => x.code || x.name, text: x => `${x.name} ${x.code || ''} ${x.instructor || ''}` },
  { col: 'habits', mod: 'habits', label: () => 'Habit', title: x => x.name, text: x => x.name },
  { col: 'workouts', mod: 'workouts', label: () => 'Workout', title: x => x.title, text: x => `${x.title} ${x.exercises || ''} ${x.notes || ''}`, sub: x => x.date ? relDay(x.date) : '' },
];

function results(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = text => { const t = String(text).toLowerCase(); return words.every(w => t.includes(w)); };
  const out = [];
  for (const s of SOURCES) {
    if (!isOn(s.mod)) continue;
    for (const x of store.list(s.col)) if (hit(s.text(x))) out.push({ s, x });
  }
  if (isOn('food')) for (const r of LIBRARY) if (hit(`${r.name} ${r.ingredients.join(' ')} ${r.tags.join(' ')}`)) out.push({ s: { mod: 'food', tab: 'recipes', label: () => 'Recipe idea', title: () => r.name }, x: r });
  return out.slice(0, 80);
}

export function render(root, { navigate }) {
  root.append(pageHead('Search'));
  const input = h('input', {
    type: 'search', class: 'search', placeholder: 'Search tasks, notes, recipes, bills…', value: query,
    'data-fk': 'global-search', 'aria-label': 'Search everything', autofocus: true,
    oninput: e => { query = e.target.value; draw(); },
  });
  const list = h('div', { class: 'card search-results' });
  root.append(input, list);

  async function go(r) {
    const mod = await import(`./${r.s.mod}.js`);
    if (r.s.tab && mod.setTab) mod.setTab(r.s.tab);
    navigate(r.s.mod);
  }
  function draw() {
    const q = query.trim();
    if (q.length < 2) { list.replaceChildren(empty('Type at least 2 letters.')); return; }
    const res = results(q);
    list.replaceChildren(...(res.length ? res.map(r => h('button', { type: 'button', class: 'row result', onclick: () => go(r) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, r.s.title(r.x) || '(untitled)'),
        h('div', { class: 'row-meta' }, h('span', { class: 'tag' }, r.s.label(r.x)), r.s.sub?.(r.x) ? h('span', { class: 'row-sub' }, r.s.sub(r.x)) : null)),
      icon('right', 18))) : [empty(`Nothing matches "${q}".`)]));
  }
  draw();
  setTimeout(() => { if (!document.querySelector('dialog[open]')) input.focus({ preventScroll: true }); }, 50);
}
