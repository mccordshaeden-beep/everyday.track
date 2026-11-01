// vault.js — the private vault for locked notes and the journal.
//
// Same idea as the bank vault: a random 130-bit vault password (shown once, for you to save)
// is stretched with PBKDF2-SHA256 (600,000 rounds) into an AES-256-GCM key. Locked notes and
// journal entries are encrypted on this device before they are saved or synced, so the
// database only ever holds scrambled text. Nobody can read it without the vault password:
// not someone with your account password, and not the database owner.
//
// Typing a 26-character password every time would be painful, so each device can
// "remember" the vault: the key is kept in this browser's IndexedDB as a non-extractable
// CryptoKey (the browser can use it but will never hand out the raw key). Pair that with the
// app lock (Face ID / PIN) so someone holding your phone can't open it.
import * as store from './store.js';
import { generatePassword, normalizePassword } from './modules/bank.js';

const VAULT_ID = 'settings:notevault'; // { salt, iter, check: { iv, ct }, created }
const ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let key = null;
const listeners = new Set();
export const onVault = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export { generatePassword };
export const exists = () => !!store.get(VAULT_ID)?.salt;
export const isUnlocked = () => !!key;

async function derive(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256));
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']); // non-extractable
}
export async function seal(obj, k = key) {
  if (!k) throw new Error('Vault is locked');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(obj))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
export async function open(box, k = key) {
  if (!k) throw new Error('Vault is locked');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

// ---- remembering the key on this device (IndexedDB) ------------------------------------------
const DB = 'everyday-vault', STORE = 'keys';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode); const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { res(req?.result); db.close(); }; tx.onerror = () => { rej(tx.error); db.close(); };
  });
}
const slot = () => `${store.getMeta('ownerId') || 'local'}:${store.get(VAULT_ID)?.salt || ''}`;
async function remember(k) { try { await idbDo('readwrite', s => s.put(k, slot())); } catch (e) { console.warn('Could not remember vault', e); } }
export async function forgetOnDevice() { key = null; try { await idbDo('readwrite', s => s.clear()); } catch {} emit(); }
export async function isRemembered() { try { return !!(await idbDo('readonly', s => s.get(slot()))); } catch { return false; } }

/** Try the remembered key (no password needed). Returns true if unlocked. */
export async function tryRemembered() {
  if (key || !exists()) return !!key;
  try {
    const k = await idbDo('readonly', s => s.get(slot()));
    if (!k) return false;
    await open(store.get(VAULT_ID).check, k);
    key = k; emit(); return true;
  } catch { return false; }
}

export async function create(password, rememberIt = true) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await derive(password, salt, ITER);
  const check = await seal({ ok: 'everyday-notes-v1' }, k);
  store.save('settings', { salt: b64(salt), iter: ITER, check, created: new Date().toISOString() }, VAULT_ID);
  key = k;
  if (rememberIt) await remember(k);
  emit();
}

export async function unlock(password, rememberIt = true) {
  const v = store.get(VAULT_ID);
  const k = await derive(password, unb64(v.salt), v.iter || ITER);
  try { await open(v.check, k); } catch { throw new Error('That vault password isn\'t right.'); }
  key = k;
  if (rememberIt) await remember(k);
  emit();
}

export function lock() { if (!key) return; key = null; emit(); }

/** Delete the vault itself (locked items become unreadable). */
export async function reset() {
  store.remove(VAULT_ID);
  await forgetOnDevice();
}

// A vault created on another device arrives by sync: try this device's remembered key.
store.subscribe(src => { if (src === 'remote' && !key && exists()) tryRemembered(); });
