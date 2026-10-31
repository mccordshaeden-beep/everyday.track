// app.js — starts the app: shows the login screen if needed, draws the
// navigation, shows the right screen for the URL (#/tasks, #/food …), and
// redraws when data changes.

import { modules, byId } from './modules/index.js';
import * as store from './store.js';
import { initSync, onStatus, getStatus, updatePassword } from './sync.js';
import { h, icon, paintDots, openForm, toast } from './ui.js';
import { DEFAULT_TABS, isOn, applyTheme } from './modules/settings.js';
import { renderLogin } from './login.js';

const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
const tabbar = document.getElementById('tabbar');
let pendingRemote = false;

/** Screens this person has turned on (Settings → Your trackers). */
const visible = () => modules.filter(m => isOn(m.id));

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'today';
  return byId[id] && isOn(id) ? id : 'today';
}

function navigate(id) {
  if (currentId() === id) render();
  else location.hash = '#/' + id;
}

const ctx = { navigate, rerender: () => render(true) };

/** What should be on screen: the app, the login page, or a loading splash? */
function gate() {
  const s = getStatus();
  if (!s.configured) return 'app';           // no sync set up: single-device mode
  if (s.state === 'loading') return 'loading';
  if (!s.user && s.state === 'signed-out') return 'login';
  return 'app';                              // signed in, or offline with this device's copy
}

function render(keepScroll = false) {
  const g = gate();
  document.body.dataset.gate = g;
  if (g === 'loading') { main.replaceChildren(h('div', { class: 'splash' }, h('img', { src: 'icons/icon-192.png', alt: 'Everyday', width: 72, height: 72 }))); return; }
  if (g === 'login') { main.replaceChildren(renderLogin(() => render())); document.title = 'Sign in · Everyday'; return; }

  const id = currentId();
  const mod = byId[id];
  const y = window.scrollY;
  const focusKey = document.activeElement?.dataset?.fk; // keep the cursor in quick-add boxes

  const page = h('div', { class: `page page-${id}` });
  try {
    mod.render(page, ctx);
  } catch (e) {
    console.error(e);
    page.append(h('p', { class: 'empty' }, 'Something went wrong on this screen: ' + e.message));
  }
  main.replaceChildren(page);
  if (keepScroll) window.scrollTo(0, y);
  if (focusKey) main.querySelector(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true });

  renderNav(id);
  document.title = `${mod.title} · Everyday`;
}

function renderNav(active) {
  const saved = store.get('settings:ui')?.tabs;
  const tabs = (saved?.length ? saved : DEFAULT_TABS).filter(t => byId[t] && t !== 'more' && isOn(t)).slice(0, 4);
  const link = (m, cls) => h('a', { href: '#/' + m.id, class: cls + (m.id === active ? ' active' : '') },
    icon(m.glyph), h('span', {}, m.title));

  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'Everyday'),
    ...visible().filter(m => m.id !== 'more').map(m => link(m, 'side-link')));

  const moreActive = !tabs.includes(active);
  tabbar.replaceChildren(
    ...tabs.map(t => link(byId[t], 'tab')),
    h('a', { href: '#/more', class: 'tab' + (moreActive ? ' active' : '') }, icon('more'), h('span', {}, 'More')));
}

// Redraw when data changes. If a sync arrives while you're typing or a form is
// open, wait until you're done so your typing isn't wiped.
function busyTyping() {
  const a = document.activeElement;
  return document.querySelector('dialog[open]') ||
    (a && main.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value);
}
store.subscribe(source => {
  if (gate() !== 'app') return;
  if (source === 'remote' && busyTyping()) { pendingRemote = true; return; }
  render(true);
});
function flushPending() {
  setTimeout(() => {
    if (pendingRemote && !busyTyping()) { pendingRemote = false; render(true); }
  }, 60);
}
document.addEventListener('focusout', flushPending);
document.addEventListener('sheet-closed', flushPending);

// Redraw when someone signs in/out (or loading finishes).
let lastKey;
onStatus(s => {
  paintDots();
  const key = gate() + ':' + (s.user?.id || '');
  if (key !== lastKey) { lastKey = key; render(); }
});

// Opened from a "reset password" email.
document.addEventListener('password-recovery', () => openForm({
  title: 'New password',
  fields: [{ name: 'password', label: 'New password (8+ characters)', type: 'password', required: true, autofocus: true }],
  onSubmit: v => {
    if (v.password.length < 8) { toast('Use at least 8 characters'); return false; }
    updatePassword(v.password).then(() => toast('Password updated')).catch(e => toast(e.message));
  },
}));

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// Redraw just after midnight so "Today" moves on if the app is left open.
let lastDay = new Date().toDateString();
setInterval(() => {
  const d = new Date().toDateString();
  if (d !== lastDay) { lastDay = d; render(true); }
}, 60_000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker failed', err));
}

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
render();
initSync();
