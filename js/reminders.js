// reminders.js — phone notifications.
//
// How it works: the app (which knows your schedule) writes the next 10 days of
// reminders into the `reminders` table. A server function checks that table every
// 5 minutes and sends any that are due to every device you turned reminders on for.
// The list refreshes whenever your data changes or you open the app.

import * as store from './store.js';
import { getClient, getStatus, onStatus, callFunction } from './sync.js';
import { ymd, addDays, parseYmd, fmtTime, money, daysBetween, relDay } from './ui.js';
import { eventsOn } from './modules/calendar.js';
import { nextDue, nextRenewal } from './modules/money.js';
import { myChores as chores, dueDate } from './modules/chores.js';
import { habits, scheduled, met, isQuit, weekDone } from './modules/habits.js';

const CFG_ID = 'settings:reminders';
const DAYS_AHEAD = 10;
const DEFAULTS = { enabled: false, morningOn: true, morning: '08:00', eventsOn: true, eventMinutes: 30, eveningOn: true, evening: '20:00' };

export const getConfig = () => ({ ...DEFAULTS, ...(store.get(CFG_ID) || {}) });
export const saveConfig = patch => store.save('settings', patch, CFG_ID);

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || isIOS()) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Computer';
}

/** Is this device currently subscribed? */
export async function enabledHere() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Turn on reminders for this device. Must be called straight from a tap. */
export async function enableHere() {
  if (!getStatus().user) throw new Error('Sign in first.');
  if (isIOS() && !isStandalone()) throw new Error('On iPhone and iPad, open Everyday from its Home Screen icon (not Safari) and try again.');
  if (!pushSupported()) throw new Error('This browser can\'t show notifications.');
  const permission = await Notification.requestPermission(); // must be the first await (iPhone requires it)
  if (permission !== 'granted') throw new Error('Notifications are blocked. Turn them on in your device settings for Everyday, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await callFunction('push', { action: 'vapid' });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const j = sub.toJSON();
  const { error } = await getClient().from('push_subscriptions').upsert(
    { user_id: getStatus().user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() },
    { onConflict: 'user_id,endpoint' });
  if (error) throw new Error(error.message);
  if (!getConfig().enabled) saveConfig({ enabled: true });
  await reschedule();
}

export async function disableHere() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await getClient()?.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

export const sendTest = () => callFunction('push', { action: 'test' });

// ---- building the schedule ------------------------------------------------------------
const at = (date, hhmm) => { const [h, m] = (hhmm || '08:00').split(':').map(Number); const d = parseYmd(date); d.setHours(h, m || 0, 0, 0); return d; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function thingsOn(d, isToday) {
  const parts = [];
  const evs = eventsOn(d);
  if (evs.length) parts.push(evs.length === 1 ? `${evs[0].title}${evs[0].start ? ' at ' + fmtTime(evs[0].start) : ''}` : `${plural(evs.length, 'event')} (first: ${evs[0].title}${evs[0].start ? ' ' + fmtTime(evs[0].start) : ''})`);
  const tasks = store.list('tasks').filter(t => !t.done && t.due === d);
  tasks.slice(0, 3).forEach(t => parts.push(`${t.title} due`));
  if (tasks.length > 3) parts.push(`+${tasks.length - 3} more tasks`);
  if (isToday) {
    const overdue = store.list('tasks').filter(t => !t.done && t.due && t.due < d).length;
    if (overdue) parts.push(`${overdue} overdue`);
  }
  for (const b of store.list('bills')) { const due = nextDue(b); if (due === d || (isToday && due && due < d)) parts.push(`${b.name} ${due < d ? 'overdue' : 'due'}${b.amount ? ` (${money(b.amount)})` : ''}`); }
  for (const s of store.list('subs')) if (s.active !== false && nextRenewal(s) === d) parts.push(`${s.name} renews (${money(s.amount)})`);
  for (const s of store.list('subs')) {
    if (s.active === false) continue;
    const r = nextRenewal(s);
    if (s.cancelBy && s.cancelBy >= d && daysBetween(d, s.cancelBy) <= 2) parts.push(`Cancel ${s.name} by ${s.cancelBy === d ? 'today' : relDay(s.cancelBy)}`);
    else if (s.canceling && r && r >= d && daysBetween(d, r) <= 2) parts.push(`Cancel ${s.name} before it renews ${r === d ? 'today' : relDay(r)}`);
  }
  const ch = chores().filter(c => (isToday ? dueDate(c) <= d : dueDate(c) === d) && c.lastDone !== d);
  if (ch.length) parts.push(ch.length === 1 ? `Clean: ${ch[0].name}` : `${plural(ch.length, 'chore')} to do`);
  return parts;
}

export function buildReminders(cfg = getConfig()) {
  const now = Date.now();
  const today = ymd();
  const out = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = addDays(today, i);
    if (cfg.morningOn) {
      const t = at(d, cfg.morning);
      const parts = t > now ? thingsOn(d, i === 0) : [];
      if (parts.length) out.push({ kind: 'morning', fire_at: t.toISOString(), title: `Today: ${plural(parts.length, 'thing')}`, body: parts.join(' · ').slice(0, 240), url: '#/today' });
    }
    if (cfg.eventsOn) {
      for (const ev of eventsOn(d)) {
        if (!ev.start) continue;
        const t = new Date(at(d, ev.start).getTime() - (Number(cfg.eventMinutes) || 30) * 60000);
        if (t > now) out.push({ kind: 'event', fire_at: t.toISOString(), title: ev.title, body: `${fmtTime(ev.start)}${ev.location ? ' · ' + ev.location : ''}`, url: '#/calendar' });
      }
    }
    // per-habit reminders (skipped once you've already done it today, or hit this week's goal)
    for (const hb of habits()) {
      if (!hb.remind || isQuit(hb) || !scheduled(hb, d)) continue;
      if (i === 0 && met(hb, d)) continue;
      if (hb.schedule === 'weekly') {
        const ws = addDays(d, -((parseYmd(d).getDay() + 6) % 7));
        if (weekDone(hb, ws, d) >= (Number(hb.perWeek) || 3)) continue;
      }
      const t = at(d, hb.remind);
      if (t > now) out.push({ kind: 'habit', fire_at: t.toISOString(), title: `${hb.emoji || '⏰'} ${hb.name}`, body: Number(hb.goal) > 1 ? `Goal today: ${hb.goal}${hb.unit ? ' ' + hb.unit : ''}` : 'Time for this habit ✓', url: '#/habits' });
    }
    if (cfg.eveningOn) {
      const t = at(d, cfg.evening);
      const tmr = addDays(d, 1);
      const items = [
        ...store.list('tasks').filter(x => !x.done && x.due === tmr).map(x => x.title),
        ...store.list('bills').filter(b => nextDue(b) === tmr).map(b => `${b.name}${b.amount ? ` (${money(b.amount)})` : ''}`),
      ];
      if (t > now && items.length) out.push({ kind: 'evening', fire_at: t.toISOString(), title: 'Due tomorrow', body: items.slice(0, 5).join(' · ') + (items.length > 5 ? ` +${items.length - 5} more` : ''), url: '#/tasks' });
    }
  }
  return out.slice(0, 300);
}

let busy = false, again = false, lastRun = 0;
/** Replace this account's upcoming reminders with a fresh schedule. */
export async function reschedule() {
  const client = getClient(), user = getStatus().user;
  if (!client || !user) return;
  if (busy) { again = true; return; }
  busy = true;
  try {
    const cfg = getConfig();
    const nowIso = new Date().toISOString();
    const { error: delErr } = await client.from('reminders').delete().is('sent_at', null).gt('fire_at', nowIso);
    if (delErr) throw delErr;
    if (cfg.enabled) {
      const rows = buildReminders(cfg).map(r => ({ ...r, user_id: user.id }));
      for (let i = 0; i < rows.length; i += 150) {
        const { error } = await client.from('reminders').upsert(rows.slice(i, i + 150), { onConflict: 'user_id,kind,fire_at,title', ignoreDuplicates: true });
        if (error) throw error;
      }
    }
    lastRun = Date.now();
  } catch (e) {
    console.warn('Could not schedule reminders', e);
  } finally {
    busy = false;
    if (again) { again = false; setTimeout(reschedule, 1000); }
  }
}

/** Keep the schedule fresh: after changes, after signing in, and when the app is reopened. */
export function startAutoSchedule() {
  let timer;
  const soon = (ms = 15000) => { clearTimeout(timer); timer = setTimeout(() => { if (getConfig().enabled) reschedule(); }, ms); };
  store.subscribe(() => soon());
  let first = true;
  onStatus(s => { if (s.user && s.state === 'idle' && first) { first = false; soon(3000); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > 30 * 60000) soon(3000);
  });
}
