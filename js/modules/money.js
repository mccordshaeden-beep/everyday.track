// money.js — monthly budget, spending log, and subscription tracker.
import * as store from '../store.js';
import { h, pageHead, card, empty, seg, addBtn, btn, icon, iconBtn, openForm, bar, money, ymd, addDays, addMonths, daysBetween, relDay, fmtDay, parseYmd } from '../ui.js';

export const id = 'money';
export const title = 'Money';
export const glyph = 'money';

const TX = 'txns';        // { date, amount, type: 'expense'|'income', category, note }
const SUBS = 'subs';      // { name, amount, cycle, nextDate, category, active, notes }
const BUDGET_ID = 'settings:budget'; // { income, categories: [{ name, limit }] }
const DEFAULT_CATS = [
  { name: 'Groceries', limit: 250 }, { name: 'Eating out', limit: 100 }, { name: 'Gas & transport', limit: 100 },
  { name: 'Fun', limit: 75 }, { name: 'Shopping', limit: 75 }, { name: 'Other', limit: 50 },
];

let tab = 'budget';
let month = ymd().slice(0, 7);
export function setTab(t) { tab = t; }

// ---- budget ------------------------------------------------------------------------
export function getBudget() {
  const b = store.get(BUDGET_ID);
  return { income: b?.income || '', categories: b?.categories?.length ? b.categories : DEFAULT_CATS, isDefault: !b };
}
const catNames = () => getBudget().categories.map(c => c.name);

function editBudget() {
  const b = getBudget();
  openForm({
    title: 'Monthly budget',
    values: { income: b.income, cats: b.categories.map(c => `${c.name}: ${c.limit}`).join('\n') },
    fields: [
      { name: 'income', label: 'Monthly income (optional)', type: 'number', step: '0.01', inputmode: 'decimal' },
      { name: 'cats', label: 'Categories: one per line, "Name: amount"', type: 'textarea', rows: 9 },
    ],
    onSubmit: v => {
      const categories = v.cats.split('\n').map(line => {
        const m = line.match(/^(.+?)\s*[:=-]\s*\$?([\d,.]+)\s*$/);
        return m ? { name: m[1].trim(), limit: Number(m[2].replace(/,/g, '')) } : line.trim() ? { name: line.trim(), limit: 0 } : null;
      }).filter(Boolean);
      store.save('settings', { income: v.income, categories }, BUDGET_ID);
    },
  });
}

export function monthStats(ym) {
  const txns = store.list(TX).filter(t => t.date?.startsWith(ym));
  const spent = txns.filter(t => t.type !== 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const income = txns.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const byCat = {};
  for (const t of txns) if (t.type !== 'income') byCat[t.category || 'Other'] = (byCat[t.category || 'Other'] || 0) + (Number(t.amount) || 0);
  const budget = getBudget();
  const limit = budget.categories.reduce((s, c) => s + (Number(c.limit) || 0), 0);
  return { txns, spent, income, byCat, budget, limit };
}

/** Big "spent of budget" block, used here and on the Today screen. */
export function summaryBlock(ym) {
  const s = monthStats(ym);
  const left = s.limit - s.spent;
  return h('div', { class: 'money-sum' },
    h('div', { class: 'big' }, money(s.spent)),
    h('div', { class: 'row-sub' }, s.limit ? `spent of ${money(s.limit)} · ` : 'spent · ',
      s.limit ? h('b', { class: left >= 0 ? 'ok' : 'bad' }, left >= 0 ? `${money(left)} left` : `${money(-left)} over`) : null),
    s.limit ? bar(s.spent, s.limit) : null);
}

function monthNav(ctx) {
  const label = parseYmd(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return h('div', { class: 'daynav' },
    iconBtn('left', () => { month = addMonths(month + '-01', -1).slice(0, 7); ctx.rerender(); }, 'Previous month'),
    h('button', { type: 'button', class: 'daynav-label', onclick: () => { month = ymd().slice(0, 7); ctx.rerender(); } }, label),
    iconBtn('right', () => { month = addMonths(month + '-01', 1).slice(0, 7); ctx.rerender(); }, 'Next month'));
}

function renderBudget(root, ctx) {
  root.append(monthNav(ctx));
  const s = monthStats(month);
  const subsMo = subsMonthly();
  const grid = h('div', { class: 'grid' });

  grid.append(card('This month', { action: btn('Edit budget', editBudget, 'ghost sm') },
    summaryBlock(month),
    h('dl', { class: 'facts' },
      s.income || s.budget.income ? [h('dt', {}, 'Income'), h('dd', {}, money(s.income || s.budget.income))] : null,
      h('dt', {}, 'Subscriptions'), h('dd', {}, `${money(subsMo)}/mo`)),
    s.budget.isDefault ? h('p', { class: 'hint' }, 'These categories are examples. Tap "Edit budget" to set your own.') : null));

  const cats = [...s.budget.categories];
  for (const name of Object.keys(s.byCat)) if (!cats.some(c => c.name === name)) cats.push({ name, limit: 0 });
  grid.append(card('By category', {}, cats.map(c => {
    const spent = s.byCat[c.name] || 0;
    return h('div', { class: 'cat' },
      h('div', { class: 'cat-line' }, h('span', {}, c.name), h('span', { class: c.limit && spent > c.limit ? 'bad' : 'muted' }, `${money(spent)}${c.limit ? ' / ' + money(c.limit) : ''}`)),
      c.limit ? bar(spent, c.limit) : null);
  })));
  root.append(grid);
}

// ---- spending ------------------------------------------------------------------------
export function editTxn(t, defaults = {}) {
  openForm({
    title: t ? 'Edit' : 'Add spending',
    values: t || { date: ymd(), type: 'expense', category: catNames()[0], ...defaults },
    fields: [
      { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true, autofocus: true },
      { name: 'type', label: 'Type', type: 'select', options: [['expense', 'Spent'], ['income', 'Money in']] },
      { name: 'category', label: 'Category', type: 'select', options: [...new Set([...catNames(), 'Subscriptions', 'Income', 'Other'])] },
      { name: 'note', label: 'What for?', placeholder: 'Chipotle, gas, rent…' },
      { name: 'date', label: 'Date', type: 'date', required: true },
    ],
    onSubmit: v => { store.save(TX, v, t?.id); },
    onDelete: t ? () => store.remove(t.id) : null,
  });
}

function renderSpending(root, ctx) {
  const amount = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '$0.00', 'data-fk': 'tx-amt', 'aria-label': 'Amount', required: true });
  const cat = h('select', { 'aria-label': 'Category' }, catNames().map(c => h('option', {}, c)));
  const note = h('input', { type: 'text', placeholder: 'What for?', 'aria-label': 'Note', enterkeyhint: 'done' });
  root.append(h('form', {
    class: 'quick quick-money',
    onsubmit: e => {
      e.preventDefault();
      if (!amount.value) return;
      store.save(TX, { amount: Number(amount.value), category: cat.value, note: note.value.trim(), type: 'expense', date: ymd() });
      amount.focus();
    },
  }, amount, cat, note, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));

  root.append(monthNav(ctx));
  const txns = monthStats(month).txns.sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
  if (!txns.length) { root.append(empty('No spending logged this month.')); return; }
  const days = [...new Set(txns.map(t => t.date))];
  root.append(h('div', { class: 'stack' }, days.map(d => {
    const list = txns.filter(t => t.date === d);
    return card(relDay(d), {}, list.map(t => h('div', { class: 'row', onclick: () => editTxn(t) },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.note || t.category), h('div', { class: 'row-sub' }, t.category)),
      h('div', { class: t.type === 'income' ? 'amt in' : 'amt' }, (t.type === 'income' ? '+' : '') + money(t.amount)))));
  })));
}

// ---- subscriptions ----------------------------------------------------------------------
const PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const subMonthly = s => (Number(s.amount) || 0) * (PER_MONTH[s.cycle] ?? 1);
export const subsMonthly = () => store.list(SUBS).filter(s => s.active !== false).reduce((sum, s) => sum + subMonthly(s), 0);

/** Next billing date on or after today, counting forward from the date you entered. */
export function nextRenewal(s) {
  if (!s.nextDate) return null;
  const today = ymd();
  const step = { weekly: 0, monthly: 1, quarterly: 3, yearly: 12 }[s.cycle] ?? 1;
  let d = s.nextDate;
  for (let k = 1; d < today && k < 2000; k++) d = step ? addMonths(s.nextDate, k * step) : addDays(s.nextDate, 7 * k);
  return d;
}

export function upcomingSubs(withinDays = 7) {
  const today = ymd();
  return store.list(SUBS).filter(s => s.active !== false)
    .map(s => ({ ...s, next: nextRenewal(s) }))
    .filter(s => s.next && daysBetween(today, s.next) <= withinDays)
    .sort((a, b) => a.next.localeCompare(b.next));
}

function editSub(s) {
  openForm({
    title: s ? s.name : 'New subscription',
    values: s || { cycle: 'monthly', active: true, nextDate: ymd(), category: 'Subscriptions' },
    fields: [
      { name: 'name', label: 'Name', required: true, autofocus: true, placeholder: 'Spotify, Netflix, iCloud…' },
      { name: 'amount', label: 'Cost ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true },
      { name: 'cycle', label: 'Billed', type: 'select', options: [['monthly', 'Monthly'], ['yearly', 'Yearly'], ['quarterly', 'Every 3 months'], ['weekly', 'Weekly']] },
      { name: 'nextDate', label: 'A billing date (next or last one)', type: 'date', required: true },
      { name: 'category', label: 'Category', suggestions: ['Subscriptions', 'Streaming', 'Music', 'School', 'Phone', 'Software', 'Fitness'] },
      { name: 'active', label: 'Active (uncheck if paused or canceled)', type: 'checkbox' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Which card, how to cancel, free trial ends…' },
    ],
    onSubmit: v => { store.save(SUBS, v, s?.id); },
    onDelete: s ? () => store.remove(s.id) : null,
  });
}

function subRow(s) {
  const next = nextRenewal(s);
  const days = next ? daysBetween(ymd(), next) : null;
  return h('div', { class: 'row' + (s.active === false ? ' done' : ''), onclick: () => editSub(s) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.name),
      h('div', { class: 'row-meta' },
        s.active === false ? h('span', { class: 'tag' }, 'Paused') :
          next ? h('span', { class: days <= 3 ? 'tag red' : 'tag' }, days === 0 ? 'Renews today' : `Renews ${relDay(next)}${days > 1 && days < 7 ? ` (${days} days)` : ''}`) : null,
        s.category ? h('span', { class: 'tag' }, s.category) : null)),
    h('div', { class: 'amt' }, money(s.amount), h('small', {}, '/' + ({ monthly: 'mo', yearly: 'yr', quarterly: '3mo', weekly: 'wk' }[s.cycle] || 'mo'))));
}

function renderSubs(root) {
  const all = store.list(SUBS).map(s => ({ ...s, _next: nextRenewal(s) || '9999' }));
  const active = all.filter(s => s.active !== false).sort((a, b) => a._next.localeCompare(b._next));
  const paused = all.filter(s => s.active === false);
  const mo = subsMonthly();
  root.append(h('div', { class: 'stat-row' },
    h('div', { class: 'stat' }, h('b', {}, money(mo)), h('span', {}, 'per month')),
    h('div', { class: 'stat' }, h('b', {}, money(mo * 12)), h('span', {}, 'per year')),
    h('div', { class: 'stat' }, h('b', {}, String(active.length)), h('span', {}, 'active'))));
  root.append(card('By next renewal', { action: addBtn('Add', () => editSub(null)) },
    active.length ? active.map(subRow) : empty('Add your subscriptions to see what you pay each month and when each one renews.')));
  if (paused.length) root.append(card('Paused or canceled', {}, paused.map(subRow)));
}

export function render(root, ctx) {
  root.append(pageHead('Money', { actions: [addBtn('Spent', () => editTxn(null))] }));
  root.append(seg([['budget', 'Budget'], ['spending', 'Spending'], ['subs', 'Subscriptions']], tab, v => { tab = v; ctx.rerender(); }));
  if (tab === 'budget') renderBudget(root, ctx);
  else if (tab === 'spending') renderSpending(root, ctx);
  else renderSubs(root);
}
