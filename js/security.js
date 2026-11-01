// security.js — Settings → Security: app lock, auto-lock, two-step login, private vault,
// and "sign out if unused".
import * as lock from './lock.js';
import * as vault from './vault.js';
import { getStatus, mfaFactors, mfaEnroll, mfaVerify, mfaUnenroll } from './sync.js';
import { h, card, btn, openSheet, toast } from './ui.js';
import * as store from './store.js';

const AFTER = [[0, 'Immediately when I leave the app'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [60, 'After 1 hour']];
const UNUSED = [[0, 'Never'], [1, '1 day'], [7, '7 days'], [30, '30 days']];

function sel(options, value, onChange, label) {
  const s = h('select', { 'aria-label': label, onchange: e => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = String(value);
  return s;
}

// ---- PIN sheet (set or change) ----------------------------------------------------------------
function pinSheet(rerender, { needOld = false } = {}) {
  const field = (ph, label) => h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '12', autocomplete: 'off', placeholder: ph, 'aria-label': label });
  const old = needOld ? field('Current PIN', 'Current PIN') : null;
  const a = field('New PIN (6–12 digits)', 'New PIN'), b = field('Type it again', 'Confirm PIN');
  const msg = h('p', { class: 'bad small', role: 'status' });
  const form = h('form', { class: 'stack-sm', onsubmit: async e => {
    e.preventDefault(); msg.textContent = '';
    if (old && !(await lock.checkPin(old.value))) { msg.textContent = 'Current PIN isn\'t right.'; return; }
    if (a.value !== b.value) { msg.textContent = 'The PINs don\'t match.'; return; }
    try { await lock.setPin(a.value); } catch (err) { msg.textContent = err.message; return; }
    dlg.close();
    toast(needOld ? 'PIN changed ✓' : 'App lock is on 🔒');
    if (!needOld && !lock.biometricOn() && await lock.biometricAvailable()) offerBiometric(rerender); else rerender();
  } }, old, a, b, msg, h('button', { type: 'submit', class: 'btn primary' }, needOld ? 'Change PIN' : 'Turn on app lock'));
  const dlg = openSheet({ title: needOld ? 'Change PIN' : 'Set up app lock', body: [
    needOld ? null : h('p', { class: 'muted' }, 'Pick a PIN for this device. You\'ll use it (or Face ID) to open Everyday. It\'s separate from your phone\'s passcode, and it\'s only stored here as a scrambled hash.'),
    form] });
  setTimeout(() => (old || a).focus(), 60);
}
async function offerBiometric(rerender) {
  try { await lock.enrollBiometric(getStatus().user?.email || 'Everyday'); toast('Face ID / Touch ID unlock is on ✓'); }
  catch (e) { toast(e?.name === 'NotAllowedError' ? 'Face ID setup cancelled' : 'Couldn\'t set up Face ID: ' + (e.message || e)); }
  rerender();
}
async function confirmPin(title) {
  return new Promise(res => {
    const pin = h('input', { type: 'password', inputmode: 'numeric', maxlength: '12', placeholder: 'PIN', 'aria-label': 'PIN' });
    const msg = h('p', { class: 'bad small' });
    let done = false;
    const dlg = openSheet({ title, body: [h('form', { class: 'stack-sm', onsubmit: async e => {
      e.preventDefault();
      if (await lock.checkPin(pin.value)) { done = true; dlg.close(); res(true); } else msg.textContent = 'Wrong PIN.';
    } }, pin, msg, h('button', { type: 'submit', class: 'btn primary' }, 'Confirm'))] });
    dlg.addEventListener('close', () => { if (!done) res(false); });
    setTimeout(() => pin.focus(), 60);
  });
}

function appLockSection(rerender) {
  const on = lock.lockEnabled();
  const cfg = lock.getCfg();
  const bioRow = h('div', { class: 'sec-row' });
  if (on) lock.biometricAvailable().then(ok => {
    if (!ok && !lock.biometricOn()) { bioRow.replaceChildren(h('span', { class: 'muted small' }, 'Face ID / Touch ID isn\'t available in this browser. Your PIN still works.')); return; }
    bioRow.replaceChildren(h('span', {}, lock.biometricOn() ? '🙂 Face ID / Touch ID: on' : '🙂 Face ID / Touch ID: off'),
      lock.biometricOn() ? btn('Turn off', () => { lock.removeBiometric(); rerender(); }, 'ghost sm') : btn('Turn on', () => offerBiometric(rerender), 'ghost sm'));
  });
  return h('div', { class: 'sec-block' },
    h('h3', {}, '🔒 App lock (this device)'),
    on ? [
      h('p', { class: 'muted small' }, 'Everyday asks for Face ID / Touch ID or your PIN when you open it.'),
      bioRow,
      h('label', { class: 'sec-row' }, h('span', {}, 'Lock'), sel(AFTER, cfg.after, v => { lock.setAfter(v); toast('Saved ✓'); }, 'Auto-lock')),
      h('div', { class: 'btn-row' },
        btn('Lock now', () => lock.lockNow(), 'ghost sm'),
        btn('Change PIN', () => pinSheet(rerender, { needOld: true }), 'ghost sm'),
        btn('Turn off', async () => { if (await confirmPin('Turn off app lock')) { lock.removeLock(); toast('App lock is off'); rerender(); } }, 'ghost sm')),
    ] : [
      h('p', { class: 'muted small' }, 'Ask for Face ID / Touch ID or a PIN whenever Everyday opens, and lock it again after a while. This keeps people out if they pick up your unlocked phone.'),
      h('div', { class: 'btn-row' }, btn('Set up app lock', () => pinSheet(rerender), 'primary sm')),
    ]);
}

// ---- two-step login (authenticator app) -----------------------------------------------------
function mfaSetup(rerender) {
  const body = h('div', { class: 'stack-sm' }, h('p', { class: 'muted' }, 'Getting a code ready…'));
  const dlg = openSheet({ title: 'Turn on two-step login', body: [body] });
  mfaEnroll().then(f => {
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '123 456', 'aria-label': '6-digit code', class: 'mfa-code' });
    const msg = h('p', { class: 'bad small', role: 'status' });
    body.replaceChildren(
      h('ol', { class: 'steps' },
        h('li', {}, 'Get an authenticator app if you don\'t have one: iPhone\'s built-in Passwords app (iOS 18+), Google Authenticator, Microsoft Authenticator, or 2FAS. All free.'),
        h('li', {}, 'On another device, scan this QR code. On this phone, tap "Copy setup key" and paste it into the app, or tap "Open in authenticator".'),
        h('li', {}, 'Type the 6-digit code it shows.')),
      h('div', { class: 'qr' }, h('img', { src: f.qr, alt: 'QR code for your authenticator app', width: 180, height: 180 })),
      h('div', { class: 'btn-row' },
        btn('Copy setup key', () => navigator.clipboard?.writeText(f.secret).then(() => toast('Setup key copied ✓')), 'ghost sm'),
        h('a', { class: 'btn ghost sm', href: f.uri }, 'Open in authenticator')),
      h('p', { class: 'hint' }, 'Setup key: ', h('code', {}, f.secret.replace(/(.{4})/g, '$1 ').trim())),
      h('form', { class: 'stack-sm', onsubmit: async e => {
        e.preventDefault(); msg.textContent = '';
        try { await mfaVerify(code.value, f.id); dlg.close(); toast('Two-step login is on ✓'); rerender(); }
        catch (err) { msg.textContent = err.message; }
      } }, code, msg, h('button', { type: 'submit', class: 'btn primary' }, 'Verify and turn on')));
  }).catch(e => body.replaceChildren(h('p', { class: 'bad' }, 'Couldn\'t start setup: ' + e.message)));
}

function mfaSection(rerender) {
  const s = getStatus();
  const box = h('div', { class: 'sec-block' }, h('h3', {}, '🔑 Two-step login'));
  if (!s.configured || !s.user) { box.append(h('p', { class: 'muted small' }, 'Sign in to turn this on.')); return box; }
  const inner = h('div', {}, h('p', { class: 'muted small' }, 'Checking…'));
  box.append(inner);
  mfaFactors().then(list => {
    const on = list.filter(f => f.status === 'verified' && f.factor_type === 'totp');
    inner.replaceChildren(...(on.length ? [
      h('p', { class: 'small' }, `✅ On. Signing in on a new device needs your password and a code from your authenticator app (${on.length} set up).`),
      h('p', { class: 'hint' }, 'Tip: add a second authenticator (another phone, or a password manager) so losing one phone doesn\'t lock you out.'),
      h('div', { class: 'btn-row' },
        btn('Add another authenticator', () => mfaSetup(rerender), 'ghost sm'),
        btn('Turn off', async () => {
          if (!confirm('Turn off two-step login? Anyone with your password could then sign in.')) return;
          try { for (const f of on) await mfaUnenroll(f.id); toast('Two-step login is off'); rerender(); } catch (e) { toast(e.message); }
        }, 'ghost sm')),
    ] : [
      h('p', { class: 'muted small' }, 'Even if someone gets your password, they can\'t sign in without the 6-digit code from your phone. The database enforces it too: without the code, no data comes back.'),
      h('div', { class: 'btn-row' }, btn('Turn on two-step login', () => mfaSetup(rerender), 'primary sm')),
    ]));
  }).catch(e => inner.replaceChildren(h('p', { class: 'muted small' }, 'Can\'t check right now (' + e.message + '). Try again when online.')));
  return box;
}

// ---- private vault ---------------------------------------------------------------------------
function vaultSection(rerender) {
  const box = h('div', { class: 'sec-block' }, h('h3', {}, '🗝 Private vault (locked notes & journal)'));
  if (!vault.exists()) {
    box.append(h('p', { class: 'muted small' }, 'Not set up yet. In Notes, tap 🔒 Lock on a note, or "Encrypt my journal", to create it.'));
    return box;
  }
  const remembered = h('span', { class: 'muted small' });
  vault.isRemembered().then(r => { remembered.textContent = r ? ' · remembered on this device' : ''; });
  box.append(
    h('p', { class: 'small' }, vault.isUnlocked() ? '🔓 Unlocked' : '🔒 Locked', remembered),
    h('p', { class: 'hint' }, 'Locked notes and encrypted journal entries are scrambled before they sync. Only someone with your vault password can read them.'),
    h('div', { class: 'btn-row' },
      vault.isUnlocked() ? btn('Lock now', () => { vault.lock(); rerender(); }, 'ghost sm') : null,
      btn('Forget on this device', async () => { await vault.forgetOnDevice(); toast('This device will ask for the vault password next time'); rerender(); }, 'ghost sm'),
      btn('Reset vault…', async () => {
        if (!confirm('Reset the private vault? Every locked note and encrypted journal entry is PERMANENTLY deleted on all devices. This can\'t be undone.')) return;
        if (lock.lockEnabled() && !(await confirmPin('Confirm vault reset'))) return;
        for (const n of store.list('notes')) if (n.enc) store.remove(n.id);
        store.save('settings', { journal: false }, 'settings:notesec');
        await vault.reset();
        toast('Vault reset'); rerender();
      }, 'ghost sm danger')));
  return box;
}

export function securityCard(ctx) {
  const rerender = ctx.rerender;
  const s = getStatus();
  return card('Security', {},
    appLockSection(rerender),
    mfaSection(rerender),
    vaultSection(rerender),
    h('div', { class: 'sec-block' },
      h('h3', {}, '⏱ Sign out if unused (this device)'),
      h('label', { class: 'sec-row' }, h('span', { class: 'small' }, 'Sign out after'), sel(UNUSED, lock.getCfg().signOutDays, v => { lock.setSignOutDays(v); toast('Saved ✓'); }, 'Sign out if unused')),
      h('p', { class: 'hint' }, s.user ? 'If this device isn\'t used for that long, Everyday signs out and clears its copy. Good for a laptop or shared computer.' : 'Works once you\'re signed in.')));
}
