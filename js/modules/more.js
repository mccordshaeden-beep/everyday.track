// more.js — on the phone, the "More" tab lists every screen as a big tile.
import { h, pageHead, icon } from '../ui.js';
import { modules } from './index.js';
import { isOn } from './settings.js';

export const id = 'more';
export const title = 'More';
export const glyph = 'more';

export function render(root, { navigate }) {
  root.append(pageHead('Everything'));
  root.append(h('div', { class: 'tiles' }, modules.filter(m => m.id !== 'more' && isOn(m.id)).map(m =>
    h('button', { type: 'button', class: 'tile', onclick: () => navigate(m.id) }, icon(m.glyph, 28), h('span', {}, m.title)))));
}
