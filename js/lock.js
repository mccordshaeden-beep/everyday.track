// lock.js — App lock (Face ID / Touch ID / PIN), auto-lock, and "sign out if unused".
//
// These settings belong to each device (they're kept in this browser, not synced), because
// Face ID and a PIN only make sense on the phone or laptop you set them up on.
//  • PIN: at least 6 digits, stored only as a salted PBKDF2-SHA256 hash.
//  • Face ID / Touch ID: a passkey made just for unlocking (WebAuthn with user verification).
//  • Wrong PINs: after 5 tries you have to wait (30 s, then longer). After 10, Everyday signs
//    out and wipes this device's copy; your data is still safe in your account.
//  • Auto-lock: after the time you choose in the background or without a tap.
// The lock screen keeps people out of the app on an unlocked phone. Locked notes and the
// bank tab are also encrypted, which protects them even if the device's storage is copied.
import { h } from './ui.js';

const KEY = 'everyday-lock';
const ACTIVE = 'everyday-last-active';
const ITER = 210000;
const te = new TextEncoder();
const b64 = u8 => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u8 => [...new Uint8Array(u8)].map(b => b.toString(16).padStart(2, '0')).join('');

function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function write(cfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} }
export const getCfg = () => ({ after: 1, signOutDays: 0, ...read() });
const patch = p => write({ ...read(), ...p });

export const lockEnabled = () => !!read().pin;
export const biometricOn = () => !!read().cred;
export const isLocked = () => !!screen?.open;

let onWipe = async () => {};
let screen = null;      // the lock <dialog> while shown
let hiddenAt = 0;
let lastTouch = Date.now();

// ---- PIN ------------------------------------------------------------------------------------
async function hashPin(pin, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256));
}
export const pinOk = pin => /^\d{6,12}$/.test(pin) && !/^(\d)\1+$/.test(pin) && !['123456', '654321', '123123', '112233', '121212', '1234567', '12345678', '123456789', '000000', '111111', '696969', '159753', '147258', '102030'].includes(pin);
export async function setPin(pin) {
  if (!pinOk(pin)) throw new Error('Use 6 to 12 digits, and avoid easy ones like 123456 or 111111.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  patch({ pin: { salt: b64(salt), hash: await hashPin(pin, salt), iter: ITER }, fails: 0, until: 0 });
}
export async function checkPin(pin) {
  const p = read().pin;
  if (!p) return true;
  return (await hashPin(pin, unb64(p.salt), p.iter || ITER)) === p.hash;
}
export function removeLock() { const { after, signOutDays } = read(); write({ after, signOutDays }); }
export const setAfter = m => patch({ after: Number(m) });
export const setSignOutDays = d => patch({ signOutDays: Number(d) });

// ---- Face ID / Touch ID (a passkey used only to unlock this app) ------------------------------
export async function biometricAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
export async function enrollBiometric(label = 'Everyday') {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Everyday app lock', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `${label} (app lock)`, displayName: 'Everyday app lock' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none',
  } });
  patch({ cred: b64(cred.rawId) });
}
export const removeBiometric = () => patch({ cred: null });
async function biometricUnlock() {
  const id = read().cred;
  if (!id) return false;
  const a = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: location.hostname,
    allowCredentials: [{ type: 'public-key', id: unb64(id) }],
    userVerification: 'required', timeout: 60000,
  } });
  const flags = new Uint8Array(a.response.authenticatorData)[32];
  return !!(flags & 0x04); // UV: Face ID / Touch ID / device passcode actually checked
}

// ---- the lock screen --------------------------------------------------------------------------
function unlockNow() {
  if (!screen) return;
  const d = screen; screen = null;
  d.close(); d.remove();
  document.body.classList.remove('privacy');
  lastTouch = Date.now();
  document.dispatchEvent(new Event('app-unlocked'));
}

export function lockNow() {
  if (!lockEnabled() || screen) return;
  const cfg = read();
  const msg = h('p', { class: 'lock-msg', role: 'status' });
  const pin = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '12', placeholder: 'PIN', 'aria-label': 'PIN', class: 'lock-pin' });
  const go = h('button', { type: 'submit', class: 'btn primary big' }, 'Unlock');
  const waitMsg = () => {
    const c = read();
    if (c.until && Date.now() < c.until) { msg.textContent = `Too many wrong PINs. Try again in ${Math.ceil((c.until - Date.now()) / 1000)} s.`; return true; }
    return false;
  };
  const form = h('form', { class: 'lock-form', onsubmit: async e => {
    e.preventDefault();
    if (waitMsg()) return;
    go.disabled = true;
    const ok = await checkPin(pin.value);
    go.disabled = false;
    if (ok) { patch({ fails: 0, until: 0 }); unlockNow(); return; }
    const fails = (read().fails || 0) + 1;
    pin.value = '';
    if (fails >= 10) { msg.textContent = 'Too many wrong PINs. Signing out of this device…'; removeLock(); await onWipe(); location.reload(); return; }
    patch({ fails, until: fails >= 5 ? Date.now() + 30000 * 2 ** (fails - 5) : 0 });
    msg.textContent = fails >= 5 ? `Wrong PIN. ${10 - fails} tr${10 - fails === 1 ? 'y' : 'ies'} left before this device signs out.` : 'Wrong PIN.';
    waitMsg();
  } }, pin, go);
  const bio = cfg.cred ? h('button', { type: 'button', class: 'btn big lock-bio', onclick: async () => {
    msg.textContent = '';
    try { if (await biometricUnlock()) unlockNow(); else msg.textContent = 'Face ID didn\'t confirm it was you. Use your PIN.'; }
    catch (e) { msg.textContent = e?.name === 'NotAllowedError' ? 'Cancelled. Try again or use your PIN.' : 'Face ID isn\'t available right now. Use your PIN.'; }
  } }, '🙂 Unlock with Face ID / Touch ID') : null;
  const forgot = h('button', { type: 'button', class: 'mini-link', onclick: async () => {
    if (!confirm('Forgot your PIN? This signs out and removes Everyday\'s data from this device. Your data stays safe in your account. Sign back in with your email and password.')) return;
    removeLock(); await onWipe(); location.reload();
  } }, 'Forgot PIN? Sign out of this device');

  screen = h('dialog', { class: 'lock-screen', 'aria-label': 'Everyday is locked' },
    h('div', { class: 'lock-inner' },
      h('img', { src: 'icons/icon-192.png', alt: '', width: 64, height: 64 }),
      h('h1', {}, 'Everyday is locked'),
      bio, form, msg, forgot));
  screen.addEventListener('cancel', e => e.preventDefault()); // Esc can't dismiss it
  document.body.append(screen);
  screen.showModal();
  waitMsg();
  setTimeout(() => { if (!bio) pin.focus(); }, 50);
}

// ---- auto-lock + sign out when unused ---------------------------------------------------------
function touch() {
  lastTouch = Date.now();
  try { if (Date.now() - Number(localStorage.getItem(ACTIVE) || 0) > 60000) localStorage.setItem(ACTIVE, String(Date.now())); } catch {}
}

/** Start the app lock. onSignOut: signs out and wipes this device (used for PIN lockout & "unused"). */
export async function initLock({ onSignOut, signedIn }) {
  onWipe = onSignOut;
  // Sign out if this device hasn't been used for a while.
  const days = getCfg().signOutDays;
  const last = Number(localStorage.getItem(ACTIVE) || 0);
  if (days && last && signedIn() && Date.now() - last > days * 86400000) {
    try { localStorage.setItem(ACTIVE, String(Date.now())); } catch {}
    await onSignOut();
    location.reload();
    return;
  }
  touch();
  if (lockEnabled()) lockNow();

  document.addEventListener('pointerdown', touch, { passive: true, capture: true });
  document.addEventListener('keydown', touch, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!lockEnabled()) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (!getCfg().after) lockNow();          // "Immediately": lock as you leave
      else document.body.classList.add('privacy'); // hide content in the app switcher
    } else {
      const after = getCfg().after * 60000;
      if (hiddenAt && Date.now() - hiddenAt >= after) lockNow();
      else document.body.classList.remove('privacy');
      hiddenAt = 0;
    }
  });
  // Lock after no taps for the chosen time (5 minutes when "Immediately" is picked).
  setInterval(() => {
    if (!lockEnabled() || screen || document.visibilityState !== 'visible') return;
    const after = (getCfg().after || 5) * 60000;
    if (Date.now() - lastTouch >= after) lockNow();
  }, 15000);
}
