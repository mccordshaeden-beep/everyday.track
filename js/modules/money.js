// money.js — budget + chart, spending log with subscriptions beside it, bills, and savings goals.
import * as store from '../store.js';
import {
  h, pageHead, card, empty, seg, addBtn, btn, icon, iconBtn, openForm, bar, barChart, money, toast,
  ymd, addDays, addMonths, daysBetween, relDay, parseYmd, fmtMonthYear,
  CYCLES, PER_MONTH, CYCLE_SHORT, nthOccurrence, nextOnOrAfter, countOccurrences,
} from '../ui.js';

export const id = 'money';
export const title = 'Money';
export const glyph = 'money';

const TX = 'txns';        // { date, amount, type: 'expense'|'income', category, note }
const SUBS = 'subs';      // { name, amount, cycle, started, nextDate, category, active, notes }
const BILLS = 'bills';    // { name, amount, cycle, dueDate, category, autopay, notes }
const PAID = 'billpays';  // id "bp:<billId>:<dueDate>" → { billId, due, paidOn, amount }
const GOALS = 'goals';    // { name, emoji, target, saved, deadline }
const BUDGET_ID = 'settings:budget'; // { income, categories: [{ name, limit }] }
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
  const billsMo = billsMonthly();
  const grid = h('div', { class: 'grid' });

  grid.append(card('This month', { action: btn('Edit budget', editBudget, 'ghost sm') },
    summaryBlock(month),
    h('dl', { class: 'facts' },
      s.income || s.budget.income ? [h('dt', {}, 'Income'), h('dd', {}, money(s.income || s.budget.income))] : null,
      h('dt', {}, 'Subscriptions'), h('dd', {}, `${money(subsMo)}/mo`),
      h('dt', {}, 'Bills'), h('dd', {}, `${money(billsMo)}/mo`),
      h('dt', {}, 'Fixed costs total'), h('dd', {}, `${money(subsMo + billsMo)}/mo`)),
    s.budget.isDefault ? h('p', { class: 'hint' }, 'These categories are examples. Tap "Edit budget" to set your own.') : null));

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

function addToGoal(g) {
  openForm({
    title: `Add to ${g.name}`,
    fields: [{ name: 'amount', label: 'Amount ($). Use a minus to take money out', type: 'number', step: '0.01', inputmode: 'decimal', required: true, autofocus: true }],
    onSubmit: v => {
      const saved = Math.max(0, (Number(g.saved) || 0) + Number(v.amount));
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
      btn('+ Add money', () => addToGoal(g), 'ghost sm')),
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

export function render(root, ctx) {
  root.append(pageHead('Money', { actions: [addBtn('Spent', () => editTxn(null))] }));
  root.append(seg([['budget', 'Budget'], ['spending', 'Spending'], ['bills', 'Bills'], ['goals', 'Goals']], tab, v => { tab = v; ctx.rerender(); }));
  if (tab === 'budget') renderBudget(root, ctx);
  else if (tab === 'spending') renderSpending(root, ctx);
  else if (tab === 'bills') renderBills(root);
  else renderGoals(root);
}
