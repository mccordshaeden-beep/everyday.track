// app.js — starts the app: draws the navigation, shows the right screen for the
// URL (#/tasks, #/food …), and redraws when data changes.

import { modules, byId } from './modules/index.js';
import * as store from './store.js';
import { initSync, onStatus } from './sync.js';
import { h, icon, paintDots } from './ui.js';
import { DEFAULT_TABS } from './modules/settings.js';

const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');
const tabbar = document.getElementById('tabbar');
let pendingRemote = false;

function currentId() {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'today';
  return byId[id] ? id : 'today';
}

function navigate(id) {
  if (currentId() === id) render();
  else location.hash = '#/' + id;
}

const ctx = { navigate, rerender: () => render(true) };

function render(keepScroll = false) {
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
  const tabs = (saved?.length ? saved : DEFAULT_TABS).filter(t => byId[t] && t !== 'more').slice(0, 4);
  const link = (m, cls) => h('a', { href: '#/' + m.id, class: cls + (m.id === active ? ' active' : '') },
    icon(m.glyph), h('span', {}, m.title));

  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'Everyday'),
    ...modules.filter(m => m.id !== 'more').map(m => link(m, 'side-link')));

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

let lastUser;
onStatus(s => {
  paintDots();
  if (s.user?.id !== lastUser) { lastUser = s.user?.id; if (currentId() === 'settings') render(true); }
});

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// Redraw just after midnight so "Today" moves on if the app is left open.
setInterval(() => {
  const d = new Date().toDateString();
  if (d !== window.__lastDay) { if (window.__lastDay) render(true); window.__lastDay = d; }
}, 60_000);
window.__lastDay = new Date().toDateString();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker failed', err));
}

render();
initSync();
