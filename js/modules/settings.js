// settings.js — sign in for sync, choose the phone tab bar, back up your data.
import * as store from '../store.js';
import { getStatus, signIn, signUp, signOut, syncNow } from '../sync.js';
import { h, pageHead, card, btn, toast, paintDots } from '../ui.js';
import { modules } from './index.js';

export const id = 'settings';
export const title = 'Settings';
export const glyph = 'settings';

export const DEFAULT_TABS = ['today', 'tasks', 'food', 'money'];
const UI_ID = 'settings:ui';
const ALWAYS_ON = ['today', 'settings', 'more', 'search'];

/** Is this screen turned on for the signed-in person? (Settings → Your trackers) */
export function isOn(id) {
  if (ALWAYS_ON.includes(id)) return true;
  const enabled = store.get(UI_ID)?.enabled;
  return !Array.isArray(enabled) || enabled.includes(id);
}

function trackersCard() {
  const choices = modules.filter(m => !ALWAYS_ON.includes(m.id));
  return card('Your trackers', {},
    h('p', { class: 'muted' }, 'Turn on only what you use. Hidden trackers keep their data, so you can turn them back on any time.'),
    h('div', { class: 'chip-row' }, choices.map(m => {
      const on = isOn(m.id);
      return h('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
        onclick: () => {
          const enabled = choices.map(c => c.id).filter(id => (id === m.id ? !on : isOn(id)));
          store.save('settings', { enabled }, UI_ID);
        },
      }, m.title);
    })));
}

function syncCard(ctx) {
  const s = getStatus();
  if (!s.configured) {
    return card('Sync between devices', {},
      h('p', {}, 'Sync is off, so everything is saved on this device only.'),
      h('p', { class: 'muted' }, 'To sync your phone, iPad and computers, follow "Turn on sync" in the README, then paste two values into js/config.js.'));
  }
  if (!s.user) {
    const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email', required: true });
    const pw = h('input', { type: 'password', placeholder: 'Password (8+ characters)', autocomplete: 'current-password', 'aria-label': 'Password', minlength: '8', required: true });
    const msg = h('p', { class: 'muted', role: 'status' });
    const run = async (fn, okMsg) => {
      if (!email.reportValidity() || !pw.reportValidity()) return;
      msg.textContent = 'Working…';
      try {
        const res = await fn(email.value.trim(), pw.value);
        msg.textContent = res && !res.session ? 'Check your email to confirm your account, then sign in here.' : okMsg;
      } catch (e) { msg.textContent = e.message; }
    };
    return card('Sign in to sync', {},
      h('p', { class: 'muted' }, 'Use the same account on every device. Anything on this device will be merged in.'),
      h('form', { class: 'stack-form', onsubmit: e => { e.preventDefault(); run(signIn, 'Signed in.'); } },
        email, pw,
        h('div', { class: 'btn-row' },
          h('button', { type: 'submit', class: 'btn primary' }, 'Sign in'),
          btn('Create account', () => run(signUp, 'Account created.'), 'ghost'))),
      msg);
  }
  return card('Sync', {},
    h('p', {}, 'Signed in as ', h('b', {}, s.user.email)),
    h('p', { class: 'muted sync-text' }),
    s.error ? h('p', { class: 'bad' }, s.error) : null,
    h('div', { class: 'btn-row' },
      btn('Sync now', () => syncNow(), 'primary'),
      btn('Sign out', async () => {
        if (confirm('Sign out? Your data stays safe in your account and is removed from this device until you sign in again.')) await signOut();
      }, 'ghost')));
}

function tabsCard(ctx) {
  const current = store.get(UI_ID)?.tabs?.length ? store.get(UI_ID).tabs : DEFAULT_TABS;
  const choices = modules.filter(m => !['more', 'settings'].includes(m.id) && isOn(m.id));
  return card('Phone tab bar', {},
    h('p', { class: 'muted' }, 'Pick up to 4 screens for the bottom bar. Everything else is under "More".'),
    h('div', { class: 'chip-row' }, choices.map(m => {
      const on = current.includes(m.id);
      return h('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
        onclick: () => {
          let next = on ? current.filter(x => x !== m.id) : [...current, m.id];
          if (next.length > 4) { toast('Up to 4: turn one off first'); return; }
          next = choices.map(c => c.id).filter(id => next.includes(id)); // keep menu order
          store.save('settings', { tabs: next }, UI_ID);
        },
      }, m.title);
    })));
}

/** Light / dark / follow the device. Saved per device, since a phone and a laptop may want different looks. */
export function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('everyday:theme') || 'auto'; } catch {}
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#111311' : '#f5f4ef'));
}

function appearanceCard(ctx) {
  let t = 'auto';
  try { t = localStorage.getItem('everyday:theme') || 'auto'; } catch {}
  return card('Appearance', {},
    h('p', { class: 'muted' }, 'Choose a look for this device.'),
    h('div', { class: 'seg', style: { marginTop: '10px' } }, [['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) =>
      h('button', { type: 'button', class: v === t ? 'on' : '', onclick: () => { try { localStorage.setItem('everyday:theme', v); } catch {} applyTheme(); ctx.rerender(); } }, label))));
}

function backupCard() {
  const file = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { const n = store.importAll(JSON.parse(await f.text())); toast(`Imported ${n} item(s)`); }
      catch (err) { alert(err.message); }
      e.target.value = '';
    },
  });
  return card('Backup', {},
    h('p', { class: 'muted' }, 'Download a copy of everything as a file, or restore one. Good to do now and then even with sync on.'),
    h('div', { class: 'btn-row' },
      btn('Download backup', () => {
        const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `everyday-backup-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
      }),
      btn('Restore from file', () => file.click(), 'ghost')),
    file);
}

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return card('Install on your devices', {},
    standalone ? h('p', {}, '✓ Running as an installed app.') : null,
    h('ul', { class: 'plain' },
      h('li', {}, h('b', {}, 'iPhone / iPad: '), 'open this page in Safari → Share button → "Add to Home Screen".'),
      h('li', {}, h('b', {}, 'Laptop / desktop: '), 'in Chrome or Edge, click the install icon at the right of the address bar. In Safari on a Mac: File → Add to Dock.'),
      h('li', {}, h('b', {}, 'Android: '), 'Chrome menu ⋮ → "Add to Home screen".')));
}

export function render(root, ctx) {
  root.append(pageHead('Settings'));
  root.append(h('div', { class: 'grid' },
    syncCard(ctx), appearanceCard(ctx), trackersCard(), tabsCard(ctx), installCard(), backupCard(),
    card('This device', {},
      h('p', { class: 'muted' }, 'Erase removes the data stored on this device only. If you are signed in, it downloads again on the next sync.'),
      btn('Erase data on this device', () => {
        if (confirm('Erase all Everyday data on this device?')) { store.eraseLocal(); toast('Erased'); }
      }, 'danger'))));
  queueMicrotask(paintDots);
}
