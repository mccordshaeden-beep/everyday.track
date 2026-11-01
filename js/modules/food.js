// food.js — what you ate (with calories & protein), a weekly meal plan, recipes
// (built-in ideas + your own), your pantry/fridge, and a grocery list that only
// adds what you don't already have.
import * as store from '../store.js';
import {
  h, pageHead, card, empty, seg, addBtn, btn, icon, iconBtn, openForm, openSheet, dayNav, bar, toast,
  ymd, addDays, parseYmd, fmtDay, relDay, daysBetween, mondayOf,
} from '../ui.js';
import { LIBRARY } from '../data/recipes.js';
import { ALLERGENS, DIETS, conflicts, summary as dietSummary, isSet as dietIsSet } from '../data/diet.js';
import { callFunction, getStatus } from '../sync.js';
import { fitness } from './workouts.js';
import { canShare, spaces, spaceById, spaceLabel, spaceIcon, shareOptions, resolveShare, moveTo } from '../share.js';

export const id = 'food';
export const title = 'Food';
export const glyph = 'food';

const LOG = 'meallog';      // { date, slot, name, calories, protein, recipe }
const GROC = 'groceries';   // { name, qty, aisle, note, got }
const FAV = 'foods';        // recipes & snacks: { kind: 'meal'|'snack', name, type, servings, minutes, ingredients, steps, calories, protein, rating, notes, fromLib }
const PANTRY = 'pantry';    // { name, where, qty, expires }
const PLAN = 'mealplan';    // { date, slot, recipe (id or "lib:slug"), name }
const GOALS_ID = 'settings:food'; // { calories, protein, diet, allergies: [], avoid }
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const PLACES = ['Fridge', 'Freezer', 'Pantry', 'Spices'];

// Three tabs: Meals (today + this week's plan) · Recipes (one list) · Shopping (groceries + pantry).
let tab = 'meals';
let day = ymd();
let recipeView = 'all';   // all | mine | make | snacks
let recipeQuery = '';
let showHidden = false;
let findQuery = '';
let findResults = null; // null = not searched yet
let week = mondayOf(ymd());
const OLD_FOOD_TABS = { log: 'meals', plan: 'meals', pantry: 'shopping', groceries: 'shopping' };
export function setTab(t) { tab = OLD_FOOD_TABS[t] || (['meals', 'recipes', 'shopping'].includes(t) ? t : 'meals'); }

// ==== ingredient matching ========================================================
// "1 lb ground beef" → key "beef"; "2 cups shredded cheese" → "cheese".
// The same cleanup runs on pantry items, so "Ground beef" in the fridge matches.
const STAPLES = new Set(['salt', 'pepper', 'black pepper', 'water', 'oil', 'olive oil', 'vegetable oil', 'cooking spray', 'ice']);
const NUM = /^[\s\d\/.½¼¾⅓⅔⅛-]+/;
const WORDS = /^(cups?|c\.|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|grams?|g|kg|ml|liters?|cans?|cloves?|slices?|pieces?|pinch(es)?|dash(es)?|packages?|packets?|pkgs?|packs?|bags?|boxes?|jars?|bunch(es)?|heads?|stalks?|sticks?|large|medium|small|whole|fresh|frozen|dry|dried|cooked|chopped|diced|minced|shredded|sliced|ground|instant|of)\b\.?\s*/i;
const singular = w => /oes$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? w.slice(0, -3) + 'y' : /(ss|us|is)$/.test(w) ? w : /s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;

export function ingKey(line) {
  let s = String(line).toLowerCase().replace(/\(.*?\)/g, ' ').split(/,| - /)[0].replace(NUM, '');
  for (let i = 0; i < 8; i++) { const before = s; s = s.replace(WORDS, '').replace(NUM, ''); if (s === before) break; }
  return s.replace(/[^a-z\s&'-]/g, '').replace(/\s+/g, ' ').trim().split(' ').map(singular).join(' ');
}
const ingQty = line => (String(line).match(/^\s*[\d\/.½¼¾⅓⅔⅛\s-]+\s*(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|cans?|cloves?|slices?|packages?|packets?|packs?|bags?|jars?|bunch(es)?|heads?|stalks?)?\.?/i)?.[0] || '').trim();
const ingName = line => { const n = String(line).slice(ingQty(line).length).split(',')[0].trim(); return n.charAt(0).toUpperCase() + n.slice(1); };

const pantryKeys = () => store.list(PANTRY).map(p => ingKey(p.name)).filter(Boolean);
function matches(key, pk) {
  if (!key || !pk) return false;
  if (key === pk || key.includes(pk) || pk.includes(key)) return true;
  const a = key.split(' '), b = pk.split(' ');
  return (a.length === 1 || b.length === 1) && a[a.length - 1] === b[b.length - 1];
}
export const have = (line, pk = pantryKeys()) => { const k = ingKey(line); return STAPLES.has(k) || pk.some(p => matches(k, p)); };

// ==== recipes =======================================================================
const lines = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => s.trim()).filter(Boolean);
const libRecipes = () => LIBRARY.map(r => ({ ...r, id: 'lib:' + r.slug, lib: true, kind: 'meal' }));
const myRecipes = () => store.list(FAV).filter(f => f.kind !== 'snack');
const snacks = () => store.list(FAV).filter(f => f.kind === 'snack');
const savedSlugs = () => new Set(myRecipes().map(r => r.fromLib).filter(Boolean));
const ideas = () => libRecipes().filter(r => !savedSlugs().has(r.slug));
export const allRecipes = () => [...myRecipes(), ...ideas()];
export function getRecipe(ref) { return !ref ? null : ref.startsWith('lib:') ? libRecipes().find(r => r.id === ref) : store.get(ref); }
export const missingFor = (r, pk = pantryKeys()) => lines(r.ingredients).filter(l => !have(l, pk));

// ==== diet & allergies ================================================================
export const foodPrefs = () => store.get(GOALS_ID) || {};
const problems = r => conflicts(r, foodPrefs());
const fits = r => !problems(r).length;
// Bulk / shred (set on the Workouts page): which recipes suit the goal.
const goalNow = () => fitness().goal;
function goalFit(r) {
  const cal = Number(r.calories) || 0, pro = Number(r.protein) || 0;
  if (!cal) return 0;
  if (goalNow() === 'bulk') return cal >= 500 && pro >= 25 ? 2 : cal >= 450 ? 1 : 0;
  if (goalNow() === 'shred') return cal <= 450 && pro >= 20 ? 2 : pro / cal >= 0.06 ? 1 : 0;
  return 0;
}
const goalSort = (a, b) => goalFit(b) - goalFit(a);
const goalTag = r => (goalFit(r) === 2 ? h('span', { class: 'tag goal-tag' }, goalNow() === 'bulk' ? '💪 Bulk pick' : '🔥 Shred pick') : null);
const warnTag = r => { const p = problems(r); return p.length ? h('span', { class: 'tag red' }, '⚠ ' + p.join(', ')) : null; };

export function editFoodSettings() {
  const p = foodPrefs();
  openForm({
    title: 'Food settings',
    values: { diet: p.diet || '', allergies: p.allergies || [], avoid: p.avoid || '', calories: p.calories ?? '', protein: p.protein ?? '' },
    fields: [
      { name: 'diet', label: 'Diet', type: 'select', options: DIETS },
      { name: 'allergies', label: 'Allergies & intolerances', type: 'chips', options: ALLERGENS },
      { name: 'avoid', label: 'Other foods I avoid (comma separated)', placeholder: 'mushrooms, cilantro, spicy…' },
      { name: 'calories', label: 'Daily calorie target (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'protein', label: 'Daily protein target, grams (optional)', type: 'number', min: '0', inputmode: 'numeric' },
    ],
    note: 'Recipes that don\'t fit are hidden from ideas and searches, and flagged with ⚠ everywhere else. This is based on ingredient names, so always double-check labels, especially for serious allergies.',
    onSubmit: v => { store.save('settings', v, GOALS_ID); toast('Food settings saved'); },
  });
}

export function addGroceries(items, note = '') {
  const open = store.list(GROC).filter(g => !g.got).map(g => ingKey(g.name));
  let n = 0;
  for (const it of items) {
    const raw = typeof it === 'string' ? it : it.line;
    const name = ingName(raw) || raw.trim();
    const key = ingKey(name);
    if (!name || open.some(k => matches(key, k))) continue;
    store.save(GROC, { name, qty: ingQty(raw), note: it.note ?? note, got: false }, undefined, { hh: grocSpace() });
    open.push(key);
    n++;
  }
  return n;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function addMissing(r) {
  const n = addGroceries(missingFor(r), `for ${r.name}`);
  toast(n ? `Added ${plural(n, 'item')} to groceries` : 'Everything is already in your pantry or on your list');
}

function saveLibRecipe(r) {
  const { id: _i, lib, slug, ...rest } = r;
  const newId = store.save(FAV, { ...rest, ingredients: lines(r.ingredients).join('\n'), steps: lines(r.steps).join('\n'), kind: 'meal', fromLib: slug });
  toast(`Saved to My recipes`);
  return newId;
}

function editRecipe(r) {
  openForm({
    title: r ? 'Edit recipe' : 'New recipe',
    values: r ? { ...r, ingredients: lines(r.ingredients).join('\n'), steps: lines(r.steps).join('\n') } : { type: 'Dinner', servings: 2 },
    fields: [
      { name: 'name', label: 'Recipe name', required: true, autofocus: true },
      { name: 'type', label: 'Usually for', type: 'select', options: ['Breakfast', 'Lunch', 'Dinner', 'Snack'] },
      { name: 'servings', label: 'Servings', type: 'number', min: '1', step: '1', inputmode: 'numeric' },
      { name: 'minutes', label: 'Minutes to make', type: 'number', min: '0', step: '1', inputmode: 'numeric' },
      { name: 'ingredients', label: 'Ingredients (one per line)', type: 'textarea', rows: 6, placeholder: '1 lb chicken breast\n2 cups rice\n1 can black beans' },
      { name: 'steps', label: 'Steps (one per line)', type: 'textarea', rows: 6 },
      { name: 'calories', label: 'Calories per serving (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'protein', label: 'Protein per serving, grams (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'rating', label: 'How much do you like it?', type: 'select', options: [['', '—'], ['3', '★★★ Love it'], ['2', '★★ Good'], ['1', '★ It\'s fine']] },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => { store.save(FAV, { ...v, kind: 'meal' }, r?.id); },
    onDelete: r ? () => store.remove(r.id) : null,
  });
}

function recipeMeta(r) {
  return [r.minutes ? `${r.minutes} min` : '', r.servings ? `${r.servings} serving${r.servings == 1 ? '' : 's'}` : '',
    r.calories ? `${r.calories} cal` : '', r.protein ? `${r.protein} g protein` : ''].filter(Boolean).join(' · ');
}

export function openRecipe(r) {
  const pk = pantryKeys();
  const ing = lines(r.ingredients);
  const missing = ing.filter(l => !have(l, pk));
  openSheet({
    title: r.name,
    body: [
      problems(r).length ? h('div', { class: 'allergy-warn', role: 'alert' }, h('b', {}, '⚠ Doesn\'t fit your food settings: '), problems(r).join(', ')) : null,
      r.image ? h('img', { class: 'recipe-img', src: r.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('p', { class: 'muted' }, recipeMeta(r), r.calories ? ' (per serving, estimated)' : ''),
      r.tags?.length ? h('div', { class: 'row-meta' }, r.tags.map(t => h('span', { class: 'tag' }, t))) : null,
      h('h3', {}, 'Ingredients', h('span', { class: 'muted small' }, pk.length ? ` · ${ing.length - missing.length} of ${ing.length} at home` : '')),
      h('ul', { class: 'ing' }, ing.map(l => {
        const got = pk.length && have(l, pk);
        return h('li', { class: got ? 'have' : '' }, h('span', { class: 'ing-mark' }, got ? '✓' : '•'), l);
      })),
      lines(r.steps).length ? [h('h3', {}, 'Steps'), h('ol', { class: 'steps' }, lines(r.steps).map(s => h('li', {}, s)))] : null,
      r.notes ? [h('h3', {}, 'Notes'), h('p', {}, r.notes)] : null,
      r.url ? h('p', { class: 'small' }, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, `Original recipe${r.site ? ' on ' + r.site : ''} ↗`)) : null,
      !pk.length ? h('p', { class: 'hint' }, 'Tip: add what you have in Food → Pantry, and the app will only shop for what\'s missing.') : null,
    ],
    actions: r.web ? [
      { label: 'Save to My recipes', cls: 'primary', onClick: () => saveWebRecipe(r) },
      { label: missing.length ? `Add ${missing.length} missing to groceries` : 'Have everything ✓', disabled: !missing.length, onClick: () => addMissing(r) },
    ] : [
      { label: 'Plan it', cls: 'primary', onClick: () => planRecipe(r) },
      { label: missing.length ? `Add ${missing.length} missing to groceries` : 'Have everything ✓', disabled: !missing.length, onClick: () => addMissing(r) },
      { label: 'Ate it', onClick: () => logRecipe(r) },
      r.lib ? { label: 'Save to My recipes', onClick: () => saveLibRecipe(r) }
        : r.web ? { label: 'Save to My recipes', cls: 'primary', onClick: () => saveWebRecipe(r) }
        : { label: 'Edit', onClick: () => editRecipe(r) },
    ],
  });
}

function recipeRow(r, pk) {
  const miss = pk.length ? missingFor(r, pk).length : null;
  return h('div', { class: 'row', onclick: () => openRecipe(r) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.name, r.rating ? h('span', { class: 'stars' }, ' ' + '★'.repeat(Number(r.rating))) : null),
      h('div', { class: 'row-sub' }, recipeMeta(r)),
      (miss != null || problems(r).length || goalTag(r)) ? h('div', { class: 'row-meta' }, warnTag(r), goalTag(r),
        miss != null ? h('span', { class: miss ? 'tag' : 'tag ok-tag' }, miss ? `Need ${miss} item${miss > 1 ? 's' : ''}` : '✓ You have everything') : null) : null),
    icon('right', 18));
}

function renderRecipes(root) {
  const pk = pantryKeys();
  const prefs = foodPrefs();
  const q = recipeQuery.trim().toLowerCase();
  // search box (searches your recipes and ideas; online search is one tap further)
  const input = h('input', { type: 'search', placeholder: 'Search recipes or an ingredient…', value: recipeQuery, 'data-fk': 'recipe-q', enterkeyhint: 'search', 'aria-label': 'Search recipes',
    oninput: e => { recipeQuery = e.target.value; reRender(); } });
  root.append(h('form', { class: 'quick', onsubmit: e => { e.preventDefault(); if (recipeQuery.trim().length >= 2) doSearch(recipeQuery.trim()); } }, input,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Import a recipe from a link', title: 'Import from a link', onclick: importFromLink }, '🔗'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'New recipe', title: 'New recipe', onclick: () => editRecipe(null) }, icon('plus', 20))));
  root.append(h('div', { class: 'chip-row' },
    [['all', 'All'], ['mine', `Mine${myRecipes().length ? ` (${myRecipes().length})` : ''}`], ['make', 'Can make now'], ['snacks', 'Snacks']].map(([v, l]) =>
      h('button', { type: 'button', class: 'chip' + (recipeView === v ? ' on' : ''), onclick: () => { recipeView = v; showHidden = false; reRender(); } }, l))));
  const bars = [];
  if (goalNow() !== 'maintain') bars.push(goalNow() === 'bulk' ? '💪 Bulking: higher-calorie picks first' : '🔥 Shredding: lighter, high-protein picks first');
  if (dietIsSet(prefs)) bars.push('🍽 ' + dietSummary(prefs));
  if (bars.length) root.append(h('p', { class: 'muted small diet-line' }, bars.join(' · '), ' ', h('button', { type: 'button', class: 'mini-link', onclick: editFoodSettings }, 'Change')));

  const matchQ = r => !q || `${r.name} ${lines(r.ingredients).join(' ')} ${(r.tags || []).join(' ')} ${r.type || ''}`.toLowerCase().includes(q);

  if (recipeView === 'snacks') {
    const list = snacks().filter(matchQ).sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
    root.append(card('Snacks I like', { action: addBtn('Add', () => editSnack(null)) },
      list.length ? list.map(snackRow) : empty('Save snacks you like so they\'re easy to log and restock.')));
    return;
  }
  if (recipeView === 'make') {
    if (!pk.length) { root.append(card('What can I make?', {}, h('p', { class: 'muted' }, 'Add what\'s in your fridge and cupboards (Shopping → At home), and this shows what you can cook right now.'), h('div', { class: 'btn-row' }, btn('Add what I have', () => { tab = 'shopping'; reRender(); }, 'primary')))); return; }
    const scored = allRecipes().filter(fits).filter(matchQ).map(r => ({ r, miss: missingFor(r, pk) })).sort((a, b) => a.miss.length - b.miss.length);
    const ready = scored.filter(x => !x.miss.length);
    const close = scored.filter(x => x.miss.length > 0 && x.miss.length <= 2);
    root.append(card('Ready to cook', {}, ready.length ? ready.map(x => recipeRow(x.r, pk)) : empty('Nothing complete yet. See what\'s close below.')));
    if (close.length) root.append(card('Need just 1–2 things', {}, close.map(x => h('div', { class: 'row' },
      h('div', { class: 'row-main', onclick: () => openRecipe(x.r) }, h('div', { class: 'row-title' }, x.r.name), h('div', { class: 'row-sub' }, 'Need: ' + x.miss.map(ingName).join(', '))),
      btn('+ List', () => addMissing(x.r), 'ghost sm')))));
    return;
  }
  // All / Mine
  const mine = myRecipes().filter(matchQ).sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.name.localeCompare(b.name));
  if (recipeView === 'mine') {
    root.append(card('My recipes', { action: addBtn('New', () => editRecipe(null)) },
      mine.length ? mine.map(r => recipeRow(r, pk)) : empty(q ? 'None of your recipes match.' : 'Save recipes from All, or add your own with New.')));
  } else {
    if (mine.length) root.append(card('My recipes', {}, mine.slice(0, q ? 50 : 5).map(r => recipeRow(r, pk)),
      !q && mine.length > 5 ? h('button', { type: 'button', class: 'mini-link', onclick: () => { recipeView = 'mine'; reRender(); } }, `See all ${mine.length} ›`) : null));
    const all = ideas().filter(matchQ);
    const hidden = all.filter(r => !fits(r));
    const list = (showHidden ? all : all.filter(fits)).sort(goalSort);
    if (hidden.length) root.append(h('p', { class: 'muted small diet-line' }, `${plural(hidden.length, 'idea')} hidden by your food settings. `,
      h('button', { type: 'button', class: 'mini-link', onclick: () => { showHidden = !showHidden; reRender(); } }, showHidden ? 'Hide them' : 'Show')));
    const types = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
    if (q) root.append(card(`Ideas matching "${recipeQuery.trim()}"`, {}, list.length ? list.map(r => recipeRow(r, pk)) : empty('No ideas match.')));
    else root.append(h('div', { class: 'stack' }, types.map(t => {
      const group = list.filter(r => r.type === t);
      return group.length ? h('details', { class: 'card recipe-group', open: t === guessSlot().replace('Snacks', 'Snack') },
        h('summary', {}, h('span', { class: 'card-title' }, t === 'Snack' ? 'Snacks' : t), h('span', { class: 'muted small' }, `${group.length} ideas`)),
        group.map(r => recipeRow(r, pk))) : null;
    })));
  }
  // online search (results from the recipe database)
  if (q.length >= 2 && findResults === null) root.append(h('div', { class: 'btn-row' }, btn(`🔎 Search online for "${recipeQuery.trim()}"`, () => doSearch(recipeQuery.trim()), 'ghost sm')));
  if (findResults !== null) renderFind(root, pk);
}

// ==== find more recipes (online) ============================================================
const cleanLine = l => String(l).replace(/\s*\(\$[\d.,]+\*?\)/g, '').replace(/\s+/g, ' ').trim(); // drop "($0.20)" price notes

function webRecipe(x) {
  return { ...x, id: 'web:' + (x.sourceId || x.url), web: true, kind: 'meal', ingredients: (x.ingredients || []).map(cleanLine), steps: x.steps || [] };
}

function saveWebRecipe(r) {
  const { id: _i, web, sourceId, source, category, cuisine, video, ...rest } = r;
  const already = myRecipes().find(m => m.url && m.url === r.url);
  if (already) { toast('Already in My recipes'); return; }
  store.save(FAV, { ...rest, ingredients: lines(r.ingredients).join('\n'), steps: lines(r.steps).join('\n'), kind: 'meal', tags: undefined });
  toast(`Saved "${r.name}" to My recipes`);
}

async function doSearch(q) {
  findQuery = q;
  showHidden = false;
  findResults = 'loading';
  reRender();
  try {
    const { results } = await callFunction('recipes', { action: 'search', q });
    findResults = results.map(webRecipe);
  } catch (e) {
    findResults = { error: e.message };
  }
  reRender();
}

function importFromLink() {
  openForm({
    title: 'Import a recipe',
    fields: [{ name: 'url', label: 'Recipe page link', type: 'url', required: true, autofocus: true, placeholder: 'https://…',
      hint: 'Works with most recipe websites and blogs (Budget Bytes, Food Network, BBC Good Food, NYT Cooking…). A few big sites like Allrecipes block it.' }],
    submitLabel: 'Import',
    onSubmit: v => {
      toast('Reading the recipe…');
      callFunction('recipes', { action: 'import', url: v.url })
        .then(({ recipe }) => openRecipe(webRecipe(recipe)))
        .catch(e => toast(e.message));
    },
  });
}

function renderFind(root, pk) {
  if (!getStatus().user) { root.append(empty('Sign in to search online for more recipes.')); return; }
  if (findResults === null) return;
  if (findResults === 'loading') { root.append(empty('Searching…')); return; }
  if (findResults.error) { root.append(empty(findResults.error)); return; }
  const ok = findResults.filter(fits), hid = findResults.length - ok.length;
  const list = showHidden ? findResults : ok;
  root.append(card(`Online: ${plural(findResults.length, 'result')} for "${findQuery}"`, {
    action: h('span', { class: 'btn-row tight' }, hid ? btn(showHidden ? 'Hide unsafe' : `Show ${hid} hidden`, () => { showHidden = !showHidden; reRender(); }, 'ghost sm') : null,
      btn('✕', () => { findResults = null; reRender(); }, 'ghost sm')),
  }, list.length ? list.map(r => h('div', { class: 'row', onclick: () => openRecipe(r) },
    r.image ? h('img', { class: 'thumb', src: r.image + '/preview', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, r.name),
      h('div', { class: 'row-sub' }, [r.cuisine, r.category, `${r.ingredients.length} ingredients`].filter(Boolean).join(' · ')),
      h('div', { class: 'row-meta' }, warnTag(r), pk.length ? h('span', { class: 'tag' }, `Need ${missingFor(r, pk).length}`) : null)),
    icon('right', 18)))
    : empty(findResults.length ? 'All results were hidden by your food settings.' : 'No recipes found. Try a simpler word like "chicken" or "soup".')));
  root.append(h('p', { class: 'hint' }, 'Online recipes from TheMealDB. Calories aren\'t included, so you can add them when you save. ',
    h('a', { href: `https://www.google.com/search?q=${encodeURIComponent(findQuery + ' recipe')}`, target: '_blank', rel: 'noopener' }, 'Search the web ↗')));
}

// ==== snacks ===========================================================================
function editSnack(f) {
  openForm({
    title: f ? f.name : 'Snack I like',
    values: f || { kind: 'snack' },
    fields: [
      { name: 'name', label: 'Snack', required: true, autofocus: true },
      { name: 'where', label: 'Where to get it', placeholder: 'Walmart, gas station…' },
      { name: 'calories', label: 'Calories (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'protein', label: 'Protein, grams (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'rating', label: 'How much do you like it?', type: 'select', options: [['', '—'], ['3', '★★★ Love it'], ['2', '★★ Good'], ['1', '★ It\'s fine']] },
    ],
    onSubmit: v => { store.save(FAV, { ...v, kind: 'snack' }, f?.id); },
    onDelete: f ? () => store.remove(f.id) : null,
  });
}
function snackRow(f) {
  return h('div', { class: 'row' },
    h('div', { class: 'row-main', onclick: () => editSnack(f) },
      h('div', { class: 'row-title' }, f.name, f.rating ? h('span', { class: 'stars' }, ' ' + '★'.repeat(Number(f.rating))) : null),
      h('div', { class: 'row-sub' }, [f.where, f.calories ? `${f.calories} cal` : ''].filter(Boolean).join(' · ')),
      problems(f).length ? h('div', { class: 'row-meta' }, warnTag(f)) : null),
    h('div', { class: 'row-actions' },
      btn('Ate it', () => { store.save(LOG, { name: f.name, slot: 'Snacks', date: ymd(), calories: f.calories || '', protein: f.protein || '' }); toast(`Logged ${f.name}`); }, 'ghost sm'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Add to grocery list', title: 'Add to grocery list', onclick: () => toast(addGroceries([f.name]) ? 'Added to groceries' : 'Already on your list') }, icon('cart', 20))));
}

// ==== meal log + calories ==================================================================
export function editLog(entry, defaults = {}) {
  const names = [...allRecipes(), ...snacks()].map(f => f.name).sort();
  openForm({
    title: entry ? 'Edit entry' : 'Log food',
    values: entry || { date: day, slot: guessSlot(), ...defaults },
    fields: [
      { name: 'name', label: 'What did you eat?', required: true, autofocus: true, suggestions: names },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'calories', label: 'Calories (optional)', type: 'number', min: '0', inputmode: 'numeric', hint: 'Filled in for you when you pick a saved recipe or snack' },
      { name: 'protein', label: 'Protein, grams (optional)', type: 'number', min: '0', inputmode: 'numeric' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ],
    onSubmit: v => {
      if (!entry && v.calories === '' && v.protein === '') {
        const match = [...allRecipes(), ...snacks()].find(f => f.name.toLowerCase() === v.name.toLowerCase());
        if (match) { v.calories = match.calories || ''; v.protein = match.protein || ''; }
      }
      store.save(LOG, v, entry?.id);
    },
    onDelete: entry ? () => store.remove(entry.id) : null,
  });
}

function logRecipe(r, date = ymd(), slot) {
  const s = slot || (r.type && SLOTS.includes(r.type) ? r.type : r.type === 'Snack' ? 'Snacks' : guessSlot());
  store.save(LOG, { name: r.name, slot: s, date, calories: r.calories || '', protein: r.protein || '', recipe: r.id });
  toast(`Logged ${r.name}`);
}

function guessSlot() {
  const hr = new Date().getHours();
  return hr < 10 ? 'Breakfast' : hr < 15 ? 'Lunch' : hr < 21 ? 'Dinner' : 'Snacks';
}

export const mealsOn = d => store.list(LOG).filter(e => e.date === d);
export function dayTotals(d) {
  const e = mealsOn(d);
  return { calories: e.reduce((s, x) => s + (Number(x.calories) || 0), 0), protein: e.reduce((s, x) => s + (Number(x.protein) || 0), 0) };
}
const foodGoals = () => store.get(GOALS_ID) || {};


function totalsBlock(d) {
  const t = dayTotals(d), g = foodGoals();
  const item = (label, val, goal, unit) => h('div', { class: 'tot' },
    h('b', {}, Math.round(val).toLocaleString(), unit), h('span', {}, goal ? `of ${Number(goal).toLocaleString()}${unit} ${label}` : label),
    goal ? bar(val, goal, 'thin neutral') : null);
  return h('div', { class: 'totals' }, item('calories', t.calories, g.calories, ''), item('protein', t.protein, g.protein, ' g'));
}

/** Compact list used on the Today screen. */
export function mealsSummary(d) {
  const entries = mealsOn(d);
  const planned = store.list(PLAN).filter(p => p.date === d && !entries.some(e => e.recipe && e.recipe === p.recipe));
  const out = [];
  if (entries.length) {
    out.push(...SLOTS.filter(s => entries.some(e => e.slot === s)).map(s =>
      h('div', { class: 'row compact' }, h('span', { class: 'slot' }, s), h('div', { class: 'row-main' }, entries.filter(e => e.slot === s).map(e => e.name).join(', ')))));
    const t = dayTotals(d);
    if (t.calories || t.protein) out.push(h('p', { class: 'row-sub' }, `${Math.round(t.calories).toLocaleString()} cal · ${Math.round(t.protein)} g protein`));
  } else out.push(empty('Nothing logged yet today.'));
  if (planned.length) out.push(h('p', { class: 'row-sub' }, 'Planned: ' + planned.map(p => `${p.slot} · ${p.name}`).join(', ')));
  return out;
}

function renderMeals(root) {
  root.append(dayNav(day, d => { day = d; reRender(); }));
  const entries = mealsOn(day);
  const planned = store.list(PLAN).filter(p => p.date === day);
  const t = dayTotals(day), g = foodGoals();
  const slotRow = slot => {
    const list = entries.filter(e => e.slot === slot).sort((a, b) => (a.created || '').localeCompare(b.created || ''));
    const plan = planned.filter(p => p.slot === slot && !list.some(e => e.recipe && e.recipe === p.recipe));
    return h('div', { class: 'meal-slot' },
      h('div', { class: 'meal-slot-head' }, h('span', { class: 'slot' }, slot),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Add ${slot}`, onclick: () => editLog(null, { slot, date: day }) }, icon('plus', 18))),
      list.map(e => h('button', { type: 'button', class: 'meal-item', onclick: () => editLog(e) }, e.name,
        e.calories ? h('small', { class: 'muted' }, ` ${e.calories} cal`) : null)),
      plan.map(p => h('div', { class: 'meal-item planned' },
        h('span', { onclick: () => { const r = getRecipe(p.recipe); if (r) openRecipe(r); } }, p.name, h('small', { class: 'muted' }, ' · planned')),
        btn('Ate it', () => { const r = getRecipe(p.recipe); if (r) logRecipe(r, day, slot); else store.save(LOG, { name: p.name, slot, date: day }); }, 'ghost sm'))));
  };
  root.append(card(day === ymd() ? 'Today' : fmtDay(day), { action: btn('Targets', editFoodSettings, 'ghost sm') },
    h('p', { class: 'meal-totals' },
      h('b', {}, Math.round(t.calories).toLocaleString()), g.calories ? ` / ${Number(g.calories).toLocaleString()}` : '', ' cal · ',
      h('b', {}, Math.round(t.protein)), g.protein ? ` / ${g.protein}` : '', ' g protein'),
    g.calories ? bar(t.calories, g.calories, 'thin neutral') : null,
    SLOTS.map(slotRow)));
  renderWeek(root);
}

// ==== weekly meal plan ===================================================================
function planRecipe(r, defaults = {}) {
  openForm({
    title: `Plan: ${r.name}`,
    values: { date: ymd(), slot: SLOTS.includes(r.type) ? r.type : r.type === 'Snack' ? 'Snacks' : 'Dinner', ...defaults },
    fields: [
      { name: 'date', label: 'Day', type: 'date', required: true },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS },
    ],
    onSubmit: v => {
      store.save(PLAN, { ...v, recipe: r.id, name: r.name });
      toast(`Planned for ${relDay(v.date)}`);
    },
  });
}

function pickForDay(date, slot = 'Dinner') {
  const opts = [['', 'Choose a recipe…'], ...myRecipes().map(r => [r.id, (fits(r) ? '★ ' : '⚠ ') + r.name]), ...ideas().filter(fits).map(r => [r.id, r.name])];
  openForm({
    title: `Plan ${fmtDay(date)}`,
    values: { slot },
    fields: [
      { name: 'recipe', label: 'Recipe', type: 'select', options: opts },
      { name: 'custom', label: '…or type something else', placeholder: 'Leftovers, eating out…' },
      { name: 'slot', label: 'Meal', type: 'select', options: SLOTS },
    ],
    onSubmit: v => {
      const r = getRecipe(v.recipe);
      if (!r && !v.custom) { toast('Pick a recipe or type something'); return false; }
      store.save(PLAN, { date, slot: v.slot, recipe: r?.id || '', name: r?.name || v.custom });
    },
  });
}

function weekMissing() {
  const pk = pantryKeys();
  const plans = store.list(PLAN).filter(p => p.date >= week && p.date <= addDays(week, 6));
  const need = new Map(); // key → { line, recipes:Set }
  for (const p of plans) {
    const r = getRecipe(p.recipe);
    if (!r) continue;
    for (const l of missingFor(r, pk)) {
      const k = ingKey(l);
      if (!need.has(k)) need.set(k, { line: l, recipes: new Set() });
      need.get(k).recipes.add(r.name);
    }
  }
  return [...need.values()];
}

function renderWeek(root) {
  const plans = store.list(PLAN);
  const miss = weekMissing();
  const label = week === mondayOf(ymd()) ? 'This week' : `${fmtDay(week, { month: 'short', day: 'numeric' })} – ${fmtDay(addDays(week, 6), { month: 'short', day: 'numeric' })}`;
  root.append(card('Meal plan', {
    action: h('span', { class: 'btn-row tight' },
      iconBtn('left', () => { week = addDays(week, -7); reRender(); }, 'Previous week'),
      h('button', { type: 'button', class: 'mini-link', onclick: () => { week = mondayOf(ymd()); reRender(); } }, label),
      iconBtn('right', () => { week = addDays(week, 7); reRender(); }, 'Next week')),
  },
  Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(d => {
    const list = plans.filter(p => p.date === d).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    return h('div', { class: 'week-row' + (d === ymd() ? ' today' : '') },
      h('span', { class: 'week-day' }, parseYmd(d).toLocaleDateString(undefined, { weekday: 'short' })),
      h('div', { class: 'week-items' }, list.length ? list.map(p => h('span', { class: 'plan-chip' },
        h('span', { onclick: () => { const r = getRecipe(p.recipe); if (r) openRecipe(r); } }, p.name),
        h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${p.name}`, onclick: () => store.remove(p.id) }, '×'))) : h('span', { class: 'muted small' }, '—')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Plan ${fmtDay(d)}`, onclick: () => pickForDay(d) }, icon('plus', 18)));
  }),
  miss.length ? h('div', { class: 'btn-row' }, btn(`🛒 Add ${plural(miss.length, 'missing ingredient')} to groceries`, () => {
    const n = addGroceries(miss.map(m => ({ line: m.line, note: 'for ' + [...m.recipes].join(', ') })));
    toast(n ? `Added ${plural(n, 'item')} to groceries` : 'Already on your list');
  }, 'ghost sm')) : null));
}

// ==== pantry / fridge =======================================================================
const pantryOpen = new Set(['Fridge']);
function editPantry(p) {
  openForm({
    title: p ? p.name : 'Add to pantry',
    values: p || { where: 'Fridge' },
    fields: [
      { name: 'name', label: 'Item', required: true, autofocus: true },
      { name: 'where', label: 'Where', type: 'select', options: PLACES },
      { name: 'qty', label: 'How much', placeholder: 'half a bag, 2 cans…' },
      { name: 'expires', label: 'Use by (optional)', type: 'date' },
    ],
    onSubmit: v => { store.save(PANTRY, v, p?.id); },
    onDelete: p ? () => store.remove(p.id) : null,
    deleteLabel: 'Used up / remove',
  });
}

function pantryRow(p) {
  const days = p.expires ? daysBetween(ymd(), p.expires) : null;
  return h('div', { class: 'row' },
    h('div', { class: 'row-main', onclick: () => editPantry(p) },
      h('div', { class: 'row-title' }, p.name, p.qty ? h('span', { class: 'qty' }, ` · ${p.qty}`) : null),
      p.expires ? h('div', { class: 'row-meta' }, h('span', { class: days <= 2 ? 'tag red' : 'tag' }, days < 0 ? 'Expired' : days === 0 ? 'Use today' : `Use by ${relDay(p.expires)}`)) : null),
    h('div', { class: 'row-actions' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Running low on ${p.name}: add to grocery list`, title: 'Running low? Add to grocery list', onclick: () => toast(addGroceries([p.name], 'restock') ? 'Added to groceries' : 'Already on your list') }, icon('cart', 20)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Used up ${p.name}`, title: 'Used up', onclick: () => store.remove(p.id) }, icon('trash', 18))));
}

function renderPantry(root) {
  root.append(h('h2', { class: 'section-title' }, 'At home', h('small', { class: 'muted' }, ' · what you already have, so recipes and lists know')));
  const input = h('input', { type: 'text', placeholder: 'Add what you have… (commas add several)', 'data-fk': 'pantry-quick', enterkeyhint: 'done', 'aria-label': 'Pantry item' });
  const where = h('select', { 'aria-label': 'Where' }, PLACES.map(p => h('option', {}, p)));
  root.append(h('form', {
    class: 'quick quick-pantry',
    onsubmit: e => {
      e.preventDefault();
      const existing = store.list(PANTRY).map(p => ingKey(p.name));
      for (const raw of input.value.split(',')) {
        const name = raw.trim().replace(/^./, c => c.toUpperCase());
        if (name && !existing.includes(ingKey(name))) { store.save(PANTRY, { name, where: where.value }); existing.push(ingKey(name)); }
      }
    },
  }, input, where, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));

  const all = store.list(PANTRY).sort((a, b) => a.name.localeCompare(b.name));
  if (!all.length) { root.append(empty('Add what\'s in your fridge, freezer and cupboards. Then recipes show what you can make, and the shopping list skips what you already have.')); return; }
  const open = pantryOpen;
  const soon = all.filter(p => p.expires && daysBetween(ymd(), p.expires) <= 3).sort((a, b) => a.expires.localeCompare(b.expires));
  const wrap = h('div', { class: 'grid' });
  if (soon.length) wrap.append(card('Use soon', { cls: 'warn' }, soon.map(pantryRow)));
  for (const place of PLACES) {
    const list = all.filter(p => (p.where || 'Pantry') === place);
    if (list.length) wrap.append(h('details', { class: 'card recipe-group', open: open.has(place), ontoggle: e => { e.target.open ? open.add(place) : open.delete(place); } },
      h('summary', {}, h('span', { class: 'card-title' }, place), h('span', { class: 'muted small' }, `${list.length} item${list.length === 1 ? '' : 's'}`)), list.map(pantryRow)));
  }
  root.append(wrap);
}

// ==== groceries =================================================================================
// The list can be shared with a person or your household: new items go into that shared space.
const GSHARE_ID = 'settings:grocshare';
function grocSpace() { const id = (store.get(GSHARE_ID) || {}).hh; return id && spaceById(id) ? id : ''; }
function shareList() {
  openForm({
    title: 'Share your shopping list',
    note: 'Everyone you share with sees the same list live and can add or check off items.',
    fields: [{ name: 'who', label: 'Share with', type: 'select', options: shareOptions().filter(o => o[0] !== '') }],
    values: { who: spaces()[0]?.id || '__new' },
    submitLabel: 'Share',
    onSubmit: v => resolveShare(v.who).then(hh => { if (hh) useSharedList(hh); }),
  });
}
function useSharedList(hh) {
  store.save('settings', { hh }, GSHARE_ID);
  for (const g of store.list(GROC).filter(x => !store.householdOf(x.id) && !x.got)) moveTo(GROC, g, hh);
  toast(`Shopping list shared with ${spaceLabel(spaceById(hh))} ✓`);
}
function stopSharingList() {
  if (!confirm('Stop sharing? Items already on the shared list stay there for the others. New items will be private.')) return;
  store.save('settings', { hh: '' }, GSHARE_ID);
}
function groceryShareBar() {
  if (!canShare()) return null;
  const cur = grocSpace();
  if (cur) {
    const g = spaceById(cur);
    return h('div', { class: 'diet-bar share-bar' }, h('span', {}, `${spaceIcon(g)} Shared with `, h('b', {}, spaceLabel(g))), btn('Stop sharing', stopSharingList, 'ghost sm'));
  }
  // someone shared a list with me?
  const theirs = [...new Set(store.list(GROC).map(x => store.householdOf(x.id)).filter(Boolean))].map(spaceById).filter(Boolean);
  if (theirs.length) return h('div', { class: 'diet-bar share-bar' },
    h('span', {}, `${spaceIcon(theirs[0])} ${spaceLabel(theirs[0])} shared a shopping list with you`),
    btn('Add my items to it', () => useSharedList(theirs[0].id), 'primary sm'));
  return h('div', { class: 'diet-bar' }, h('span', { class: 'muted' }, 'Shop with someone?'), btn('👥 Share list', shareList, 'ghost sm'));
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
      { name: 'note', label: 'Note' },
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
      (g.aisle || g.note) ? h('div', { class: 'row-meta' }, g.aisle ? h('span', { class: 'tag' }, g.aisle) : null, g.note ? h('span', { class: 'row-sub' }, g.note) : null) : null));
}

function putAway(items) {
  const existing = store.list(PANTRY).map(p => ingKey(p.name));
  for (const g of items) {
    if (!existing.includes(ingKey(g.name))) store.save(PANTRY, { name: g.name, where: 'Pantry', qty: g.qty || '' });
    store.remove(g.id);
  }
  toast(`Put ${plural(items.length, 'item')} away in your pantry`);
}

function renderGroceries(root) {
  const sb = groceryShareBar();
  if (sb) root.append(sb);
  const input = h('input', { type: 'text', placeholder: 'Add an item… (commas add several)', 'data-fk': 'groc-quick', enterkeyhint: 'done', 'aria-label': 'Grocery item' });
  root.append(h('form', {
    class: 'quick',
    onsubmit: e => { e.preventDefault(); addGroceries(input.value.split(',').filter(s => s.trim())); },
  }, input, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));

  const all = store.list(GROC);
  const need = all.filter(g => !g.got).sort((a, b) => (a.aisle || '~').localeCompare(b.aisle || '~') || (a.created || '').localeCompare(b.created || ''));
  const got = all.filter(g => g.got);
  root.append(card(`To buy (${need.length})`, {}, need.length ? need.map(groceryRow) : empty('List is empty. Add items above, or plan meals and add what\'s missing.')));
  if (got.length) {
    root.append(card('In the cart', {
      action: h('div', { class: 'row-actions' },
        btn('Put away', () => putAway(got), 'ghost sm'),
        btn('Clear', () => got.forEach(g => store.remove(g.id)), 'ghost sm')),
    }, got.map(groceryRow), h('p', { class: 'hint' }, '"Put away" moves these into your pantry so recipes know you have them.')));
  }
}

// ==== screen =====================================================================================
let reRender = () => {};
export function render(root, ctx) {
  reRender = ctx.rerender;
  root.append(pageHead('Food', { actions: [iconBtn('settings', editFoodSettings, 'Food settings: allergies, diet, targets'), addBtn('Log', () => editLog(null))] }));
  const gc = groceryCount();
  root.append(seg([['meals', 'Meals'], ['recipes', 'Recipes'], ['shopping', `Shopping${gc ? ` (${gc})` : ''}`]], tab, v => { tab = v; reRender(); }));
  if (tab === 'recipes') renderRecipes(root);
  else if (tab === 'shopping') { renderGroceries(root); renderPantry(root); }
  else renderMeals(root);
}
