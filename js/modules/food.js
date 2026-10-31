// food.js — what you ate, your grocery list, meals you like, and snacks you like.
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, icon, openForm, dayNav, ymd, toast } from '../ui.js';

export const id = 'food';
export const title = 'Food';
export const glyph = 'food';

const LOG = 'meallog';     // { date, slot, name, notes }
const GROC = 'groceries';  // { name, qty, aisle, got }
const FAV = 'foods';       // { kind: 'meal'|'snack', name, ingredients, notes, rating, where }
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

let tab = 'log';
let day = ymd();
export function setTab(t) { tab = t; }

// ---- meal log -----------------------------------------------------------------
export function editLog(entry, defaults = {}) {
  const favNames = store.list(FAV).map(f => f.name).sort();
  openForm({
    title: entry ? 'Edit entry' : 'Log food',
    values: entry || { date: day, slot: guessSlot(), ...defaults },
    fields: [
      { name: 'name', label: 'What did you eat?', required: true, autofocus: true, suggestions: favNames },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Where, how it was…' },
    ],
    onSubmit: v => { store.save(LOG, v, entry?.id); },
    onDelete: entry ? () => store.remove(entry.id) : null,
  });
}

function guessSlot() {
  const hr = new Date().getHours();
  return hr < 10 ? 'Breakfast' : hr < 15 ? 'Lunch' : hr < 21 ? 'Dinner' : 'Snacks';
}

export const mealsOn = d => store.list(LOG).filter(e => e.date === d);

/** Compact list used on the Today screen. */
export function mealsSummary(d) {
  const entries = mealsOn(d);
  if (!entries.length) return empty('Nothing logged yet today.');
  return SLOTS.filter(s => entries.some(e => e.slot === s)).map(s =>
    h('div', { class: 'row compact' },
      h('span', { class: 'slot' }, s),
      h('div', { class: 'row-main' }, entries.filter(e => e.slot === s).map(e => e.name).join(', '))));
}

function renderLog(root, ctx) {
  root.append(dayNav(day, d => { day = d; ctx.rerender(); }));
  const entries = mealsOn(day);
  const wrap = h('div', { class: 'grid' });
  for (const slot of SLOTS) {
    const list = entries.filter(e => e.slot === slot).sort((a, b) => (a.created || '').localeCompare(b.created || ''));
    wrap.append(card(slot, { action: iconAdd(() => editLog(null, { slot, date: day }), `Add ${slot}`) },
      list.length ? list.map(e => h('div', { class: 'row', onclick: () => editLog(e) },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, e.name),
          e.notes ? h('div', { class: 'row-sub' }, e.notes) : null))) : empty('—')));
  }
  root.append(wrap);
}

const iconAdd = (onclick, label) => h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, onclick }, icon('plus', 20));

// ---- groceries ------------------------------------------------------------------
export function addGroceries(names) {
  const open = new Set(store.list(GROC).filter(g => !g.got).map(g => g.name.toLowerCase()));
  let n = 0;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || open.has(name.toLowerCase())) continue;
    store.save(GROC, { name, got: false });
    open.add(name.toLowerCase());
    n++;
  }
  return n;
}

export const groceryCount = () => store.list(GROC).filter(g => !g.got).length;

function editGrocery(g) {
  openForm({
    title: 'Grocery item',
    values: g,
    fields: [
      { name: 'name', label: 'Item', required: true },
      { name: 'qty', label: 'How much', placeholder: '2, 1 lb, a big one…' },
      { name: 'aisle', label: 'Store / aisle', suggestions: [...new Set(store.list(GROC).map(x => x.aisle).filter(Boolean))] },
    ],
    onSubmit: v => { store.save(GROC, v, g.id); },
    onDelete: () => store.remove(g.id),
  });
}

function groceryRow(g) {
  return h('div', { class: 'row' + (g.got ? ' done' : '') },
    h('button', { type: 'button', class: 'check' + (g.got ? ' on' : ''), 'aria-label': 'Got it', onclick: () => store.save(GROC, { got: !g.got }, g.id) }),
    h('div', { class: 'row-main', onclick: () => editGrocery(g) },
      h('div', { class: 'row-title' }, g.name, g.qty ? h('span', { class: 'qty' }, ` · ${g.qty}`) : null),
      g.aisle ? h('div', { class: 'row-meta' }, h('span', { class: 'tag' }, g.aisle)) : null));
}

function renderGroceries(root) {
  const input = h('input', { type: 'text', placeholder: 'Add an item… (commas add several)', 'data-fk': 'groc-quick', enterkeyhint: 'done', 'aria-label': 'Grocery item' });
  root.append(h('form', {
    class: 'quick',
    onsubmit: e => { e.preventDefault(); addGroceries(input.value.split(',')); },
  }, input, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));

  const all = store.list(GROC);
  const need = all.filter(g => !g.got).sort((a, b) => (a.aisle || '~').localeCompare(b.aisle || '~') || (a.created || '').localeCompare(b.created || ''));
  const got = all.filter(g => g.got);
  root.append(card(`To buy (${need.length})`, {}, need.length ? need.map(groceryRow) : empty('List is empty. Add items above, or from your saved meals.')));
  if (got.length) {
    root.append(card('In the cart', { action: btn('Clear', () => got.forEach(g => store.remove(g.id)), 'ghost sm') }, got.map(groceryRow)));
  }
}

// ---- favorite meals & snacks --------------------------------------------------------
function editFav(f, kind) {
  kind = f?.kind || kind;
  const isMeal = kind === 'meal';
  openForm({
    title: f ? f.name : isMeal ? 'Meal I like' : 'Snack I like',
    values: f || { kind, rating: '' },
    fields: [
      { name: 'name', label: 'Name', required: true, autofocus: true },
      ...(isMeal ? [{ name: 'ingredients', label: 'Ingredients (one per line)', type: 'textarea', rows: 5, hint: 'These can be added to your grocery list in one tap' }]
                 : [{ name: 'where', label: 'Where to get it', placeholder: 'Walmart, gas station…' }]),
      { name: 'rating', label: 'How much do you like it?', type: 'select', options: [['', '—'], ['3', '★★★ Love it'], ['2', '★★ Good'], ['1', '★ It\'s fine']] },
      { name: 'notes', label: isMeal ? 'Recipe / notes' : 'Notes', type: 'textarea', rows: isMeal ? 5 : 2 },
    ],
    onSubmit: v => { store.save(FAV, { ...v, kind }, f?.id); },
    onDelete: f ? () => store.remove(f.id) : null,
  });
}

function favRow(f) {
  const isMeal = f.kind === 'meal';
  const lines = (f.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean);
  return h('div', { class: 'row' },
    h('div', { class: 'row-main', onclick: () => editFav(f) },
      h('div', { class: 'row-title' }, f.name, f.rating ? h('span', { class: 'stars' }, ' ' + '★'.repeat(Number(f.rating))) : null),
      h('div', { class: 'row-sub' }, isMeal ? (lines.length ? `${lines.length} ingredients` : 'No ingredients yet') : (f.where || ''))),
    h('div', { class: 'row-actions' },
      btn('Ate it', () => { store.save(LOG, { name: f.name, slot: isMeal ? guessSlot() : 'Snacks', date: ymd() }); toast(`Logged ${f.name}`); }, 'ghost sm'),
      h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': 'Add to grocery list', title: 'Add to grocery list',
        onclick: () => {
          const n = addGroceries(isMeal ? lines : [f.name]);
          toast(n ? `Added ${n} item${n > 1 ? 's' : ''} to groceries` : 'Already on your list');
        },
      }, icon('cart', 20))));
}

function renderFavs(root, kind) {
  const list = store.list(FAV).filter(f => f.kind === kind)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  root.append(card(kind === 'meal' ? 'Meals I like' : 'Snacks I like',
    { action: addBtn('Add', () => editFav(null, kind)) },
    list.length ? list.map(favRow) : empty(kind === 'meal'
      ? 'Save meals you like with their ingredients. Then one tap adds them to your grocery list.'
      : 'Save snacks you like so they are easy to log and restock.')));
}

export function render(root, ctx) {
  root.append(pageHead('Food', { actions: [addBtn('Log', () => editLog(null))] }));
  root.append(seg([['log', 'Ate'], ['groceries', `Groceries${groceryCount() ? ` (${groceryCount()})` : ''}`], ['meal', 'Meals'], ['snack', 'Snacks']],
    tab, v => { tab = v; ctx.rerender(); }));
  if (tab === 'log') renderLog(root, ctx);
  else if (tab === 'groceries') renderGroceries(root);
  else renderFavs(root, tab);
}
