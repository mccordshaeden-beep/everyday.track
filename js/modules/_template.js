// _template.js — copy this file to add a new tracker (e.g. workouts.js, books.js).
//
// 1. Copy it:            js/modules/books.js
// 2. Change id/title/glyph and COL below.
// 3. Register it in js/modules/index.js:   import * as books from './books.js';
//    and add `books` to the modules array.
// 4. Add the file to the SHELL list in sw.js so it works offline.
// That's it: it appears in the menu, saves on the device, and syncs.

import * as store from '../store.js';
import { h, pageHead, card, empty, addBtn, openForm } from '../ui.js';

export const id = 'books';          // used in the URL: #/books
export const title = 'Books';       // shown in the menu
export const glyph = 'notes';       // any icon name from ICONS in ui.js

const COL = 'books';                // name of this tracker's collection

function edit(item) {
  openForm({
    title: item ? 'Edit book' : 'New book',
    values: item || {},
    fields: [
      { name: 'title', label: 'Title', required: true, autofocus: true },
      { name: 'author', label: 'Author' },
      { name: 'status', label: 'Status', type: 'select', options: ['Want to read', 'Reading', 'Finished'] },
    ],
    onSubmit: v => { store.save(COL, v, item?.id); },
    onDelete: item ? () => store.remove(item.id) : null,
  });
}

export function render(root, ctx) {
  root.append(pageHead(title, { actions: [addBtn('Add', () => edit(null))] }));
  const items = store.list(COL);
  root.append(card('All', {},
    items.length
      ? items.map(b => h('div', { class: 'row', onclick: () => edit(b) },
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, b.title), h('div', { class: 'row-sub' }, b.author || ''))))
      : empty('Nothing here yet.')));
}
