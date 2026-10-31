// sync.js — keeps every device in step through Supabase (a hosted Postgres database).
//
// How it works:
//   1. PUSH: send every "dirty" item (changed since last sync) to the `items` table.
//   2. PULL: ask the server for every row whose `synced_at` is newer than last time.
//   3. Conflicts: whichever copy has the newer `updated_at` wins (on the server, a
//      trigger enforces this; on the device, store.applyRemote does).
// It runs when the app opens, when you come back to it, shortly after any change,
// when you get back online, and once a minute while it's open.

import * as store from './store.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const status = {
  configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
  user: null,
  state: SUPABASE_URL && SUPABASE_KEY ? 'loading' : 'off', // off | loading | signed-out | syncing | idle | error | offline
  error: null,
  lastSync: store.getMeta('lastSyncAt') || null,
};
const listeners = new Set();
let client = null;
let timer = null;
let busy = false;
let again = false;

export function getStatus() { return status; }
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(status, patch); listeners.forEach(fn => fn(status)); }

export async function initSync() {
  if (!status.configured) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    set({ state: 'offline', error: 'Could not load the sync library. Working offline.' });
    return;
  }

  let session = null;
  try {
    // Don't hang forever on a bad connection: give up after 6 seconds and work offline.
    const res = await Promise.race([
      client.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    session = res.data.session;
  } catch {
    set({ state: 'offline' });
  }
  if (/access_token|error_description|[?&]code=/.test(location.href)) history.replaceState(null, '', location.pathname + '#/today');
  if (session) claimDevice(session.user);
  if (status.state === 'loading' || session) set({ user: session?.user || null, state: session ? 'idle' : 'signed-out' });

  client.auth.onAuthStateChange((event, session) => {
    const before = status.user?.id;
    // Opened from a "reset password" email: ask for the new password.
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => document.dispatchEvent(new Event('password-recovery')), 0);
    if (session) claimDevice(session.user);
    set({ user: session?.user || null, state: session ? (['signed-out', 'loading'].includes(status.state) ? 'idle' : status.state) : 'signed-out' });
    // Supabase recommends not calling it again from inside this callback, so wait a tick.
    if (session && session.user.id !== before) setTimeout(syncNow, 0);
  });

  store.subscribe(source => { if (source === 'local') schedule(1500); });
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => set({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);

  syncNow();
}

/**
 * Each device remembers which account its data belongs to. If a *different*
 * person signs in on this device, wipe the old copy first so their data never
 * mixes with (or gets uploaded into) someone else's account.
 */
function claimDevice(user) {
  const owner = store.getMeta('ownerId');
  if (owner === user.id) return;
  if (owner) store.eraseLocal();
  store.setMeta('ownerId', user.id);
}

function schedule(ms) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }

export async function syncNow() {
  if (!client || !status.user) return;
  if (!navigator.onLine) { set({ state: 'offline' }); return; }
  if (busy) { again = true; return; }
  busy = true;
  set({ state: 'syncing', error: null });

  try {
    // 1. PUSH
    const dirty = store.dirtyItems();
    for (let i = 0; i < dirty.length; i += 500) {
      const chunk = dirty.slice(i, i + 500);
      const rows = chunk.map(it => ({
        user_id: status.user.id,
        id: it.id,
        collection: it.col,
        data: it.data,
        updated_at: it.updatedAt,
        deleted: !!it.deleted,
      }));
      const { error } = await client.from('items').upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw error;
      store.markClean(chunk);
    }

    // 2. PULL (start 10s before the last cursor so nothing committed "late" is missed;
    //    rows we already have are ignored by applyRemote)
    const last = store.getMeta('lastPull');
    let cursor = last ? new Date(new Date(last).getTime() - 10_000).toISOString() : null;
    for (;;) {
      let q = client.from('items')
        .select('id,collection,data,updated_at,deleted,synced_at')
        .order('synced_at', { ascending: true })
        .limit(1000);
      if (cursor) q = q.gt('synced_at', cursor);
      const { data, error } = await q;
      if (error) throw error;
      if (!data.length) break;
      store.applyRemote(data);
      cursor = data[data.length - 1].synced_at;
      store.setMeta('lastPull', cursor);
      if (data.length < 1000) break;
    }

    const at = new Date().toISOString();
    store.setMeta('lastSyncAt', at);
    set({ state: 'idle', lastSync: at });
  } catch (e) {
    console.error('Sync failed', e);
    set({ state: 'error', error: e.message || String(e) });
  } finally {
    busy = false;
    if (again) { again = false; schedule(500); }
  }
}

export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  return data; // if email confirmation is on, data.session is null until they confirm
}

/** Upload anything unsaved, sign out, then clear this device for the next person. */
export async function signOut() {
  try { await syncNow(); } catch {}
  await client.auth.signOut({ scope: 'local' });
  store.eraseLocal();
}

export async function updatePassword(password) {
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function resetPassword(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) throw error;
}

/** The Supabase client (null until sync has loaded). */
export function getClient() { return client; }

/** Call one of our server functions; throws an Error with a readable message. */
export async function callFunction(name, body) {
  if (!client) throw new Error('Not connected yet. Try again in a moment.');
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
