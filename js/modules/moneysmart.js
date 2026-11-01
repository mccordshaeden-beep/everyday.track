// moneysmart.js — the "thinking" part of Money:
//   • findSubscriptions(): spots charges that repeat (same place, about the same amount,
//     every week / month / year) so they can be tracked as subscriptions.
//   • priceChanges(): tracked subscriptions whose latest charge went up.
//   • waysToSave(): looks at the last 3 months and suggests realistic cuts with an
//     estimated monthly saving.
import * as store from '../store.js';
import { ymd, addDays, daysBetween, money, nextOnOrAfter } from '../ui.js';
import { cleanMerchant, merchantKey } from './bank.js';

const TX = 'txns';
const SUBS = 'subs';
const DISMISS_ID = 'settings:subdismiss'; // { keys: [merchantKey] }
const money0 = n => (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const expenses = (days = 120) => {
  const from = addDays(ymd(), -days);
  return store.list(TX).filter(t => t.type !== 'income' && t.category !== 'Transfer' && t.date >= from && Number(t.amount) > 0);
};
const keyOf = t => merchantKey(t.desc || t.note || '');
export const subKey = s => s.match || merchantKey(s.name || '');

// ---- recurring charges → subscriptions ---------------------------------------------------------
const CYCLE_DAYS = [['weekly', 7, 2], ['monthly', 30.4, 5], ['quarterly', 91, 10], ['yearly', 365, 20]];
const NOT_SUBS = /groceries|eating out|coffee|gas|cash|transfer|income|savings/i;

export function findSubscriptions() {
  const dismissed = new Set((store.get(DISMISS_ID) || {}).keys || []);
  const tracked = new Set(store.list(SUBS).map(subKey));
  const groups = {};
  for (const t of expenses(400)) { const k = keyOf(t); if (k) (groups[k] ||= []).push(t); }
  const out = [];
  for (const [k, list] of Object.entries(groups)) {
    if (tracked.has(k) || dismissed.has(k) || list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    const amts = list.map(t => Number(t.amount));
    const last = list[list.length - 1];
    // amounts must be steady (within 10% of the latest), allowing one price change
    const steady = amts.filter(a => Math.abs(a - amts[amts.length - 1]) / amts[amts.length - 1] <= 0.1).length >= Math.max(2, amts.length - 1);
    if (!steady) continue;
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date)).filter(g => g > 0);
    if (!gaps.length) continue;
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const cyc = CYCLE_DAYS.find(([, d, tol]) => Math.abs(avg - d) <= tol && gaps.every(g => Math.abs(g - d) <= tol * 1.6));
    if (!cyc) continue;
    if (cyc[0] === 'weekly' && list.length < 3) continue;
    if (NOT_SUBS.test(last.category) && list.length < 3) continue; // a coffee twice isn't a subscription
    if (daysBetween(last.date, ymd()) > cyc[1] * 1.6) continue;    // stopped already
    const prev = amts.length > 1 ? amts[amts.length - 2] : 0;
    out.push({ key: k, name: cleanMerchant(last.desc || last.note), amount: Number(last.amount), cycle: cyc[0], count: list.length, raisedFrom: prev && amts[amts.length - 1] > prev * 1.02 ? prev : 0,
      first: list[0].date, last: last.date, next: nextOnOrAfter(last.date, cyc[0], addDays(ymd(), 0)), category: last.category });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
export function dismissSubscription(key) {
  const keys = (store.get(DISMISS_ID) || {}).keys || [];
  store.save('settings', { keys: [...new Set([...keys, key])] }, DISMISS_ID);
}
/** Make a tracked subscription out of a detected one. */
export function trackSubscription(f) {
  return store.save(SUBS, { name: f.name, amount: f.amount, cycle: f.cycle, started: f.first, nextDate: f.next, category: 'Subscriptions', active: true, match: f.key, detected: true });
}
/** Tracked subscriptions whose newest bank charge is higher than the price you saved. */
export function priceChanges() {
  const latest = {};
  for (const t of expenses(100)) { const k = keyOf(t); if (!latest[k] || t.date > latest[k].date) latest[k] = t; }
  return store.list(SUBS).filter(s => s.active !== false).map(s => ({ s, t: latest[subKey(s)] }))
    .filter(({ s, t }) => t && Number(t.amount) > (Number(s.amount) || 0) * 1.02 && Number(t.amount) < (Number(s.amount) || 0) * 3)
    .map(({ s, t }) => ({ sub: s, was: Number(s.amount), now: Number(t.amount), date: t.date }));
}

// ---- ways to save --------------------------------------------------------------------------------
const DELIVERY = /doordash|dd \*|uber ?eats|grubhub|postmates|instacart|gopuff/i;
const STREAMING = /netflix|hulu|disney|max\b|hbo|paramount|peacock|prime video|apple tv|youtube (tv|premium)|crunchyroll|espn|sling|fubo/i;
const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/**
 * Suggestions sorted by how much they'd save a month.
 * ctx: { income, limits: [{name, limit}] }
 * Each: { id, icon, title, detail, save, action?: 'limit:<cat>'|'subs'|'goal'|'cancel:<subId>' }
 */
export function waysToSave(ctx = {}) {
  const tx = expenses(90);
  if (!tx.length) return [];
  const span = Math.max(1, Math.min(3, daysBetween(tx.reduce((a, t) => (t.date < a ? t.date : a), ymd()), ymd()) / 30.4)); // months of data (max 3)
  const perMo = v => v / span;
  const byCat = {};
  for (const t of tx) byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount);
  const out = [];
  const add = x => { if (x.save >= 5) out.push(x); };

  // 1. Eating out
  const eat = tx.filter(t => t.category === 'Eating out');
  if (eat.length) {
    const mo = perMo(eat.reduce((a, t) => a + Number(t.amount), 0)), times = perMo(eat.length), avg = mo / times;
    if (mo >= 60) {
      const swap = Math.max(1, Math.round(times / 3));
      add({ id: 'eat', icon: '🍔', title: `Eating out: about ${money0(mo)}/month`, save: Math.round(swap * Math.max(0, avg - 4)),
        detail: `About ${Math.round(times)} times a month at ${money0(avg)} each. Cooking ${swap} of those instead (about $4 a meal) would save about ${money0(swap * Math.max(0, avg - 4))}/month. Food → Recipes has cheap ideas.`, action: 'limit:Eating out' });
    }
  }
  // 2. Delivery apps
  const del = tx.filter(t => DELIVERY.test(t.desc || t.note || ''));
  if (del.length >= 2) {
    const mo = perMo(del.reduce((a, t) => a + Number(t.amount), 0));
    add({ id: 'delivery', icon: '🛵', title: `Delivery apps: ${money0(mo)}/month`, save: Math.round(mo * 0.3),
      detail: `Delivery fees, service fees and tips usually add 25–40%. Picking up the same food yourself would save about ${money0(mo * 0.3)}/month.` });
  }
  // 3. Coffee & treats
  const cof = tx.filter(t => t.category === 'Coffee & treats');
  if (cof.length >= 4) {
    const mo = perMo(cof.reduce((a, t) => a + Number(t.amount), 0)), times = perMo(cof.length);
    add({ id: 'coffee', icon: '🥤', title: `Drinks & treats: ${Math.round(times)}× a month (${money0(mo)})`, save: Math.round(mo / 2),
      detail: `Going half as often saves about ${money0(mo / 2)}/month, or ${money0(mo * 6)} a year. Try making them part of a weekly treat day.`, action: 'limit:Coffee & treats' });
  }
  // 4. Fees
  const fees = tx.filter(t => t.category === 'Fees & interest');
  if (fees.length) {
    const tot = fees.reduce((a, t) => a + Number(t.amount), 0);
    add({ id: 'fees', icon: '⚠️', title: `${money0(tot)} in bank fees & interest lately`, save: Math.round(perMo(tot)),
      detail: 'Fees are 100% avoidable. Turn on low-balance alerts in your bank app, put card payments on autopay for the full balance, and use your own bank\'s ATMs.' });
  }
  // 5. Small purchases
  const small = tx.filter(t => Number(t.amount) < 15 && !['Groceries', 'Subscriptions', 'Bills', 'Fees & interest'].includes(t.category));
  if (small.length >= 10) {
    const mo = perMo(small.reduce((a, t) => a + Number(t.amount), 0));
    if (mo >= 60) add({ id: 'small', icon: '🪙', title: `Small buys add up: ${money0(mo)}/month`, save: Math.round(mo * 0.3),
      detail: `${Math.round(perMo(small.length))} purchases under $15 a month. A "wait 24 hours" rule for anything that isn't a need usually cuts about a third.` });
  }
  // 6. Shopping trending up
  const shop = byCat.Shopping || 0;
  if (shop) {
    const last30 = tx.filter(t => t.category === 'Shopping' && t.date >= addDays(ymd(), -30)).reduce((a, t) => a + Number(t.amount), 0);
    const avg = perMo(shop);
    if (last30 > avg * 1.3 && last30 - avg > 40) add({ id: 'shop', icon: '🛍', title: `Shopping is up: ${money0(last30)} in the last 30 days`, save: Math.round(last30 - avg),
      detail: `That's ${money0(last30 - avg)} more than your usual ${money0(avg)}/month. Try a 30-day wishlist: if you still want it in a month, buy it then.`, action: 'limit:Shopping' });
  }
  // 7. Subscriptions: overlap + total
  const subs = store.list(SUBS).filter(s => s.active !== false);
  const subsMo = subs.reduce((a, s) => a + (Number(s.amount) || 0) * (PER_MONTH[s.cycle] ?? 1), 0);
  const streams = subs.filter(s => STREAMING.test(s.name));
  if (streams.length >= 2) {
    const sorted = streams.map(s => (Number(s.amount) || 0) * (PER_MONTH[s.cycle] ?? 1)).sort((a, b) => b - a);
    add({ id: 'stream', icon: '📺', title: `${streams.length} streaming services (${money0(sorted.reduce((a, b) => a + b, 0))}/month)`, save: Math.round(sorted.slice(1).reduce((a, b) => a + b, 0)),
      detail: `${streams.map(s => s.name).join(', ')}. Keep one at a time and rotate: watch what you want, cancel, switch next month. You don't lose anything.`, action: 'subs' });
  }
  const old = subs.filter(s => (s.reviewed || s.started || ymd()) < addDays(ymd(), -180) && !s.canceling);
  if (old.length) add({ id: 'audit', icon: '🔍', title: `Check ${old.length} subscription${old.length === 1 ? '' : 's'} you haven't reviewed in 6+ months`, save: Math.round(old.reduce((a, s) => a + (Number(s.amount) || 0) * (PER_MONTH[s.cycle] ?? 1), 0) * 0.3),
    detail: `${old.slice(0, 5).map(s => s.name).join(', ')}${old.length > 5 ? '…' : ''}. Ask "did I use this last month?" for each. Keep the ones you'd sign up for again today.`, action: 'subs' });
  if (ctx.income && subsMo / ctx.income > 0.08) add({ id: 'subs-share', icon: '🔁', title: `Subscriptions take ${Math.round((subsMo / ctx.income) * 100)}% of income`, save: Math.round(subsMo * 0.25),
    detail: `${money(subsMo)}/month in total. Most people can drop a quarter without missing them. Switching yearly ones you keep to annual billing saves too.`, action: 'subs' });
  // 8. Over the limit 2 months running
  for (const c of ctx.limits || []) {
    if (!c.limit) continue;
    const months = [0, 1].map(i => { const ym = addDays(ymd().slice(0, 7) + '-01', -i * 28).slice(0, 7); return store.list(TX).filter(t => t.type !== 'income' && t.category === c.name && t.date.startsWith(ym)).reduce((a, t) => a + Number(t.amount), 0); });
    if (months[1] > c.limit && months[0] > c.limit * (Number(ymd().slice(8)) / 30)) add({ id: 'over-' + c.name, icon: '📊', title: `${c.name} keeps going over its limit`, save: Math.round(months[1] - c.limit),
      detail: `Last month was ${money0(months[1])} against a ${money0(c.limit)} limit, and this month is on the same pace. Either cut back or set a more honest limit so Safe to spend stays right.`, action: 'limit:' + c.name });
  }
  return out.sort((a, b) => b.save - a.save);
}
