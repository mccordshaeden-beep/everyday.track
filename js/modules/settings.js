// settings.js — sign in for sync, choose the phone tab bar, back up your data.
import * as store from '../store.js';
import { getStatus, signIn, signUp, signOut, syncNow, getClient } from '../sync.js';
import { SUPABASE_URL } from '../config.js';
import { h, pageHead, card, btn, toast, paintDots, openSheet } from '../ui.js';
import { modules } from './index.js';
import * as rem from '../reminders.js';
import { spaces, spaceLabel, spaceIcon, others } from '../share.js';
import { leaveHousehold } from '../sync.js';

export const id = 'settings';
export const title = 'Settings';
export const glyph = 'settings';

export const DEFAULT_TABS = ['today', 'calendar', 'food', 'money'];
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
        if (confirm('Sign out? Your data stays safe in your account and is removed from this device until you sign in again.')) {
          try { await rem.disableHere(); } catch {} // stop this device getting your reminders
          await signOut();
        }
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

function remindersCard(ctx) {
  const s = getStatus();
  const cfg = rem.getConfig();
  if (!s.configured || !s.user) return card('Reminders', {}, h('p', { class: 'muted' }, 'Sign in to get reminders on your phone.'));
  const msg = h('p', { class: 'muted', role: 'status' });
  const here = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Checking…');
  const testBtn = btn('Send a test', async () => {
    msg.textContent = 'Sending…';
    try { const r = await rem.sendTest(); msg.textContent = r.sent ? `Sent to ${r.sent} device${r.sent > 1 ? 's' : ''}. It should pop up in a few seconds.` : 'No device received it. Try turning reminders off and on again.'; }
    catch (e) { msg.textContent = e.message; }
  }, 'ghost');
  rem.enabledHere().then(on => {
    here.disabled = false;
    here.textContent = on ? 'Turn off on this device' : 'Turn on for this device';
    here.className = on ? 'btn ghost' : 'btn primary';
    here.onclick = async () => {
      msg.textContent = on ? 'Turning off…' : 'Turning on…';
      try {
        if (on) { await rem.disableHere(); msg.textContent = 'Reminders are off on this device.'; }
        else { await rem.enableHere(); msg.textContent = 'Reminders are on for this device ✓ Tap "Send a test" to try it.'; }
      } catch (e) { msg.textContent = e.message; }
      ctx.rerender();
    };
  });

  const setCfg = patch => { rem.saveConfig(patch); };
  const timeInput = (key) => h('input', { type: 'time', value: cfg[key], class: 'inline-time', onchange: e => setCfg({ [key]: e.target.value }) });
  const toggle = (key, label, extra) => h('label', { class: 'rem-opt' },
    h('input', { type: 'checkbox', checked: cfg[key], onchange: e => setCfg({ [key]: e.target.checked }) }),
    h('span', {}, label), extra || null);

  const iosNote = rem.isIOS() && !rem.isStandalone()
    ? h('p', { class: 'hint' }, 'On iPhone/iPad, reminders only work in the installed app: Share → Add to Home Screen, then open Everyday from that icon.') : null;

  return card('Reminders', {},
    h('p', { class: 'muted' }, 'Get notifications for your day, upcoming events, and things due tomorrow. Turn it on for each device you want them on.'),
    iosNote,
    h('div', { class: 'btn-row' }, here, testBtn),
    msg,
    cfg.enabled ? h('div', { class: 'rem-opts' },
      toggle('morningOn', 'Morning summary at', timeInput('morning')),
      toggle('eventsOn', 'Before events:', h('select', { class: 'inline-sel', onchange: e => setCfg({ eventMinutes: Number(e.target.value) }) },
        [10, 15, 30, 60, 120].map(m => h('option', { value: m, selected: Number(cfg.eventMinutes) === m }, m < 60 ? `${m} min` : `${m / 60} hr`)))),
      toggle('eveningOn', '"Due tomorrow" at', timeInput('evening')),
      h('p', { class: 'hint' }, 'Reminders are planned 10 days ahead and refresh whenever you open the app.'),
      h('div', { class: 'btn-row' }, btn('Pause all reminders', async () => { rem.saveConfig({ enabled: false }); await rem.reschedule(); ctx.rerender(); }, 'ghost sm'))) : null);
}


// ---- Meta Muse calendar connector (owner's account only) ------------------------------------
// The database only accepts keys for this account (see supabase/muse_connector.sql).
const MUSE_OWNER = '0e7ff033-c3cc-4c6f-ab5a-34fd5eb16153';
const MCP_URL = `${SUPABASE_URL}/functions/v1/calendar-mcp`;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'evd_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function copyRow(label, value) {
  return h('div', { class: 'copy-row' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'copy-box' }, h('code', {}, value),
      btn('Copy', async e => {
        try { await navigator.clipboard.writeText(value); toast('Copied'); }
        catch { toast('Couldn\'t copy. Press and hold to select it instead.'); }
      }, 'ghost sm')));
}

function museCard(ctx) {
  const s = getStatus();
  if (!s.user || s.user.id !== MUSE_OWNER) return null;
  const box = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const steps = h('ol', { class: 'steps-help' },
    h('li', {}, 'In Meta AI (Muse), start a chat and say: "Add a custom connector to this MCP server: [paste the Connector link]. It uses a Bearer token."'),
    h('li', {}, 'When Muse asks for the key or token, paste your Everyday key. Approve the connection.'),
    h('li', {}, 'Test it: "What\'s on my Everyday calendar this week?"'),
    h('li', {}, 'Set up reminders, for example: "Every morning at 7, check my Everyday calendar and remind me 2 days before and 2 hours before anything that\'s due."'));

  async function load() {
    const { data, error } = await getClient().from('calendar_tokens').select('id,label,created_at,last_used').order('created_at');
    if (error) { box.replaceChildren(h('p', { class: 'bad' }, error.message)); return; }
    box.replaceChildren(
      data.length ? h('div', {}, data.map(t => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, t.label),
          h('div', { class: 'row-sub' }, `Created ${new Date(t.created_at).toLocaleDateString()} · ${t.last_used ? 'last used ' + new Date(t.last_used).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not used yet'}`)),
        btn('Revoke', async () => {
          if (!confirm('Revoke this key? Muse will lose access to your calendar until you make a new key.')) return;
          await getClient().from('calendar_tokens').delete().eq('id', t.id);
          toast('Key revoked'); load();
        }, 'danger sm')))) : h('p', { class: 'muted' }, 'No key yet.'),
      h('div', { class: 'btn-row' }, btn(data.length ? 'Make a new key' : 'Create a key for Muse', create, 'primary')),
      copyRow('Connector link (MCP server URL)', MCP_URL),
      h('p', { class: 'field-label', style: { marginTop: '10px' } }, 'How to connect'),
      steps,
      h('p', { class: 'hint' }, 'Muse can only read your Calendar: events and things that are due. It can\'t see or change anything else, and you can revoke the key any time. Muse\'s menus may look a little different from these steps.'));
  }

  async function create() {
    const key = newKey();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver';
    const { error } = await getClient().from('calendar_tokens').insert({ user_id: s.user.id, token_hash: await sha256Hex(key), label: 'Meta Muse', tz });
    if (error) { toast(error.message); return; }
    openSheet({
      title: 'Your Muse key',
      body: [
        h('div', { class: 'allergy-warn' }, h('b', {}, 'Copy this now. '), 'For safety it\'s only shown once. Treat it like a password: anyone with it can read your calendar.'),
        copyRow('Everyday key', key),
        copyRow('Connector link', MCP_URL),
        h('p', { class: 'hint' }, 'If Muse only asks for a link (no separate key box), use this one instead. Keep it private:'),
        copyRow('Link with key built in', `${MCP_URL}?key=${key}`),
        steps.cloneNode(true),
      ],
      actions: [{ label: 'Done', cls: 'primary', onClick: load }],
    });
    load();
  }

  queueMicrotask(load);
  return card('Meta Muse (calendar only)', {},
    h('p', { class: 'muted' }, 'Let Meta\'s Muse read your Everyday calendar so it can remind you before things are due. Only your account sees this.'),
    box);
}

function sharingCard() {
  const s = getStatus();
  if (!s.configured || !s.user) return null;
  const list = spaces();
  return card('Sharing', {},
    h('p', { class: 'muted' }, 'People and households you share things with: calendar events, calendars, habits, the shopping list and cleaning. Use the "Calendar", "Do it together with" or "Share list" options to share.'),
    list.length ? list.map(g => h('div', { class: 'row' },
      h('span', { class: 'emoji' }, spaceIcon(g)),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, spaceLabel(g)),
        h('div', { class: 'row-sub' }, g.kind === 'pair' ? 'Just the two of you' : `Household · ${others(g).map(m => m.name).join(', ') || 'only you so far'}`)),
      btn(g.kind === 'pair' ? 'Stop sharing' : 'Leave', () => {
        if (confirm(`Stop sharing with ${spaceLabel(g)}? Things you shared stay with them; you'll stop seeing what's in this space.`)) leaveHousehold(g.id).then(() => toast('Done')).catch(e => toast(e.message));
      }, 'ghost sm'))) : h('p', { class: 'muted small' }, 'You aren\'t sharing anything yet.'));
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
    syncCard(ctx), sharingCard(), remindersCard(ctx), museCard(ctx), appearanceCard(ctx), trackersCard(), tabsCard(ctx), installCard(), backupCard(),
    card('This device', {},
      h('p', { class: 'muted' }, 'Erase removes the data stored on this device only. If you are signed in, it downloads again on the next sync.'),
      btn('Erase data on this device', () => {
        if (confirm('Erase all Everyday data on this device?')) { store.eraseLocal(); toast('Erased'); }
      }, 'danger'))));
  queueMicrotask(paintDots);
}
