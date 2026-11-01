// money.js — budget + chart, spending log with subscriptions beside it, bills, savings goals,
// a compound-growth planner (Grow) and spending insights.
import * as store from '../store.js';
import {
  h, pageHead, card, empty, seg, addBtn, btn, icon, iconBtn, openForm, bar, barChart, money, toast,
  ymd, addDays, addMonths, daysBetween, relDay, parseYmd, fmtMonthYear,
  CYCLES, PER_MONTH, CYCLE_SHORT, nthOccurrence, nextOnOrAfter, countOccurrences,
} from '../ui.js';
import { renderBank, bankSpending, vaultExists, isUnlocked } from './bank.js';

export const id = 'money';
export const title = 'Money';
export const glyph = 'money';

const TX = 'txns';        // { date, amount, type: 'expense'|'income', category, note }
const SUBS = 'subs';      // { name, amount, cycle, started, nextDate, category, active, notes }
const BILLS = 'bills';    // { name, amount, cycle, dueDate, category, autopay, notes }
const PAID = 'billpays';  // id "bp:<billId>:<dueDate>" → { billId, due, paidOn, amount }
const GOALS = 'goals';    // { name, emoji, target, saved, deadline }
const BUDGET_ID = 'settings:budget'; // { income, categories: [{ name, limit }] }
const GROW_ID = 'settings:grow';     // { start, monthly, years, rate }
const DEFAULT_CATS = [
  { name: 'Groceries', limit: 250 }, { name: 'Eating out', limit: 100 }, { name: 'Gas & transport', limit: 100 },
  { name: 'Fun', limit: 75 }, { name: 'Shopping', limit: 75 }, { name: 'Other', limit: 50 },
];

let tab = 'budget';
let month = ymd().slice(0, 7);
export function setTab(t) { tab = t === 'subs' ? 'spending' : t; }

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
  // Bank transactions count too, but only while the bank vault is unlocked.
  const bank = bankSpending(ym);
  let spentAll = spent, incomeAll = income;
  if (bank) {
    spentAll += bank.spent; incomeAll += bank.income;
    for (const [c, v] of Object.entries(bank.byCat)) byCat[c] = (byCat[c] || 0) + v;
  }
  return { txns, spent: spentAll, income: incomeAll, byCat, budget, limit, bankIncluded: !!bank, bankLocked: vaultExists() && !isUnlocked() };
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

/** Bills still to pay in the rest of this month (paid ones are already in spending). */
function billsLeftThisMonth(ym) {
  if (ym !== ymd().slice(0, 7)) return 0;
  const end = addDays(addMonths(ym + '-01', 1), -1);
  let sum = 0;
  for (const b of store.list(BILLS)) {
    if (!b.dueDate) continue;
    let d = nextDue(b);
    for (let i = 0; d && d <= end && i < 40; i++) {
      if (!isPaid(b, d)) sum += Number(b.amount) || 0;
      d = nextOnOrAfter(b.dueDate, b.cycle || 'monthly', addDays(d, 1));
    }
  }
  return sum;
}
/** Income, what's left after spending + subscriptions + bills still due, and the savings rate. */
export function planStats(ym) {
  const s = monthStats(ym);
  const income = s.income || Number(s.budget.income) || 0;
  const subs = subsMonthly();
  const billsLeft = billsLeftThisMonth(ym);
  const leftover = income - s.spent - subs - billsLeft;
  return { ...s, incomeUsed: income, subs, billsLeft, leftover, rate: income > 0 ? leftover / income : null };
}

function editIncome() {
  openForm({
    title: 'Monthly income',
    values: { income: getBudget().income },
    note: 'Roughly what you take home in a month (after taxes). Used for "left over" and your savings rate. Income you log under Spending counts first.',
    fields: [{ name: 'income', label: 'Monthly income ($)', type: 'number', step: '0.01', min: '0', inputmode: 'decimal', autofocus: true }],
    onSubmit: v => { const b = getBudget(); store.save('settings', { income: Math.max(0, Number(v.income) || 0), categories: b.categories }, BUDGET_ID); toast('Income saved ✓'); },
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

function statTiles(p) {
  const tile = (label, value, cls = '', onclick) => h(onclick ? 'button' : 'div', { class: 'mstat' + (onclick ? ' tap' : ''), ...(onclick ? { type: 'button', onclick } : {}) },
    h('span', { class: 'muted small' }, label), h('b', { class: cls }, value));
  return h('div', { class: 'mstats' },
    tile('Income', p.incomeUsed ? money(p.incomeUsed) : 'Set ›', '', editIncome),
    tile('Left over', p.incomeUsed ? money(p.leftover) : '–', p.incomeUsed ? (p.leftover >= 0 ? 'ok' : 'bad') : ''),
    tile('Savings rate', p.rate == null ? '–' : `${Math.round(p.rate * 100)}%`, p.rate == null ? '' : p.rate >= 0.1 ? 'ok' : p.rate < 0 ? 'bad' : ''));
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
  const billsMo = billsMonthly();
  const grid = h('div', { class: 'grid' });

  const p = planStats(month);
  grid.append(card('This month', { action: btn('Edit budget', editBudget, 'ghost sm') },
    statTiles(p),
    summaryBlock(month),
    h('dl', { class: 'facts' },
      s.income || s.budget.income ? [h('dt', {}, 'Income'), h('dd', {}, money(s.income || s.budget.income))] : null,
      h('dt', {}, 'Subscriptions'), h('dd', {}, `${money(subsMo)}/mo`),
      h('dt', {}, 'Bills'), h('dd', {}, `${money(billsMo)}/mo`),
      h('dt', {}, 'Fixed costs total'), h('dd', {}, `${money(subsMo + billsMo)}/mo`)),
    p.incomeUsed ? h('p', { class: 'hint' }, `Left over = income − spending − subscriptions${p.billsLeft ? ` − ${money(p.billsLeft)} in bills still due this month` : ''}.`) : h('p', { class: 'hint' }, 'Tap "Income" to see what\'s left over and your savings rate.'),
    s.budget.isDefault ? h('p', { class: 'hint' }, 'These categories are examples. Tap "Edit budget" to set your own.') : null,
    s.bankIncluded ? h('p', { class: 'hint' }, '🔓 Includes your bank transactions.') : s.bankLocked ? h('p', { class: 'hint' }, '🔒 Bank transactions aren\'t included while the Bank tab is locked.') : null));

  // last 6 months
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month + '-01', i - 5).slice(0, 7));
  const vals = months.map(ym => ({
    label: parseYmd(ym + '-01').toLocaleDateString(undefined, { month: 'short' }),
    value: Math.round(monthStats(ym).spent),
    highlight: ym === month,
  }));
  const avg = vals.reduce((a, v) => a + v.value, 0) / vals.filter(v => v.value > 0).length || 0;
  grid.append(card('Spent per month', {},
    barChart(vals, { format: v => money(v).replace(/\.00$/, ''), caption: avg ? `Average ${money(avg)} a month. Tap a bar for its total.` : 'Tap a bar for its total.' })));

  const cats = [...s.budget.categories];
  for (const name of Object.keys(s.byCat)) if (!cats.some(c => c.name === name)) cats.push({ name, limit: 0 });
  cats.sort((a, b) => (s.byCat[b.name] || 0) - (s.byCat[a.name] || 0));
  grid.append(card('By category', { action: btn('+ Category', addCategory, 'ghost sm') }, cats.map(c => {
    const spent = s.byCat[c.name] || 0;
    return h('div', { class: 'cat' },
      h('div', { class: 'cat-line' }, h('span', {}, c.name), h('span', { class: c.limit && spent > c.limit ? 'bad' : 'muted' }, `${money(spent)}${c.limit ? ' / ' + money(c.limit) : ''}`)),
      c.limit ? budgetBar(spent, c.limit) : null);
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
      { name: 'category', label: 'Category', type: 'select', options: [...new Set([...catNames(), 'Bills', 'Subscriptions', 'Savings', 'Income', 'Other'])] },
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
  const left = h('div', { class: 'stack' });
  left.append(h('form', {
    class: 'quick quick-money',
    onsubmit: e => {
      e.preventDefault();
      if (!amount.value) return;
      store.save(TX, { amount: Number(amount.value), category: cat.value, note: note.value.trim(), type: 'expense', date: ymd() });
      amount.focus();
    },
  }, amount, cat, note, h('button', { type: 'submit', class: 'icon-btn solid', 'aria-label': 'Add' }, icon('plus', 20))));

  left.append(monthNav(ctx));
  const txns = monthStats(month).txns.sort((a, b) => b.date.localeCompare(a.date) || (b.created || '').localeCompare(a.created || ''));
  if (!txns.length) left.append(empty('No spending logged this month.'));
  const days = [...new Set(txns.map(t => t.date))];
  for (const d of days) {
    const list = txns.filter(t => t.date === d);
    left.append(card(relDay(d), {}, list.map(t => h('div', { class: 'row', onclick: () => editTxn(t) },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.note || t.category), h('div', { class: 'row-sub' }, t.category)),
      h('div', { class: t.type === 'income' ? 'amt in' : 'amt' }, (t.type === 'income' ? '+' : '') + money(t.amount))))));
  }

  // Subscriptions live in their own column beside the spending list (below it on a phone).
  root.append(h('div', { class: 'split money-split' }, left, subsPanel()));
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
      { name: 'active', label: 'Active (uncheck if paused or canceled)', type: 'checkbox' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Which card, how to cancel, free trial ends…' },
    ],
    onSubmit: v => {
      if (!v.started && !v.nextDate) { toast('Add a start date or next payment date'); return false; }
      store.save(SUBS, v, s?.id);
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
        s.active === false ? h('span', { class: 'tag' }, 'Paused') :
          next ? h('span', { class: days <= 3 ? 'tag red' : 'tag' },
            days === 0 ? 'Next payment today' : `Next: ${relDay(next)}${days > 1 && days < 7 ? ` (${days} days)` : ''}`) : null)),
    h('div', { class: 'amt' },
      money(mo), h('small', {}, '/mo'),
      s.cycle && s.cycle !== 'monthly' ? h('div', { class: 'amt-sub' }, `${money(s.amount)}/${CYCLE_SHORT[s.cycle]}`) : null));
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
      active.length ? active.map(subRow) : empty('Add your subscriptions to see when each started, when the next payment is, and what each costs per month.')),
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

function renderBills(root) {
  const list = store.list(BILLS).map(b => ({ ...b, due: nextDue(b) })).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  root.append(h('div', { class: 'stat-row two' },
    h('div', { class: 'stat' }, h('b', {}, money(billsMonthly())), h('span', {}, 'bills per month')),
    h('div', { class: 'stat' }, h('b', {}, String(billsDueSoon(7).length)), h('span', {}, 'due this week'))));
  root.append(card('By due date', { action: addBtn('Add', () => editBill(null)) },
    list.length ? list.map(billRow) : empty('Add rent, phone, car and other bills. Upcoming ones show on your Today screen, and "Paid" logs the payment for you.')));
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

function renderGoals(root) {
  const goals = store.list(GOALS).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  root.append(h('div', { class: 'section-head' }, h('p', { class: 'muted' }, 'Track what you\'re saving for.'), addBtn('Goal', () => editGoal(null))));
  root.append(goals.length ? h('div', { class: 'grid' }, goals.map(goalCard)) : empty('No goals yet. Add one like "Emergency fund: $1,000".'));
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
  const leftover = Math.floor(planStats(ymd().slice(0, 7)).leftover);

  root.append(card('Put idle money to work', {},
    h('p', { class: 'muted' }, 'See how money grows when it isn\'t just sitting in checking. The rates are example assumptions you can change. Check current rates, and remember investment returns aren\'t guaranteed.'),
    h('div', { class: 'chip-row' }, PRESETS.map(([r, l]) => h('button', { type: 'button', class: 'chip', onclick: () => setField('rate', r) }, l))),
    fields,
    h('div', { class: 'btn-row' }, btn('Use my monthly leftover', () => {
      if (!(leftover > 0)) { toast('No leftover this month yet. Set your income on the Budget tab first.'); return; }
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
const PALETTE = ['var(--hc-blue)', 'var(--hc-green)', 'var(--hc-yellow)', 'var(--hc-red)', 'var(--hc-purple)', 'var(--hc-teal)', 'var(--hc-pink)', 'var(--hc-gray)'];
function donut(entries, total) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const R = 52, C = 2 * Math.PI * R;
  const svg = el('svg', { viewBox: '0 0 140 140', class: 'donut', role: 'img', 'aria-label': entries.map(([n, v]) => `${n} ${money(v)}`).join(', ') });
  svg.append(el('circle', { cx: 70, cy: 70, r: R, class: 'donut-bg' }));
  let off = 0;
  entries.forEach(([, v], i) => {
    const len = (v / total) * C;
    svg.append(el('circle', { cx: 70, cy: 70, r: R, fill: 'none', stroke: PALETTE[i % PALETTE.length], 'stroke-width': 18, 'stroke-dasharray': `${Math.max(0, len - 1.5)} ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 70 70)' }));
    off += len;
  });
  const center = document.createElementNS(ns, 'text');
  center.setAttribute('x', 70); center.setAttribute('y', 75); center.setAttribute('text-anchor', 'middle'); center.setAttribute('class', 'donut-total');
  center.textContent = money0(total);
  svg.append(center);
  return svg;
}

function insightFlags(ym) {
  const p = planStats(ym), last = monthStats(addMonths(ym + '-01', -1).slice(0, 7));
  const flags = [];
  const isNow = ym === ymd().slice(0, 7);
  const d = new Date(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const monthPct = isNow ? (d.getDate() / dim) * 100 : 100;
  for (const c of p.budget.categories) {
    const s = p.byCat[c.name] || 0, lim = Number(c.limit) || 0, pct = lim ? (s / lim) * 100 : 0;
    if (lim && s > lim) flags.push(['bad', `${c.name} is over budget by ${money(s - lim)}.`]);
    else if (lim && pct >= 80) flags.push(['warn', `${c.name} is at ${Math.round(pct)}% of its limit.`]);
    else if (lim && isNow && d.getDate() >= 5 && pct > monthPct + 15) flags.push(['warn', `${c.name} is spending faster than the month is passing (${Math.round(pct)}% used, ${Math.round(monthPct)}% of the month gone).`]);
    const prev = last.byCat[c.name] || 0;
    if (prev > 0 && s > prev * 1.25) flags.push(['warn', `${c.name} is up ${Math.round((s / prev - 1) * 100)}% compared with last month.`]);
  }
  const budgeted = p.budget.categories.reduce((a, c) => a + (Number(c.limit) || 0), 0);
  if (p.incomeUsed > 0 && budgeted + p.subs > p.incomeUsed) flags.push(['bad', `Your budgets plus subscriptions add up to ${money(budgeted + p.subs)}, more than your ${money(p.incomeUsed)} income.`]);
  if (p.incomeUsed > 0) {
    if (p.leftover > 0) flags.push(['good', `You have ${money(p.leftover)} left this month. Move some to a goal or high-yield savings instead of leaving it in checking (see Goals and Grow).`, 'goals']);
    if (p.rate != null && p.rate < 0.1 && p.leftover >= 0) flags.push(['warn', `Your savings rate is ${Math.round(p.rate * 100)}%. Many people aim for 10–20%.`]);
    if (p.subs > 0 && p.subs / p.incomeUsed >= 0.1) flags.push(['warn', `Subscriptions cost ${money(p.subs)}/month, ${Math.round((p.subs / p.incomeUsed) * 100)}% of your income. Worth a look on the Spending tab.`]);
  } else flags.push(['info', 'Set your monthly income on the Budget tab to unlock left-over and savings-rate tips.', 'income']);
  if (last.spent > 0 && p.spent < last.spent && (!isNow || d.getDate() >= 25)) flags.push(['good', `You've spent ${money(last.spent - p.spent)} less than last month. Nice!`]);
  if (!flags.length) flags.push(['good', 'Everything is on track 👍']);
  return flags;
}

function renderInsights(root, ctx) {
  root.append(monthNav(ctx));
  const s = monthStats(month);
  const entries = Object.entries(s.byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);
  if (entries.length > 7) top.push(['Everything else', entries.slice(7).reduce((a, [, v]) => a + v, 0)]);
  const total = top.reduce((a, [, v]) => a + v, 0);
  const grid = h('div', { class: 'grid' });
  grid.append(card('Where it went', {}, total ? h('div', { class: 'donut-wrap' }, donut(top, total),
    h('ul', { class: 'donut-legend' }, top.map(([n, v], i) => h('li', {}, h('i', { style: { background: PALETTE[i % PALETTE.length] } }), h('span', {}, n), h('b', {}, money(v)), h('small', { class: 'muted' }, `${Math.round((v / total) * 100)}%`)))))
    : empty('No spending logged this month yet.')));
  grid.append(card('Heads-up', {}, h('ul', { class: 'flags' }, insightFlags(month).map(([cls, msg, go]) => h('li', { class: cls }, msg,
    go === 'goals' ? h('button', { type: 'button', class: 'mini-link', onclick: () => { tab = 'goals'; ctx.rerender(); } }, ' Go to Goals ›')
      : go === 'income' ? h('button', { type: 'button', class: 'mini-link', onclick: editIncome }, ' Set income ›') : null)))));
  root.append(grid);
}

export function render(root, ctx) {
  root.append(pageHead('Money', { actions: [addBtn('Spent', () => editTxn(null))] }));
  root.append(seg([['budget', 'Budget'], ['spending', 'Spending'], ['bank', 'Bank'], ['bills', 'Bills'], ['goals', 'Goals'], ['grow', 'Grow'], ['insights', 'Insights']], tab, v => { tab = v; ctx.rerender(); }));
  if (tab === 'budget') renderBudget(root, ctx);
  else if (tab === 'spending') renderSpending(root, ctx);
  else if (tab === 'bank') renderBank(root, ctx, catNames());
  else if (tab === 'bills') renderBills(root);
  else if (tab === 'grow') renderGrow(root);
  else if (tab === 'insights') renderInsights(root, ctx);
  else renderGoals(root);
}
