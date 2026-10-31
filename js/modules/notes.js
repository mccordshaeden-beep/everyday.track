// notes.js — quick notes and a simple journal, with search and pinning.
import * as store from '../store.js';
import { h, pageHead, empty, addBtn, openForm, relDay, ymd } from '../ui.js';

export const id = 'notes';
export const title = 'Notes';
export const glyph = 'notes';

const COL = 'notes'; // { title, body, pinned, edited }
let query = '';

function editNote(n) {
  openForm({
    title: n ? 'Note' : 'New note',
    values: n || {},
    fields: [
      { name: 'title', label: 'Title', autofocus: true, placeholder: 'Optional' },
      { name: 'body', label: 'Note', type: 'textarea', rows: 12 },
      { name: 'pinned', label: 'Pin to top', type: 'checkbox' },
    ],
    onSubmit: v => { if (!v.title && !v.body) return; store.save(COL, { ...v, edited: ymd() }, n?.id); },
    onDelete: n ? () => store.remove(n.id) : null,
  });
}

export function render(root, ctx) {
  root.append(pageHead('Notes', { actions: [addBtn('Note', () => editNote(null))] }));
  root.append(h('input', {
    type: 'search', class: 'search', placeholder: 'Search notes', value: query, 'data-fk': 'note-search', 'aria-label': 'Search notes',
    oninput: e => { query = e.target.value; ctx.rerender(); },
  }));

  const q = query.trim().toLowerCase();
  const notes = store.list(COL)
    .filter(n => !q || `${n.title} ${n.body}`.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned === true) - (a.pinned === true) || (b.edited || b.created || '').localeCompare(a.edited || a.created || ''));

  if (!notes.length) { root.append(empty(q ? 'No notes match.' : 'No notes yet.')); return; }
  root.append(h('div', { class: 'note-grid' }, notes.map(n => h('button', { type: 'button', class: 'note', onclick: () => editNote(n) },
    n.pinned ? h('span', { class: 'pin' }, 'Pinned') : null,
    n.title ? h('h3', {}, n.title) : null,
    h('p', {}, (n.body || '').slice(0, 220)),
    h('small', {}, relDay(n.edited || (n.created || '').slice(0, 10) || ymd()))))));
}
