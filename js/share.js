// share.js — sharing things with other Everyday users.
//
// A "space" is either your household (roommates, made in Cleaning) or a private
// two-person space created when you share with someone by their account email.
// Anything saved into a space (an event, a calendar, a habit, the shopping list)
// syncs to everyone in it, and only to them (enforced by the database).
import * as store from './store.js';
import { getStatus, households, sharePerson } from './sync.js';
import { h, openForm, toast } from './ui.js';

const me = () => getStatus().user?.id || '';
export const canShare = () => !!(getStatus().configured && getStatus().user);
export const spaces = () => (getStatus().user ? households() : []);
export const spaceById = id => spaces().find(g => g.id === id) || null;

/** "Jordan" for a two-person space, the household name otherwise. */
export function spaceLabel(g) {
  if (!g) return '';
  if (g.kind === 'pair') { const o = (g.members || []).find(m => m.id !== me()); return o ? o.name : 'Shared'; }
  return g.name;
}
export const spaceIcon = g => (g?.kind === 'pair' ? '👤' : '🏠');
export const memberName = (g, uid) => (uid === me() ? 'You' : (g?.members || []).find(m => m.id === uid)?.name || 'Someone');
export const others = g => (g?.members || []).filter(m => m.id !== me());

/** Options for a "Shared with" <select>. */
export function shareOptions(privateLabel = 'Only me (private)') {
  return [['', privateLabel], ...spaces().map(g => [g.id, `${spaceIcon(g)} ${spaceLabel(g)}`]), ['__new', '➕ Someone new (by email)…']];
}

/** Turn a picked option into a space id ('' = private). Asks for an email if "someone new". */
export function resolveShare(value) {
  if (value !== '__new') return Promise.resolve(value || '');
  return new Promise(resolve => {
    let done = false;
    const dlg = openForm({
      title: 'Share with someone',
      fields: [
        { name: 'email', label: 'Their Everyday account email', type: 'email', required: true, autofocus: true, hint: 'They need an Everyday account. Only the two of you will see what you share.' },
        { name: 'me', label: 'Your name (what they\'ll see)', required: true },
      ],
      values: { me: (getStatus().user?.email || '').split('@')[0] },
      submitLabel: 'Share',
      onSubmit: v => {
        done = true;
        sharePerson(v.email, v.me).then(id => { toast('Shared ✓'); resolve(id); }).catch(e => { toast(e.message); resolve(null); });
      },
    });
    dlg.addEventListener('close', () => { if (!done) resolve(null); });
  });
}

/** Little "👤 Jordan" chip for something that's shared. */
export function sharedTag(id) {
  const g = spaceById(store.householdOf(id));
  return g ? h('span', { class: 'tag shared-tag', title: 'Shared' }, `${spaceIcon(g)} ${spaceLabel(g)}`) : null;
}

/**
 * Move a record into a space (or back to private). Records can't change place in the
 * database, so this saves a fresh copy in the new place and removes the old one.
 * Returns the new id (or the same id if nothing changed).
 */
export function moveTo(col, rec, hh) {
  if ((store.householdOf(rec.id) || '') === (hh || '')) return rec.id;
  const { id: oldId, ...data } = rec;
  const newId = store.save(col, data, undefined, { hh: hh || '' });
  store.remove(oldId);
  return newId;
}
