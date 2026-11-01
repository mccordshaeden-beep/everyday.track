// money.js — built around one number: Safe to spend.
//   Safe to spend = income − bills & subscriptions − savings − what you've spent so far.
// Tabs: This month (the number, what's coming up, categories, heads-up) · Activity (every
// transaction in one list: typed in, imported from the bank, money in) · Plan (income,
// savings, category limits, bills, subscriptions, goals and the Grow calculator).
import * as store from '../store.js';
import {
  h, pageHead, card, empty, seg, addBtn, btn, icon, iconBtn, openForm, openSheet, bar, barChart, money, toast,
  ymd, addDays, addMonths, daysBetween, relDay, parseYmd, fmtMonthYear,
  CYCLES, PER_MONTH, CYCLE_SHORT, nthOccurrence, nextOnOrAfter, countOccurrences,
} from '../ui.js';
import { setBankRerender, importBank, legacyCount, migrateLegacy, dropLegacy, setOnImported, categories as allCats, merchantKey, cleanMerchant, learnedRules, RULES_ID, guessCategory } from './bank.js';
import { findSubscriptions, dismissSubscription, trackSubscription, priceChanges, waysToSave, subKey } from './moneysmart.js';

export const id = 'money';
export const title = 'Money';
export const glyph = 'money';

const TX = 'txns';        // { date, amount, type: 'expense'|'income', category, note }
const SUBS = 'subs';      // { name, amount, cycle, started, nextDate, category, active, notes }
const BILLS = 'bills';    // { name, amount, cycle, dueDate, category, autopay, notes }
const PAID = 'billpays';  // id "bp:<billId>:<dueDate>" → { billId, due, paidOn, amount }
const GOALS = 'goals';    // { name, emoji, target, saved, deadline }
const BUDGET_ID = 'settings:budget'; // { income, save, categories: [{ name, limit }] }
const GROW_ID = 'settings:grow';     // { start, monthly, years, rate }
const DEFAULT_CATS = [
  { name: 'Groceries', limit: 250 }, { name: 'Eating out', limit: 100 }, { name: 'Gas & transport', limit: 100 },
  { name: 'Fun', limit: 75 }, { name: 'Shopping', limit: 75 }, { name: 'Other', limit: 50 },
];

// Three tabs: This month (safe to spend) · Activity (everything in one list) · Plan.
let tab = 'month';
let month = ymd().slice(0, 7);
let actFilter = 'all';
let growOpen = false;
const OLD_TABS = { budget: 'month', insights: 'month', spending: 'activity', subs: 'plan', bank: 'activity', bills: 'plan', goals: 'plan', grow: 'plan' };
export function setTab(t) { tab = OLD_TABS[t] || (['month', 'activity', 'plan'].includes(t) ? t : 'month'); }

// ---- budget ------------------------------------------------------------------------
export function getBudget() {
  const b = store.get(BUDGET_ID);
  return { income: b?.income || '', save: b?.save ?? '', categories: b?.categories?.length ? b.categories : DEFAULT_CATS, isDefault: !b };
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
      store.save('settings', { income: v.income, categories }, BUDGET_ID); // (save is kept: store.save merges)
    },
  });
}

export function monthStats(ym) {
  const txns = store.list(TX).filter(t => t.date?.startsWith(ym));
  const counted = txns.filter(t => t.category !== 'Transfer');
  const spent = counted.filter(t => t.type !== 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const income = counted.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const byCat = {};
  for (const t of counted) if (t.type !== 'income') byCat[t.category || 'Other'] = (byCat[t.category || 'Other'] || 0) + (Number(t.amount) || 0);
  const budget = getBudget();
  const limit = budget.categories.reduce((s, c) => s + (Number(c.limit) || 0), 0);
  return { txns, spent, income, byCat, budget, limit };
}

// ---- safe to spend -------------------------------------------------------------------------------
const FIXED = ['Bills', 'Subscriptions'];
const dimOf = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
/** Savings a month that would hit every goal with a date on time. */
export function goalsMonthly() {
  return store.list(GOALS).reduce((sum, g) => {
    const left = Math.max(0, (Number(g.target) || 0) - (Number(g.saved) || 0));
    if (!left || !g.deadline || g.deadline < ymd()) return sum;
    return sum + left / Math.max(1, Math.ceil(daysBetween(ymd(), g.deadline) / 30.4));
  }, 0);
}
export function safeToSpend(ym = ymd().slice(0, 7)) {
  const s = monthStats(ym);
  const planned = Number(s.budget.income) || 0;
  const income = Math.max(planned, s.income);             // planned paycheck or what actually came in, whichever is more
  const fixedPaid = FIXED.reduce((a, c) => a + (s.byCat[c] || 0), 0);
  const fixedPlan = subsMonthly() + billsMonthly();
  const fixed = Math.max(fixedPlan, fixedPaid);            // your list of bills/subs, or what was really paid
  const savedLogged = s.byCat.Savings || 0;
  const save = Math.max(Number(s.budget.save) || 0, savedLogged);
  const flexSpent = Math.max(0, s.spent - fixedPaid - savedLogged); // everyday spending
  const left = income - fixed - save - flexSpent;
  const isNow = ym === ymd().slice(0, 7);
  const today = Number(ymd().slice(8));
  const daysLeft = isNow ? dimOf(ym) - today + 1 : 0;
  const perDay = daysLeft ? Math.max(0, left) / daysLeft : 0;
  const weekDays = isNow ? Math.min(daysLeft, 7 - ((new Date().getDay() + 6) % 7)) : 0; // through Sunday
  return { ...s, planned, income, fixed, fixedPlan, fixedPaid, save, flexSpent, left, isNow, daysLeft, perDay, week: perDay * weekDays, hasPlan: income > 0,
    flexBudget: income - fixed - save };
}

/** The Safe-to-spend block, used here and on the Today screen. */
export function summaryBlock(ym) {
  const p = safeToSpend(ym);
  if (!p.hasPlan) {
    const s = p;
    return h('div', { class: 'money-sum' },
      h('div', { class: 'big' }, money(s.spent)), h('div', { class: 'row-sub' }, 'spent this month · set your income in Money → Plan to see what\'s safe to spend'));
  }
  return h('div', { class: 'money-sum' },
    h('div', { class: 'big ' + (p.left >= 0 ? 'ok' : 'bad') }, money0(p.left)),
    h('div', { class: 'row-sub' }, p.left >= 0 ? `safe to spend${p.isNow ? ` · about ${money0(Math.floor(p.perDay))}/day` : ''}` : 'over your plan this month'),
    bar(p.flexSpent, Math.max(1, p.flexBudget), 'budget' + (p.flexBudget > 0 && p.flexSpent / p.flexBudget >= 0.8 && p.flexSpent <= p.flexBudget ? ' warn' : '')));
}

function editIncome() {
  openForm({
    title: 'Monthly income',
    values: { income: getBudget().income },
    note: 'Roughly what you take home in a month, after taxes. If more actually comes in (logged or imported), the larger amount is used.',
    fields: [{ name: 'income', label: 'Monthly income ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', autofocus: true }],
    onSubmit: v => { const b = getBudget(); store.save('settings', { income: Math.max(0, Number(v.income) || 0), categories: b.categories }, BUDGET_ID); toast('Income saved ✓'); },
  });
}
function editSave() {
  const sug = Math.ceil(goalsMonthly());
  openForm({
    title: 'Savings each month',
    values: { save: getBudget().save },
    note: `Set this aside first, before everyday spending. ${sug ? `To hit your goals on time you'd need about ${money(sug)}/month.` : 'Many people aim for 10–20% of income.'} Log money you move to savings with the category "Savings".`,
    fields: [{ name: 'save', label: 'Save each month ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', autofocus: true }],
    onSubmit: v => { const b = getBudget(); store.save('settings', { income: b.income, save: Math.max(0, Number(v.save) || 0), categories: b.categories }, BUDGET_ID); toast('Saved ✓'); },
  });
}
function addCategory() {
  openForm({
    title: 'New category',
    fields: [
      { name: 'name', label: 'Name', required: true, autofocus: true, placeholder: 'Rent, Groceries, Fun money…' },
      { name: 'limit', label: 'Monthly limit ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true },
    ],
    onSubmit: v => {
      const b = getBudget();
      const name = v.name.trim().slice(0, 60);
      if (b.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return false; }
      store.save('settings', { income: b.income, categories: [...b.categories, { name, limit: Math.max(0, Number(v.limit) || 0) }] }, BUDGET_ID);
      toast('Category added ✓');
    },
  });
}
/** Budget bar: amber from 80%, red when over. */
const budgetBar = (spent, limit) => bar(spent, limit, `budget${limit > 0 && spent <= limit && spent / limit >= 0.8 ? ' warn' : ''}`);

function monthNav(ctx) {
  const label = parseYmd(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return h('div', { class: 'daynav' },
    iconBtn('left', () => { month = addMonths(month + '-01', -1).slice(0, 7); ctx.rerender(); }, 'Previous month'),
    h('button', { type: 'button', class: 'daynav-label', onclick: () => { month = ymd().slice(0, 7); ctx.rerender(); } }, label),
    iconBtn('right', () => { month = addMonths(month + '-01', 1).slice(0, 7); ctx.rerender(); }, 'Next month'));
}

// ---- spending ------------------------------------------------------------------------
const sameMerchant = t => { const k = merchantKey(t.desc || t.note || ''); return k ? store.list(TX).filter(x => x.id !== t.id && x.type === t.type && merchantKey(x.desc || x.note || '') === k) : []; };
/** Remember "<merchant> → category" for future imports and move matching transactions. */
export function sortMerchant(t, category, applyAll = true) {
  const k = merchantKey(t.desc || t.note || '');
  if (k && t.source === 'bank') {
    const r = (store.get(RULES_ID) || {}).rules || {};
    store.save('settings', { rules: { ...r, [k]: category } }, RULES_ID);
  }
  store.save(TX, { category, catSet: true }, t.id);
  let n = 0;
  if (applyAll) for (const x of sameMerchant(t)) if (x.category !== category) { store.save(TX, { category, catSet: true }, x.id); n++; }
  return n;
}
export function editTxn(t, defaults = {}) {
  const others = t ? sameMerchant(t).length : 0;
  openForm({
    title: t ? 'Edit' : 'Add spending',
    values: t ? { ...t, applyAll: true } : { date: ymd(), type: 'expense', category: catNames()[0], ...defaults },
    fields: [
      { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true, autofocus: true },
      { name: 'type', label: 'Type', type: 'select', options: [['expense', 'Spent'], ['income', 'Money in']] },
      { name: 'category', label: 'Category', type: 'select', options: allCats(catNames()), hint: t?.source === 'bank' ? `From your bank: "${String(t.desc || '').slice(0, 60)}"` : '' },
      ...(others ? [{ name: 'applyAll', label: `Also change the ${others} other${others === 1 ? '' : 's'} from ${cleanMerchant(t.desc || t.note)} (and remember it)`, type: 'checkbox' }] : []),
      { name: 'note', label: 'What for?', placeholder: 'Chipotle, gas, rent…' },
      { name: 'date', label: 'Date', type: 'date', required: true },
    ],
    onSubmit: v => {
      const { applyAll, ...fields } = v;
      if (t && v.category !== t.category) {
        store.save(TX, fields, t.id);
        const n = sortMerchant({ ...t, ...fields }, v.category, !!applyAll);
        if (n) toast(`Moved ${n + 1} ${cleanMerchant(t.desc || t.note)} transactions to ${v.category} ✓`);
        return;
      }
      store.save(TX, fields, t?.id);
    },
    onDelete: t ? () => store.remove(t.id) : null,
  });
}

// ---- sorting -----------------------------------------------------------------------------------
const needsSorting = list => list.filter(t => t.category === 'Other' && !t.catSet && t.type !== 'income');
const QUICK_CATS = ['Groceries', 'Eating out', 'Coffee & treats', 'Gas & transport', 'Shopping', 'Fun', 'Bills', 'Subscriptions', 'Health', 'Personal care', 'Education', 'Gifts & giving', 'Transfer'];
function sortSheet(list) {
  const body = h('div', { class: 'stack-sm' });
  let left = [...list];
  const draw = () => {
    if (!left.length) { body.replaceChildren(h('p', {}, '✓ All sorted. Places you sorted will be sorted automatically next time.')); return; }
    const groups = {};
    for (const t of left) (groups[merchantKey(t.desc || t.note || '') || t.id] ||= []).push(t);
    body.replaceChildren(h('p', { class: 'muted' }, `${left.length} to go. Pick where each one belongs; every purchase from the same place moves together.`),
      ...Object.values(groups).slice(0, 15).map(g => {
        const t = g[0];
        const sel = h('select', { 'aria-label': 'Other category', onchange: e => pick(e.target.value) }, h('option', { value: '' }, 'More…'), allCats(catNames()).map(c => h('option', {}, c)));
        const pick = c => { if (!c) return; sortMerchant(t, c, true); left = left.filter(x => !g.includes(x)); draw(); };
        return h('div', { class: 'sort-item' },
          h('div', { class: 'sort-head' }, h('b', {}, cleanMerchant(t.desc || t.note)), h('span', { class: 'muted small' }, `${g.length > 1 ? `${g.length}× · ` : ''}${money(g.reduce((a, x) => a + Number(x.amount), 0))}`)),
          h('div', { class: 'chip-row' }, QUICK_CATS.map(c => h('button', { type: 'button', class: 'chip', onclick: () => pick(c) }, c)), sel));
      }));
  };
  draw();
  openSheet({ title: 'Sort your spending', body: [body] });
}

const WAY_ICON = { limit: '🎯', subs: '🔁' };
function waysCtx() { const b = getBudget(); return { income: safeToSpend().income, limits: b.categories }; }
function runWay(w, ctx) {
  if (!w.action) return;
  if (w.action === 'subs') { tab = 'plan'; ctx.rerender(); setTimeout(() => document.querySelector('.subs-card')?.scrollIntoView({ behavior: 'smooth' }), 80); return; }
  if (w.action.startsWith('limit:')) {
    const name = w.action.slice(6);
    const b = getBudget();
    const cur = b.categories.find(c => c.name === name);
    openForm({
      title: `Limit for ${name}`,
      values: { limit: cur?.limit || '' },
      note: `A monthly limit shows a bar on This month and warns you at 80%. Aim a little below what you spend now.`,
      fields: [{ name: 'limit', label: 'Monthly limit ($)', type: 'number', step: '1', min: '0', inputmode: 'decimal', autofocus: true }],
      onSubmit: v => {
        const cats = cur ? b.categories.map(c => (c.name === name ? { ...c, limit: Number(v.limit) || 0 } : c)) : [...b.categories, { name, limit: Number(v.limit) || 0 }];
        store.save('settings', { income: b.income, categories: cats }, BUDGET_ID); toast('Limit set ✓');
      },
    });
  }
}
function wayRow(w, ctx) {
  return h('div', { class: 'way' },
    h('div', { class: 'way-icon' }, w.icon),
    h('div', { class: 'way-main' }, h('b', {}, w.title), h('p', { class: 'muted small' }, w.detail),
      w.action ? h('button', { type: 'button', class: 'mini-link', onclick: () => runWay(w, ctx) }, w.action === 'subs' ? 'Review subscriptions ›' : 'Set a limit ›') : null),
    h('div', { class: 'way-save' }, h('b', {}, `~${money0(w.save)}`), h('small', { class: 'muted' }, '/mo')));
}
function waysCard(ctx) {
  const ways = waysToSave(waysCtx());
  if (!ways.length) return null;
  const total = ways.reduce((a, w) => a + w.save, 0);
  return card('Ways to save', { action: ways.length > 3 ? btn(`See all ${ways.length}`, () => openSheet({ title: 'Ways to save', body: [h('p', { class: 'muted' }, `Up to about ${money0(total)}/month if you did all of these. Based on your last 3 months.`), ...ways.map(w => wayRow(w, ctx))] }), 'ghost sm') : null },
    h('p', { class: 'muted small' }, `Up to ~${money0(total)}/month, based on your last 3 months.`),
    ways.slice(0, 3).map(w => wayRow(w, ctx)));
}

function importSummary(added, skipped) {
  const by = {};
  for (const t of added) if (t.amount < 0 && t.category !== 'Transfer') by[t.category] = (by[t.category] || 0) + -t.amount;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const unsorted = needsSorting(added.map(t => store.get(t.id) ? { id: t.id, ...store.get(t.id) } : null).filter(Boolean));
  const subs = findSubscriptions();
  const dlg = openSheet({ title: `Imported ${added.length} transaction${added.length === 1 ? '' : 's'}`, body: [
    skipped ? h('p', { class: 'muted small' }, `${skipped} were already here and skipped.`) : null,
    top.length ? h('div', {}, h('p', { class: 'field-label' }, 'Where the money went'), top.slice(0, 8).map(([c, v]) => h('div', { class: 'row compact' }, h('div', { class: 'row-main' }, c), h('div', { class: 'amt' }, money(v))))) : null,
    unsorted.length ? h('div', { class: 'callout' }, h('p', {}, `🤔 ${unsorted.length} couldn't be sorted automatically.`), btn('Sort them now', () => { dlg.close(); sortSheet(unsorted); }, 'primary sm')) : h('p', {}, '✓ Everything was sorted. Tap any transaction in Activity to move it.'),
    subs.length ? h('div', { class: 'callout' }, h('p', {}, `🔁 Found ${subs.length} charge${subs.length === 1 ? '' : 's'} that look${subs.length === 1 ? 's' : ''} like a subscription: ${subs.slice(0, 3).map(x => x.name).join(', ')}${subs.length > 3 ? '…' : ''}`),
      btn('Review', () => { dlg.close(); tab = 'plan'; document.dispatchEvent(new Event('everyday-rerender')); setTimeout(() => document.querySelector('.found-subs')?.scrollIntoView({ behavior: 'smooth' }), 120); }, 'ghost sm')) : null,
  ].filter(Boolean) });
}
setOnImported(importSummary);

function legacyCard(rerender) {
  const n = legacyCount();
  if (!n) return null;
  const pw = h('input', { type: 'password', placeholder: 'Old bank password', autocomplete: 'current-password', 'aria-label': 'Old bank password' });
  const msg = h('p', { class: 'small', role: 'status' });
  return card('Move your bank transactions', { cls: 'warn-card' },
    h('p', {}, `The bank password is gone. ${n} transaction${n === 1 ? ' is' : 's are'} still locked with it. Enter the old bank password once to move them into this list.`),
    h('form', { class: 'quick', onsubmit: async e => {
      e.preventDefault(); msg.textContent = 'Moving…';
      try { const moved = await migrateLegacy(pw.value); toast(`Moved ${moved} bank transaction${moved === 1 ? '' : 's'} ✓`); rerender(); }
      catch (err) { msg.textContent = err.message; }
    } }, pw, h('button', { type: 'submit', class: 'btn primary sm' }, 'Move them')),
    msg,
    h('button', { type: 'button', class: 'mini-link', onclick: () => { if (confirm(`Delete the ${n} locked bank transactions? You can import them again from your bank.`)) { dropLegacy(); rerender(); } } }, 'Forgot it? Delete them and re-import'));
}

const ACT_FILTERS = [['all', 'All'], ['sort', 'Needs sorting'], ['out', 'Spending'], ['in', 'Money in'], ['bank', 'From bank'], ['manual', 'Typed in']];
function renderActivity(root, ctx) {
  setBankRerender(ctx.rerender);
  const amount = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: '$0.00', 'data-fk': 'tx-amt', 'aria-label': 'Amount', required: true });
  const cat = h('select', { 'aria-label': 'Category' }, catNames().map(c => h('option', {}, c)));
  const note = h('input', { type: 'text', placeholder: 'What for?', 'aria-label': 'Note', enterkeyhint: 'done' });
  root.append(h('form', { class: 'quick quick-money', onsubmit: e => {
    e.preventDefault();
    if (!amount.value) return;
    store.save(TX, { amount: Number(amount.value), category: cat.value, note: note.value.trim(), type: 'expense', date: ymd() });
    amount.focus();
  } }, amount, cat, note, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));
  root.append(h('div', { class: 'btn-row act-actions' },
    btn('🏦 Import bank file', () => importBank(catNames()), 'ghost sm'),
    btn('+ Money in', () => editTxn(null, { type: 'income', category: 'Income' }), 'ghost sm')));
  const lc = legacyCard(ctx.rerender);
  if (lc) root.append(lc);

  root.append(monthNav(ctx));
  const all = monthStats(month).txns;
  const unsorted = needsSorting(all);
  if (unsorted.length) root.append(h('div', { class: 'callout' }, h('span', {}, `🤔 ${unsorted.length} transaction${unsorted.length === 1 ? '' : 's'} need${unsorted.length === 1 ? 's' : ''} a category`), btn('Sort them', () => sortSheet(unsorted), 'primary sm')));
  root.append(h('div', { class: 'chip-row' }, ACT_FILTERS.filter(([v]) => v !== 'sort' || unsorted.length).map(([v, l]) => h('button', { type: 'button', class: 'chip' + (actFilter === v ? ' on' : ''), onclick: () => { actFilter = v; ctx.rerender(); } }, v === 'sort' ? `${l} (${unsorted.length})` : l))));
  const txns = all.filter(t => actFilter === 'all' || (actFilter === 'sort' && unsorted.includes(t)) || (actFilter === 'out' && t.type !== 'income') || (actFilter === 'in' && t.type === 'income')
      || (actFilter === 'bank' && t.source === 'bank') || (actFilter === 'manual' && t.source !== 'bank'))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
  const out = all.filter(t => t.type !== 'income' && t.category !== 'Transfer').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const inn = all.filter(t => t.type === 'income' && t.category !== 'Transfer').reduce((a, t) => a + (Number(t.amount) || 0), 0);
  root.append(h('p', { class: 'muted small act-sum' }, `${all.length} transaction${all.length === 1 ? '' : 's'} · ${money(out)} out · ${money(inn)} in`));
  if (!txns.length) { root.append(empty(all.length ? 'Nothing matches this filter.' : 'Nothing yet this month. Type spending above, or import a file from your bank.')); return; }
  for (const d of [...new Set(txns.map(t => t.date))]) {
    root.append(card(relDay(d), {}, txns.filter(t => t.date === d).map(t => h('div', { class: 'row' + (t.category === 'Transfer' ? ' muted' : ''), onclick: () => editTxn(t) },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, (t.source === 'bank' && t.note === t.desc ? cleanMerchant(t.desc) : t.note) || t.desc || t.category),
        h('div', { class: 'row-meta' }, h('span', { class: 'tag' + (t.category === 'Other' && !t.catSet && t.type !== 'income' ? ' warn-tag' : '') }, t.category === 'Transfer' ? 'Transfer · not counted' : t.category), t.source === 'bank' ? h('span', { class: 'row-sub' }, `🏦 ${t.account || 'Bank'}`) : null)),
      h('div', { class: t.type === 'income' ? 'amt in' : 'amt' }, (t.type === 'income' ? '+' : '') + money(t.amount))))));
  }
  root.append(h('p', { class: 'hint' }, 'Tap anything to move it to another category (you can move everything from the same place at once) or delete it. Transfers and card payments aren\'t counted, so nothing is counted twice.'));
}

// ---- subscriptions ----------------------------------------------------------------------
const perMonth = x => (Number(x.amount) || 0) * (PER_MONTH[x.cycle] ?? 1);
export const subsMonthly = () => store.list(SUBS).filter(s => s.active !== false).reduce((sum, s) => sum + perMonth(s), 0);

/** Next billing date on or after today. */
export function nextRenewal(s) {
  const anchor = s.nextDate || s.started;
  return anchor ? nextOnOrAfter(anchor, s.cycle || 'monthly', ymd()) : null;
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
    values: s || { cycle: 'monthly', active: true, started: ymd(), category: 'Subscriptions' },
    fields: [
      { name: 'name', label: 'Name', required: true, autofocus: true, placeholder: 'Spotify, Netflix, iCloud…' },
      { name: 'amount', label: 'Cost each time ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true },
      { name: 'cycle', label: 'Billed', type: 'select', options: CYCLES },
      { name: 'started', label: 'When it started', type: 'date', hint: 'The first time you paid. Used to count what you\'ve spent on it.' },
      { name: 'nextDate', label: 'Next payment date', type: 'date', hint: 'Leave blank to count forward from the start date.' },
      { name: 'category', label: 'Category', suggestions: ['Subscriptions', 'Streaming', 'Music', 'School', 'Phone', 'Software', 'Fitness'] },
      { name: 'canceling', label: 'I want to cancel this (remind me before it renews)', type: 'checkbox' },
      { name: 'cancelBy', label: 'Free trial ends / cancel by (optional)', type: 'date', hint: 'You\'ll get a reminder 2 days before.' },
      { name: 'active', label: 'Active (uncheck once it\'s canceled)', type: 'checkbox' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Which card, how to cancel…' },
    ],
    onSubmit: v => {
      if (!v.started && !v.nextDate) { toast('Add a start date or next payment date'); return false; }
      if (s && s.active !== false && v.active === false) { v.canceledOn = ymd(); toast(`Nice! ${money(perMonth(v) * 12)} a year saved 🎉`); }
      store.save(SUBS, { ...v, reviewed: ymd() }, s?.id);
    },
    onDelete: s ? () => store.remove(s.id) : null,
  });
}

function subRow(s) {
  const next = nextRenewal(s);
  const days = next ? daysBetween(ymd(), next) : null;
  const paidSoFar = s.started && s.started <= ymd() ? countOccurrences(s.started, s.cycle || 'monthly', ymd()) * (Number(s.amount) || 0) : 0;
  const mo = perMonth(s);
  return h('div', { class: 'row sub-row' + (s.active === false ? ' done' : ''), onclick: () => editSub(s) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, s.name),
      h('div', { class: 'row-sub' },
        s.started ? `Since ${fmtMonthYear(s.started)}` : '',
        s.started && paidSoFar ? ` · ${money(paidSoFar)} so far` : ''),
      h('div', { class: 'row-meta' },
        s.active !== false && s.cancelBy && s.cancelBy >= ymd() ? h('span', { class: 'tag red' }, `Cancel by ${relDay(s.cancelBy)}`) : null,
        s.active !== false && s.canceling ? h('a', { class: 'tag red', href: `https://www.google.com/search?q=${encodeURIComponent('how to cancel ' + s.name + ' subscription')}`, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, 'How to cancel ↗') : null,
        s.active === false ? h('span', { class: 'tag' }, s.canceledOn ? `Canceled ${relDay(s.canceledOn)}` : 'Paused') :
          next ? h('span', { class: days <= 3 ? 'tag red' : 'tag' },
            days === 0 ? 'Next payment today' : `Next: ${relDay(next)}${days > 1 && days < 7 ? ` (${days} days)` : ''}`) : null)),
    h('div', { class: 'amt' },
      money(mo), h('small', {}, '/mo'),
      s.cycle && s.cycle !== 'monthly' ? h('div', { class: 'amt-sub' }, `${money(s.amount)}/${CYCLE_SHORT[s.cycle]}`) : null));
}

function foundSubs() {
  const found = findSubscriptions();
  const changes = priceChanges();
  if (!found.length && !changes.length) return null;
  return h('div', { class: 'found-subs' },
    changes.map(c => h('div', { class: 'callout' },
      h('span', {}, `📈 ${c.sub.name} went up from ${money(c.was)} to ${money(c.now)}.`),
      h('span', { class: 'btn-row tight' }, btn('Update price', () => store.save(SUBS, { amount: c.now }, c.sub.id), 'ghost sm'), btn('Cancel it?', () => editSub({ ...c.sub, canceling: true }), 'ghost sm')))),
    found.length ? [h('p', { class: 'field-label' }, `Found in your bank (${found.length})`),
      found.map(f => h('div', { class: 'row found-row' },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, f.name), h('div', { class: 'row-sub' }, `${money(f.amount)} ${f.cycle} · charged ${f.count}× · next about ${relDay(f.next)}`),
          f.raisedFrom ? h('div', { class: 'row-meta' }, h('span', { class: 'tag red' }, `📈 Price went up from ${money(f.raisedFrom)}`)) : null),
        h('span', { class: 'btn-row tight' }, btn('Track', () => { trackSubscription(f); toast(`Tracking ${f.name} ✓`); }, 'primary sm'), btn('Not one', () => dismissSubscription(f.key), 'ghost sm'))))] : null);
}

function subsPanel() {
  const all = store.list(SUBS).map(s => ({ ...s, _next: nextRenewal(s) || '9999' }));
  const active = all.filter(s => s.active !== false).sort((a, b) => a._next.localeCompare(b._next));
  const paused = all.filter(s => s.active === false);
  const mo = subsMonthly();
  return h('div', { class: 'stack' },
    card('Subscriptions', { action: addBtn('Add', () => editSub(null)), cls: 'subs-card' },
      h('div', { class: 'sub-total' },
        h('div', {}, h('b', {}, money(mo)), h('span', {}, 'total per month')),
        h('div', {}, h('b', {}, money(mo * 12)), h('span', {}, 'per year')),
        h('div', {}, h('b', {}, String(active.length)), h('span', {}, 'active'))),
      foundSubs(),
      active.length ? active.map(subRow) : empty('Add your subscriptions, or import a bank statement and they\'ll be found for you.')),
    paused.length ? card('Paused or canceled', {}, paused.map(subRow)) : null);
}

// ---- bills ------------------------------------------------------------------------------
export const billsMonthly = () => store.list(BILLS).reduce((sum, b) => sum + perMonth(b), 0);
const paidId = (b, due) => `bp:${b.id}:${due}`;
const isPaid = (b, due) => !!store.get(paidId(b, due));

/** The earliest unpaid due date (looking back 2 months for anything overdue). */
export function nextDue(b) {
  if (!b.dueDate) return null;
  const cycle = b.cycle || 'monthly';
  const from = b.dueDate > addDays(ymd(), -62) ? b.dueDate : addDays(ymd(), -62);
  let d = nextOnOrAfter(b.dueDate, cycle, from);
  for (let i = 0; i < 60 && isPaid(b, d); i++) d = nextOnOrAfter(b.dueDate, cycle, addDays(d, 1));
  return d;
}

export function billsDueSoon(withinDays = 7) {
  const today = ymd();
  return store.list(BILLS).map(b => ({ ...b, due: nextDue(b) }))
    .filter(b => b.due && daysBetween(today, b.due) <= withinDays)
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function markBillPaid(b, due) {
  store.save(PAID, { billId: b.id, due, paidOn: ymd(), amount: Number(b.amount) || 0 }, paidId(b, due));
  if (Number(b.amount)) store.save(TX, { amount: Number(b.amount), category: 'Bills', note: b.name, type: 'expense', date: ymd(), billId: b.id });
  toast(`${b.name} marked paid and added to spending`);
}

function editBill(b) {
  openForm({
    title: b ? b.name : 'New bill',
    values: b || { cycle: 'monthly', dueDate: ymd(), category: 'Bills' },
    fields: [
      { name: 'name', label: 'Bill', required: true, autofocus: true, placeholder: 'Rent, phone, car payment, power…' },
      { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', hint: 'Leave blank if it changes every time' },
      { name: 'cycle', label: 'Due', type: 'select', options: CYCLES },
      { name: 'dueDate', label: 'Next due date', type: 'date', required: true },
      { name: 'autopay', label: 'On autopay', type: 'checkbox' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Where to pay, account nickname…' },
    ],
    onSubmit: v => { store.save(BILLS, v, b?.id); },
    onDelete: b ? () => store.remove(b.id) : null,
  });
}

export function billRow(b) {
  const due = b.due || nextDue(b);
  const days = due ? daysBetween(ymd(), due) : null;
  const tagText = days < 0 ? `Overdue (${relDay(due)})` : days === 0 ? 'Due today' : `Due ${relDay(due)}${days > 1 && days < 7 ? ` (${days} days)` : ''}`;
  return h('div', { class: 'row' },
    h('div', { class: 'row-main', onclick: () => editBill(b) },
      h('div', { class: 'row-title' }, b.name, b.autopay ? h('span', { class: 'tag soft' }, 'Autopay') : null),
      h('div', { class: 'row-meta' }, h('span', { class: days <= 2 ? 'tag red' : 'tag' }, tagText))),
    h('div', { class: 'amt' }, b.amount ? money(b.amount) : '—'),
    btn('Paid', () => markBillPaid(b, due), 'ghost sm'));
}

// ---- savings goals ---------------------------------------------------------------------------
function editGoal(g) {
  openForm({
    title: g ? g.name : 'New savings goal',
    values: g || { emoji: '🎯', saved: 0 },
    fields: [
      { name: 'name', label: 'Saving for', required: true, autofocus: true, placeholder: 'Emergency fund, trip, new laptop…' },
      { name: 'emoji', label: 'Emoji' },
      { name: 'target', label: 'Goal amount ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', required: true },
      { name: 'saved', label: 'Saved so far ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal' },
      { name: 'deadline', label: 'Target date (optional)', type: 'date' },
    ],
    onSubmit: v => { store.save(GOALS, { ...v, saved: Number(v.saved) || 0 }, g?.id); },
    onDelete: g ? () => store.remove(g.id) : null,
  });
}

function addToGoal(g, sign = 1) {
  openForm({
    title: sign > 0 ? `Add to ${g.name}` : `Take out of ${g.name}`,
    fields: [{ name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true, autofocus: true }],
    submitLabel: sign > 0 ? 'Add' : 'Withdraw',
    onSubmit: v => {
      const amt = Math.abs(Number(v.amount)) || 0;
      if (!amt) return false;
      const saved = Math.max(0, (Number(g.saved) || 0) + sign * amt);
      if (sign < 0) toast(`Took ${money(Math.min(amt, Number(g.saved) || 0))} out of ${g.name}`);
      store.save(GOALS, { saved }, g.id);
      if (saved >= Number(g.target) && (Number(g.saved) || 0) < Number(g.target)) toast(`🎉 You hit your ${g.name} goal!`);
    },
  });
}

function goalCard(g) {
  const saved = Number(g.saved) || 0, target = Number(g.target) || 0;
  const left = Math.max(0, target - saved);
  const months = g.deadline ? Math.max(1, Math.ceil(daysBetween(ymd(), g.deadline) / 30.4)) : 0;
  return h('section', { class: 'card goal' },
    h('div', { class: 'card-head' },
      h('button', { type: 'button', class: 'card-title link', onclick: () => editGoal(g) }, `${g.emoji || '🎯'} ${g.name}`),
      h('span', { class: 'btn-row tight' }, btn('+ Add', () => addToGoal(g, 1), 'ghost sm'), Number(g.saved) > 0 ? btn('− Withdraw', () => addToGoal(g, -1), 'ghost sm') : null)),
    h('div', { class: 'goal-nums' }, h('b', {}, money(saved)), h('span', { class: 'muted' }, ` of ${money(target)}`)),
    bar(saved, target),
    h('p', { class: 'row-sub goal-note' },
      left <= 0 ? '🎉 Goal reached!'
        : g.deadline ? (g.deadline < ymd() ? `${money(left)} to go. The target date has passed.` : `${money(left)} to go · about ${money(left / months)}/month to reach it by ${relDay(g.deadline)}`)
        : `${money(left)} to go`));
}

// ---- grow: put idle money to work ---------------------------------------------------------------
const GROW_DEFAULT = { start: 500, monthly: 100, years: 10, rate: 7 };
const PRESETS = [[0, 'Checking (0%)'], [4, 'High-yield savings (~4%)'], [7, 'Broad index fund (~7% long-run)']];
const money0 = n => (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function project(start, monthly, years, ratePct) {
  const r = ratePct / 100 / 12, points = [];
  let bal = start;
  for (let m = 0; m <= years * 12; m++) {
    if (m > 0) bal = bal * (1 + r) + monthly;
    if (m % 12 === 0) points.push({ year: m / 12, grow: bal, idle: start + monthly * m });
  }
  return { points, end: bal, put: start + monthly * years * 12 };
}
/** Two-line SVG chart: growing vs. sitting in checking. Tap/hover a year to read it. */
function growChart(points, rate) {
  const W = 320, H = 170, L = 6, R = 6, T = 14, B = 22;
  const max = Math.max(1, ...points.map(p => Math.max(p.grow, p.idle)));
  const x = i => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = v => T + (1 - v / max) * (H - T - B);
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'linechart', role: 'img', 'aria-label': `After ${points.at(-1).year} years: ${money0(points.at(-1).grow)} growing at ${rate}%, versus ${money0(points.at(-1).idle)} in checking.` });
  const path = key => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  svg.append(el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, class: 'axis' }));
  svg.append(el('path', { d: `${path('grow')} L${x(points.length - 1)},${H - B} L${L},${H - B} Z`, class: 'area' }));
  svg.append(el('path', { d: path('idle'), class: 'line idle' }));
  svg.append(el('path', { d: path('grow'), class: 'line grow' }));
  const step = Math.ceil(points.length / 6);
  points.forEach((p, i) => { if (i % step === 0 || i === points.length - 1) svg.append(el('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle', class: 'lbl' }, `Yr ${p.year}`)); });
  const dot = el('circle', { r: 4, class: 'dot', cx: x(points.length - 1), cy: y(points.at(-1).grow) });
  svg.append(dot);
  const readout = h('p', { class: 'chart-readout', role: 'status' }, `Year ${points.at(-1).year}: ${money0(points.at(-1).grow)} vs ${money0(points.at(-1).idle)} in checking`);
  const pick = e => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1))));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(points[i].grow));
    readout.textContent = `Year ${points[i].year}: ${money0(points[i].grow)} vs ${money0(points[i].idle)} in checking`;
  };
  svg.addEventListener('pointermove', pick); svg.addEventListener('pointerdown', pick);
  return h('div', { class: 'chart' }, svg,
    h('div', { class: 'legend' }, h('span', { class: 'lg grow' }, `Growing at ${rate}%`), h('span', { class: 'lg idle' }, 'Sitting in checking')), readout);
}

function renderGrow(root) {
  const g = { ...GROW_DEFAULT, ...(store.get(GROW_ID) || {}) };
  const tiles = h('div', { class: 'mstats' });
  const chartBox = h('div', {});
  const save = () => store.save('settings', { ...g }, GROW_ID);
  const clamp = () => { g.start = Math.max(0, +g.start || 0); g.monthly = Math.max(0, +g.monthly || 0); g.years = Math.min(60, Math.max(1, Math.round(+g.years || 1))); g.rate = Math.min(20, Math.max(0, +g.rate || 0)); };
  const draw = () => {
    clamp();
    const p = project(g.start, g.monthly, g.years, g.rate);
    tiles.replaceChildren(
      h('div', { class: 'mstat' }, h('span', { class: 'muted small' }, 'You put in'), h('b', {}, money0(p.put))),
      h('div', { class: 'mstat' }, h('span', { class: 'muted small' }, 'Ending balance'), h('b', {}, money0(p.end))),
      h('div', { class: 'mstat' }, h('span', { class: 'muted small' }, 'Growth earned'), h('b', { class: 'ok' }, money0(p.end - p.put))));
    chartBox.replaceChildren(growChart(p.points, g.rate));
  };
  let t;
  const input = (key, label, attrs) => h('label', { class: 'gfield' }, h('span', { class: 'field-label' }, label),
    h('input', { type: 'number', inputmode: 'decimal', value: g[key], 'data-k': key, ...attrs, oninput: e => { g[key] = e.target.value; draw(); clearTimeout(t); t = setTimeout(save, 800); } }));
  const fields = h('div', { class: 'grow-grid' },
    input('start', 'Starting amount ($)', { min: 0, step: 1 }), input('monthly', 'Added each month ($)', { min: 0, step: 1 }),
    input('years', 'Years', { min: 1, max: 60, step: 1 }), input('rate', 'Yearly return (%)', { min: 0, max: 20, step: 0.1 }));
  const setField = (k, v) => { g[k] = v; fields.querySelector(`[data-k="${k}"]`).value = v; draw(); save(); };
  const leftover = Math.floor(safeToSpend().left);

  root.append(card('Grow: put idle money to work', {},
    h('p', { class: 'muted' }, 'See how money grows when it isn\'t just sitting in checking. The rates are example assumptions you can change. Check current rates, and remember investment returns aren\'t guaranteed.'),
    h('div', { class: 'chip-row' }, PRESETS.map(([r, l]) => h('button', { type: 'button', class: 'chip', onclick: () => setField('rate', r) }, l))),
    fields,
    h('div', { class: 'btn-row' }, btn('Use my monthly savings', () => {
      const v = Math.round(Number(getBudget().save) || 0) || leftover;
      if (!(v > 0)) { toast('Set "Savings each month" in your plan first.'); return; }
      setField('monthly', v); toast(`Using ${money0(v)}/month`); return;
      setField('monthly', leftover); toast(`Using ${money0(leftover)}/month`);
    }, 'ghost sm')),
    tiles, chartBox));
  root.append(card('A common order for extra money', {},
    h('ol', { class: 'ladder' },
      h('li', {}, h('b', {}, 'Starter emergency fund: '), 'a small cushion (often $500–$1,000) so surprises don\'t go on a card.'),
      h('li', {}, h('b', {}, 'High-interest debt: '), 'paying off a 20%+ credit card is a guaranteed "return" that no investment matches.'),
      h('li', {}, h('b', {}, 'Employer retirement match: '), 'if a job offers a 401(k) match, that\'s free money.'),
      h('li', {}, h('b', {}, 'Full emergency fund: '), '3–6 months of expenses, parked in a high-yield savings account.'),
      h('li', {}, h('b', {}, 'Roth IRA / index funds: '), 'long-term money in low-cost, diversified funds.'),
      h('li', {}, h('b', {}, 'Other goals: '), 'car, travel, house down payment.')),
    h('p', { class: 'hint' }, 'General education, not personal financial advice.')));
  draw();
}

// ---- insights: where it went + heads-up -----------------------------------------------------
function insightFlags(ym) {
  const p = safeToSpend(ym), last = monthStats(addMonths(ym + '-01', -1).slice(0, 7));
  const flags = [];
  const d = new Date(), monthPct = p.isNow ? (d.getDate() / dimOf(ym)) * 100 : 100;
  for (const c of p.budget.categories) {
    const s = p.byCat[c.name] || 0, lim = Number(c.limit) || 0, pct = lim ? (s / lim) * 100 : 0;
    if (lim && s > lim) flags.push(['bad', `${c.name} is over its limit by ${money(s - lim)}.`]);
    else if (lim && pct >= 80) flags.push(['warn', `${c.name} is at ${Math.round(pct)}% of its limit.`]);
    else if (lim && p.isNow && d.getDate() >= 5 && pct > monthPct + 15) flags.push(['warn', `${c.name} is going faster than the month (${Math.round(pct)}% used, ${Math.round(monthPct)}% of the month gone).`]);
    const prev = last.byCat[c.name] || 0;
    if (prev > 0 && s > prev * 1.25 && s - prev > 20) flags.push(['warn', `${c.name} is up ${Math.round((s / prev - 1) * 100)}% from last month.`]);
  }
  if (p.hasPlan) {
    if (p.left < 0) flags.push(['bad', `You're ${money(-p.left)} past your plan this month. Ease off everyday spending, or lower savings this month.`]);
    else if (p.isNow && p.flexBudget > 0 && p.flexSpent / p.flexBudget > monthPct / 100 + 0.15 && d.getDate() >= 5) flags.push(['warn', `Everyday spending is ahead of the month: ${Math.round((p.flexSpent / p.flexBudget) * 100)}% used, ${Math.round(monthPct)}% of the month gone.`]);
    if (!p.save) flags.push(['info', 'Your plan has no savings yet. Even a small amount each month adds up (see Grow in Plan).', 'save']);
    if (p.fixed / p.income >= 0.6) flags.push(['warn', `Bills and subscriptions take ${Math.round((p.fixed / p.income) * 100)}% of your income.`]);
    if (!p.isNow && p.left > 0) flags.push(['good', `You finished ${money(p.left)} under your plan. Move it to a goal.`, 'goals']);
  } else flags.push(['info', 'Set your monthly income in Plan to see what\'s safe to spend.', 'income']);
  if (last.spent > 0 && p.spent < last.spent && (!p.isNow || d.getDate() >= 25)) flags.push(['good', `You've spent ${money(last.spent - p.spent)} less than last month. Nice!`]);
  if (!flags.length) flags.push(['good', 'Everything is on track 👍']);
  return flags;
}

// ---- This month -----------------------------------------------------------------------------
function heroCard(p, ctx) {
  if (!p.hasPlan) return card('Set up Safe to spend', { cls: 'hero-setup' },
    h('p', {}, 'One number that tells you what you can spend without wrecking your month. Three quick steps:'),
    h('ol', { class: 'steps' },
      h('li', {}, h('button', { type: 'button', class: 'mini-link', onclick: editIncome }, 'Set your monthly income'), p.planned ? ' ✓' : ''),
      h('li', {}, h('button', { type: 'button', class: 'mini-link', onclick: () => { tab = 'plan'; ctx.rerender(); } }, 'Add bills & subscriptions'), p.fixedPlan ? ' ✓' : ''),
      h('li', {}, h('button', { type: 'button', class: 'mini-link', onclick: editSave }, 'Pick a monthly savings amount'), p.save ? ' ✓' : '')));
  const line = (label, v, cls = '') => [h('dt', {}, label), h('dd', { class: cls }, v)];
  return h('section', { class: 'card hero ' + (p.left >= 0 ? 'good' : 'over') },
    h('p', { class: 'eyebrow' }, p.isNow ? 'Safe to spend' : 'Left over'),
    h('div', { class: 'hero-num' }, money0(p.left)),
    p.isNow ? h('p', { class: 'hero-sub' }, p.left > 0 ? `about ${money0(Math.floor(p.perDay))}/day for ${p.daysLeft} more day${p.daysLeft === 1 ? '' : 's'} · ${money0(Math.floor(p.week))} this week` : 'You\'ve used this month\'s spending money.') : null,
    h('dl', { class: 'facts hero-facts' },
      line('Income', money(p.income)),
      line('− Bills & subscriptions', money(p.fixed)),
      line('− Savings', money(p.save)),
      line('− Spent so far', money(p.flexSpent)),
      line('= ' + (p.isNow ? 'Safe to spend' : 'Left over'), money(p.left), p.left >= 0 ? 'ok' : 'bad')),
    h('div', { class: 'btn-row' }, btn('+ Spent', () => editTxn(null), 'primary sm'), btn('Adjust plan', () => { tab = 'plan'; ctx.rerender(); }, 'ghost sm')));
}

function comingUp() {
  const bills = billsDueSoon(14);
  const subs = upcomingSubs(14);
  const cancel = store.list(SUBS).filter(s => s.active !== false && ((s.cancelBy && s.cancelBy >= ymd() && daysBetween(ymd(), s.cancelBy) <= 14) || (s.canceling && nextRenewal(s) && daysBetween(ymd(), nextRenewal(s)) <= 14)));
  if (!bills.length && !subs.length && !cancel.length) return null;
  return card('Coming up (2 weeks)', {},
    cancel.map(s => h('div', { class: 'row compact cancel-row', onclick: () => editSub(s) }, h('div', { class: 'row-main' }, `✂️ Cancel ${s.name}`, h('span', { class: 'muted' }, ` before ${relDay(s.cancelBy && s.cancelBy >= ymd() ? s.cancelBy : nextRenewal(s))}`)), h('div', { class: 'amt' }, money(s.amount)))),
    bills.map(billRow),
    subs.map(s => h('div', { class: 'row compact' }, h('div', { class: 'row-main' }, s.name, h('span', { class: 'muted' }, ` · renews ${relDay(s.next)}`)), h('div', { class: 'amt' }, money(s.amount)))));
}

function renderMonth(root, ctx) {
  root.append(monthNav(ctx));
  const p = safeToSpend(month);
  const grid = h('div', { class: 'grid' });
  grid.append(heroCard(p, ctx));
  if (p.isNow) { const c = comingUp(); if (c) grid.append(c); }

  const cats = [...p.budget.categories];
  for (const name of Object.keys(p.byCat)) if (!cats.some(c => c.name === name) && !FIXED.includes(name) && name !== 'Savings') cats.push({ name, limit: 0 });
  cats.sort((a, b) => (p.byCat[b.name] || 0) - (p.byCat[a.name] || 0));
  grid.append(card('Everyday spending', { action: btn('Edit limits', () => { tab = 'plan'; ctx.rerender(); }, 'ghost sm') },
    cats.filter(c => c.limit || p.byCat[c.name]).map(c => {
      const spent = p.byCat[c.name] || 0;
      return h('div', { class: 'cat' },
        h('div', { class: 'cat-line' }, h('span', {}, c.name), h('span', { class: c.limit && spent > c.limit ? 'bad' : 'muted' }, `${money(spent)}${c.limit ? ' / ' + money(c.limit) : ''}`)),
        c.limit ? budgetBar(spent, c.limit) : null);
    })));
  if (p.isNow) { const w = waysCard(ctx); if (w) grid.append(w); }
  grid.append(card('Heads-up', {}, h('ul', { class: 'flags' }, insightFlags(month).map(([cls, msg, go]) => h('li', { class: cls }, msg,
    go === 'goals' || go === 'save' ? h('button', { type: 'button', class: 'mini-link', onclick: go === 'save' ? editSave : () => { tab = 'plan'; ctx.rerender(); } }, go === 'save' ? ' Set savings ›' : ' Go to goals ›')
      : go === 'income' ? h('button', { type: 'button', class: 'mini-link', onclick: editIncome }, ' Set income ›') : null)))));

  const months = Array.from({ length: 6 }, (_, i) => addMonths(month + '-01', i - 5).slice(0, 7));
  const vals = months.map(ym => ({ label: parseYmd(ym + '-01').toLocaleDateString(undefined, { month: 'short' }), value: Math.round(monthStats(ym).spent), highlight: ym === month }));
  const nz = vals.filter(v => v.value > 0);
  grid.append(card('Spent per month', {}, barChart(vals, { format: v => money(v).replace(/\.00$/, ''), caption: nz.length ? `Average ${money(nz.reduce((a, v) => a + v.value, 0) / nz.length)} a month. Tap a bar.` : 'Tap a bar for its total.' })));
  root.append(grid);
}

// ---- Plan -------------------------------------------------------------------------------------
function renderPlan(root, ctx) {
  const p = safeToSpend();
  const b = getBudget();
  const limits = b.categories.reduce((a, c) => a + (Number(c.limit) || 0), 0);
  const row = (label, value, onclick, hint) => h('button', { type: 'button', class: 'plan-row', onclick },
    h('span', {}, h('b', {}, label), hint ? h('small', { class: 'muted' }, hint) : null), h('span', { class: 'plan-val' }, value, ' ›'));
  const grid = h('div', { class: 'grid' });
  grid.append(card('Your monthly plan', {},
    row('Income', p.planned ? money(p.planned) : 'Set', editIncome, 'What you take home in a month'),
    row('Bills & subscriptions', money(p.fixedPlan), () => document.getElementById('plan-bills')?.scrollIntoView({ behavior: 'smooth' }), (() => { const nb = store.list(BILLS).length, ns = store.list(SUBS).filter(s => s.active !== false).length; return `${nb} bill${nb === 1 ? '' : 's'} · ${ns} subscription${ns === 1 ? '' : 's'}`; })()),
    row('Savings', p.save ? money(Number(b.save) || 0) : 'Set', editSave, goalsMonthly() ? `Goals need about ${money(Math.ceil(goalsMonthly()))}/month` : 'Set aside before spending'),
    h('div', { class: 'plan-total' }, h('span', {}, 'Everyday spending money'), h('b', { class: p.flexBudget >= 0 ? 'ok' : 'bad' }, `${money(p.flexBudget)}/mo`)),
    limits && p.hasPlan && limits > p.flexBudget + 1 ? h('p', { class: 'hint bad' }, `Your category limits add up to ${money(limits)}, more than the ${money(p.flexBudget)} you have for everyday spending.`) : null));
  grid.append(card('Category limits', { action: h('span', { class: 'btn-row tight' }, btn('+ Category', addCategory, 'ghost sm'), btn('Edit', editBudget, 'ghost sm')) },
    h('p', { class: 'hint' }, 'Optional guide rails for everyday spending. Safe to spend works without them.'),
    b.categories.map(c => h('div', { class: 'row compact' }, h('div', { class: 'row-main' }, c.name), h('div', { class: 'amt' }, c.limit ? money(c.limit) : '—')))));
  const bills = store.list(BILLS).map(x => ({ ...x, due: nextDue(x) })).sort((a, c) => (a.due || '').localeCompare(c.due || ''));
  const billsCard = card(`Bills · ${money(billsMonthly())}/mo`, { action: addBtn('Add', () => editBill(null)) },
    bills.length ? bills.map(billRow) : empty('Add rent, phone, car and other bills. "Paid" logs the payment for you.'));
  billsCard.id = 'plan-bills';
  grid.append(billsCard);
  grid.append(subsPanel());
  const rules = Object.entries(learnedRules()).sort((a, c) => a[0].localeCompare(c[0]));
  if (rules.length) grid.append(card(`Sorting rules (${rules.length})`, {},
    h('p', { class: 'hint' }, 'Made when you move a transaction. New imports from these places go straight to the right category.'),
    h('details', {}, h('summary', { class: 'mini-link' }, 'Show rules'),
      rules.map(([k, c]) => h('div', { class: 'row compact' }, h('div', { class: 'row-main' }, k.replace(/\b[a-z]/g, x => x.toUpperCase()), h('span', { class: 'muted' }, ` → ${c}`)),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { const r = (store.get(RULES_ID) || {}).rules || {}; store.save('settings', { rules: { ...r, [k]: '' } }, RULES_ID); for (const t of store.list(TX).filter(t => t.source === 'bank' && merchantKey(t.desc || t.note || '') === k)) store.save(TX, { catSet: false }, t.id); toast('Rule removed'); } }, 'Remove'))))));
  const goals = store.list(GOALS).sort((a, c) => (a.deadline || '9999').localeCompare(c.deadline || '9999'));
  grid.append(card('Savings goals', { action: addBtn('Goal', () => editGoal(null)) },
    goals.length ? h('div', { class: 'stack' }, goals.map(goalCard)) : empty('No goals yet. Try "Emergency fund: $1,000".')));
  root.append(grid);
  const growBox = h('details', { class: 'grow-details', open: growOpen, ontoggle: e => { growOpen = e.target.open; } }, h('summary', {}, '📈 Grow: see how savings add up over time'));
  renderGrow(growBox);
  root.append(growBox);
}

export function render(root, ctx) {
  root.append(pageHead('Money', { actions: [addBtn('Spent', () => editTxn(null))] }));
  root.append(seg([['month', 'This month'], ['activity', 'Activity'], ['plan', 'Plan']], tab, v => { tab = v; ctx.rerender(); }));
  if (tab === 'activity') renderActivity(root, ctx);
  else if (tab === 'plan') renderPlan(root, ctx);
  else renderMonth(root, ctx);
}
