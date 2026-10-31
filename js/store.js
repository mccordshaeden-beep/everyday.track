// store.js — the app's local database.
//
// Every record (a task, an event, a grocery item…) is saved as one "item":
//   { id, col, data, updatedAt, deleted }
//   col       = which collection it belongs to ("tasks", "events", …)
//   data      = the actual fields you typed in
//   updatedAt = when it last changed (used to decide which copy wins when syncing)
//   deleted   = we never truly delete, we mark it, so the deletion can sync to other devices
//
// Everything lives in the browser's localStorage, so the app works with no internet.
// sync.js reads the "dirty" list (things changed since the last sync) and pushes them up.

const KEY = 'everyday:data:v1';
const META = 'everyday:meta:v1';

let items = read(KEY, {});
let meta = { dirty: {}, ...read(META, {}) };
const subscribers = new Set();

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(items));
  localStorage.setItem(META, JSON.stringify(meta));
}
function emit(source) { subscribers.forEach(fn => fn(source)); }
const now = () => new Date().toISOString();

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Listen for changes. source is "local" (you changed something) or "remote" (sync pulled changes). */
export function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

/** All live records in a collection, as plain objects: { id, ...fields } */
export function list(col) {
  const out = [];
  for (const it of Object.values(items)) {
    if (it.col === col && !it.deleted) out.push({ id: it.id, ...it.data });
  }
  return out;
}

/** One record by id, or null. */
export function get(id) {
  const it = items[id];
  return it && !it.deleted ? { id, ...it.data } : null;
}

/** Create or update. Fields you pass are merged into the existing record. Returns the id. */
export function save(col, fields, id) {
  id = id || uid();
  const { id: _ignore, ...clean } = fields;
  const prev = items[id] && !items[id].deleted ? items[id].data : { created: now() };
  items[id] = { id, col, data: { ...prev, ...clean }, updatedAt: now(), deleted: false };
  meta.dirty[id] = true;
  persist();
  emit('local');
  return id;
}

/** Soft-delete so the deletion syncs to your other devices. */
export function remove(id) {
  const it = items[id];
  if (!it) return;
  items[id] = { ...it, deleted: true, updatedAt: now() };
  meta.dirty[id] = true;
  persist();
  emit('local');
}

// ---- used by sync.js ------------------------------------------------------

export function dirtyItems() {
  return Object.keys(meta.dirty).map(id => items[id] && { ...items[id] }).filter(Boolean);
}

/** After a successful upload, clear the dirty flag — unless it changed again meanwhile. */
export function markClean(pushed) {
  for (const it of pushed) {
    if (items[it.id] && items[it.id].updatedAt === it.updatedAt) delete meta.dirty[it.id];
  }
  persist();
}

/** Merge rows from the server. Newest updatedAt wins. */
export function applyRemote(rows) {
  let changed = false;
  for (const r of rows) {
    const updatedAt = new Date(r.updated_at).toISOString();
    const local = items[r.id];
    if (local && local.updatedAt >= updatedAt) continue;
    items[r.id] = { id: r.id, col: r.collection, data: r.data || {}, updatedAt, deleted: !!r.deleted };
    delete meta.dirty[r.id];
    changed = true;
  }
  if (changed) { persist(); emit('remote'); }
  return changed;
}

export function getMeta(key) { return meta[key]; }
export function setMeta(key, value) { meta[key] = value; persist(); }

// ---- backup / reset ---------------------------------------------------------

export function exportAll() {
  return { app: 'everyday', version: 1, exportedAt: now(), items: Object.values(items) };
}

export function importAll(backup) {
  if (!backup || !Array.isArray(backup.items)) throw new Error('That file is not an Everyday backup.');
  let n = 0;
  for (const it of backup.items) {
    if (!it.id || !it.col) continue;
    const local = items[it.id];
    if (local && local.updatedAt >= it.updatedAt) continue;
    items[it.id] = { id: it.id, col: it.col, data: it.data || {}, updatedAt: it.updatedAt || now(), deleted: !!it.deleted };
    meta.dirty[it.id] = true;
    n++;
  }
  persist();
  emit('local');
  return n;
}

export function eraseLocal() {
  items = {};
  meta = { dirty: {} };
  persist();
  emit('remote');
}

// Keep two open tabs on the same computer in step.
window.addEventListener('storage', e => {
  if (e.key === KEY) { items = read(KEY, {}); meta = { dirty: {}, ...read(META, {}) }; emit('remote'); }
});
