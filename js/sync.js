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
  state: 'off', // off | signed-out | syncing | idle | error | offline
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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch (e) {
    set({ state: 'offline', error: 'Could not load the sync library. Working offline.' });
    return;
  }

  const { data } = await client.auth.getSession();
  set({ user: data.session?.user || null, state: data.session ? 'idle' : 'signed-out' });

  client.auth.onAuthStateChange((_event, session) => {
    const before = status.user?.id;
    set({ user: session?.user || null, state: session ? status.state === 'signed-out' ? 'idle' : status.state : 'signed-out' });
    if (session && session.user.id !== before) syncNow();
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
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data; // if email confirmation is on, data.session is null until they confirm
}

export async function signOut() {
  await client.auth.signOut();
}
