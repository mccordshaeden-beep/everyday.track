// ui.js — small building blocks every screen uses: h() to make elements,
// icons, cards, forms (bottom sheets), date and money formatting.

import { getStatus } from './sync.js';

/**
 * h('div', { class: 'card', onclick: fn }, 'text', childEl, [moreKids])
 * A tiny helper for creating DOM elements without a framework.
 */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

// ---- icons (simple line drawings, 24×24) -----------------------------------
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  food: '<path d="M3 12h18a9 9 0 0 1-18 0z"/><path d="M8.5 8c0-1.6 1.5-1.8 1.5-3.5M13.5 8c0-1.6 1.5-1.8 1.5-3.5"/>',
  money: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M15.5 15h2.5"/>',
  habits: '<path d="M3 12h4l2.5-5.5 4.5 11 2.5-5.5H21"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  more: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  cart: '<path d="M3 4h2.2l2.1 11h10.9l2-8H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  school: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
  clean: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---- dates (always "YYYY-MM-DD" strings in local time) -----------------------
export const pad = n => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function addMonths(s, n) {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ymd(d);
}
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
export function fmtDay(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseYmd(s).toLocaleDateString(undefined, opts);
}
export function relDay(s) {
  const diff = daysBetween(ymd(), s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDay(s);
}
export function fmtTime(t) {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  const d = new Date(); d.setHours(hh, mm);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export const money = n => (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

// ---- building blocks ----------------------------------------------------------
export function pageHead(title, { eyebrow, actions = [] } = {}) {
  const dot = h('span', { class: 'sync-dot' });
  paintDot(dot);
  return h('header', { class: 'page-head' },
    h('div', {}, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, h('h1', {}, title)),
    h('div', { class: 'head-actions' }, dot, ...actions));
}

const STATE_TEXT = {
  'signed-out': 'Not signed in: changes stay on this device',
  syncing: 'Syncing…',
  idle: 'Synced',
  error: 'Sync problem: see Settings',
  offline: 'Offline: changes will sync later',
};
function paintDot(el) {
  const s = getStatus();
  el.hidden = !s.configured;
  el.dataset.state = s.state;
  el.title = STATE_TEXT[s.state] || '';
}
export function paintDots() {
  document.querySelectorAll('.sync-dot').forEach(paintDot);
  document.querySelectorAll('.sync-text').forEach(el => {
    const s = getStatus();
    el.textContent = (STATE_TEXT[s.state] || '') + (s.lastSync && s.state === 'idle' ? ` · ${new Date(s.lastSync).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '');
  });
}

export function btn(label, onclick, cls = '') {
  return h('button', { type: 'button', class: `btn ${cls}`, onclick }, label);
}
export function addBtn(label, onclick) {
  return h('button', { type: 'button', class: 'btn primary', onclick }, icon('plus', 18), h('span', {}, label));
}
export function iconBtn(name, onclick, label) {
  return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label || name, title: label || name, onclick }, icon(name, 20));
}

export function card(title, { link, action, cls = '' } = {}, ...kids) {
  return h('section', { class: `card ${cls}` },
    h('div', { class: 'card-head' },
      link ? h('button', { type: 'button', class: 'card-title link', onclick: link }, title, icon('right', 16))
           : h('h2', { class: 'card-title' }, title),
      action || null),
    ...kids);
}

export const empty = text => h('p', { class: 'empty' }, text);

export function seg(options, value, onChange) {
  return h('div', { class: 'seg', role: 'tablist' },
    options.map(([v, label]) => h('button', {
      type: 'button', role: 'tab', class: v === value ? 'on' : '', 'aria-selected': String(v === value),
      onclick: () => onChange(v),
    }, label)));
}

export function dayNav(date, onChange) {
  return h('div', { class: 'daynav' },
    iconBtn('left', () => onChange(addDays(date, -1)), 'Previous day'),
    h('button', { type: 'button', class: 'daynav-label', onclick: () => onChange(ymd()) }, relDay(date)),
    iconBtn('right', () => onChange(addDays(date, 1)), 'Next day'));
}

export function bar(value, max, cls = '') {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  return h('div', { class: `bar ${cls} ${over ? 'over' : ''}` }, h('span', { style: { width: pct + '%' } }));
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/**
 * Open a form in a bottom sheet.
 * fields: [{ name, label, type: text|number|date|time|select|textarea|checkbox|weekdays,
 *            options, suggestions, required, placeholder, step, inputmode, rows, autofocus }]
 */
export function openForm({ title, fields, values = {}, submitLabel = 'Save', onSubmit, onDelete, deleteLabel = 'Delete' }) {
  const dlg = h('dialog', { class: 'sheet' });
  const inputs = {};
  const body = h('div', { class: 'sheet-body' });

  for (const f of fields) {
    const v = values[f.name] ?? f.default ?? '';
    let input;
    let listEl = null;

    if (f.type === 'select') {
      input = h('select', { name: f.name },
        f.options.map(o => { const [val, label] = Array.isArray(o) ? o : [o, o]; return h('option', { value: val }, label); }));
      if (v !== '') input.value = v;
    } else if (f.type === 'textarea') {
      input = h('textarea', { name: f.name, rows: f.rows || 4, placeholder: f.placeholder || '' });
      input.value = v;
    } else if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', name: f.name });
      input.checked = !!v;
    } else if (f.type === 'weekdays') {
      const chosen = new Set(Array.isArray(v) ? v : []);
      input = h('div', { class: 'chips' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => {
        const b = h('button', { type: 'button', class: chosen.has(i) ? 'chip on' : 'chip', 'aria-pressed': String(chosen.has(i)) }, l);
        b.addEventListener('click', () => {
          chosen.has(i) ? chosen.delete(i) : chosen.add(i);
          b.classList.toggle('on'); b.setAttribute('aria-pressed', String(chosen.has(i)));
        });
        return b;
      }));
      input.getValue = () => [...chosen].sort();
    } else {
      input = h('input', {
        type: f.type || 'text', name: f.name, placeholder: f.placeholder || '',
        step: f.step, inputmode: f.inputmode, min: f.min, autocomplete: 'off',
      });
      input.value = v;
      if (f.suggestions?.length) {
        const listId = 'dl-' + Math.random().toString(36).slice(2);
        input.setAttribute('list', listId);
        listEl = h('datalist', { id: listId }, f.suggestions.map(s => h('option', { value: s })));
      }
    }
    if (f.required) input.required = true;
    inputs[f.name] = input;

    const wrapTag = f.type === 'weekdays' ? 'div' : 'label';
    body.append(h(wrapTag, { class: f.type === 'checkbox' ? 'field check' : 'field' },
      h('span', { class: 'field-label' }, f.label), input, listEl,
      f.hint ? h('small', { class: 'hint' }, f.hint) : null));
  }

  const form = h('form', {},
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close() }, 'Cancel'),
      h('h2', {}, title),
      h('button', { type: 'submit', class: 'btn primary' }, submitLabel)),
    body,
    onDelete ? h('div', { class: 'sheet-foot' }, h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => { if (confirm('Delete this? This can\'t be undone.')) { onDelete(); dlg.close(); } },
    }, deleteLabel)) : null);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const input = inputs[f.name];
      if (input.getValue) out[f.name] = input.getValue();
      else if (f.type === 'checkbox') out[f.name] = input.checked;
      else if (f.type === 'number') out[f.name] = input.value === '' ? '' : Number(input.value);
      else out[f.name] = typeof input.value === 'string' ? input.value.trim() : input.value;
    }
    if (onSubmit(out) === false) return; // a form can refuse to close
    dlg.close();
  });

  dlg.append(form);
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // tap outside closes
  dlg.addEventListener('close', () => { dlg.remove(); document.dispatchEvent(new Event('sheet-closed')); });
  document.body.append(dlg);
  dlg.showModal();
  const first = fields.find(f => f.autofocus);
  if (first && !values.id) inputs[first.name].focus();
  else document.activeElement?.blur?.();
  return dlg;
}

// ---- repeating schedules (subscriptions, bills, chores, repeating tasks) -------------
export const CYCLES = [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['quarterly', 'Every 3 months'], ['yearly', 'Yearly']];
export const PER_MONTH = { daily: 365 / 12, weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
export const CYCLE_SHORT = { daily: 'day', weekly: 'wk', biweekly: '2 wks', monthly: 'mo', quarterly: '3 mo', yearly: 'yr' };

/** The k-th repeat of a schedule that started on `anchor` (k = 0 is the anchor itself). */
export function nthOccurrence(anchor, cycle, k) {
  switch (cycle) {
    case 'daily': return addDays(anchor, k);
    case 'weekly': return addDays(anchor, 7 * k);
    case 'biweekly': return addDays(anchor, 14 * k);
    case 'quarterly': return addMonths(anchor, 3 * k);
    case 'yearly': return addMonths(anchor, 12 * k);
    default: return addMonths(anchor, k); // monthly
  }
}

/** First repeat on or after `date`. */
export function nextOnOrAfter(anchor, cycle, date) {
  let k = 0, d = anchor;
  while (d < date && k < 5000) { k++; d = nthOccurrence(anchor, cycle, k); }
  return d;
}

/** How many repeats happened between anchor and `until` (inclusive). */
export function countOccurrences(anchor, cycle, until) {
  let k = 0;
  while (k < 5000 && nthOccurrence(anchor, cycle, k) <= until) k++;
  return k;
}

export function fmtMonthYear(s) {
  return parseYmd(s).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Simple bar chart (one series): values [{ label, value, highlight }].
 * Tapping a bar shows its value underneath; the highlighted bar is labeled.
 */
export function barChart(values, { format = v => String(v), caption = '' } = {}) {
  const W = 320, H = 150, top = 22, bottom = 22, gap = 10;
  const max = Math.max(1, ...values.map(v => v.value));
  const bw = (W - gap * (values.length - 1)) / values.length;
  const readout = h('p', { class: 'chart-readout', role: 'status' }, caption);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'barchart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', values.map(v => `${v.label}: ${format(v.value)}`).join(', '));
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  svg.append(el('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, class: 'axis' }));
  values.forEach((v, i) => {
    const x = i * (bw + gap);
    const bh = v.value > 0 ? Math.max(3, (v.value / max) * (H - top - bottom)) : 0;
    const y = H - bottom - bh;
    const g = el('g', { class: 'bar-g' + (v.highlight ? ' hl' : ''), tabindex: '0' });
    g.append(el('title', {}, `${v.label}: ${format(v.value)}`));
    // rounded top, square bottom
    const r = Math.min(4, bw / 2, bh);
    g.append(el('path', { d: `M${x},${H - bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - bottom} Z`, class: 'bar' }));
    g.append(el('rect', { x, y: 0, width: bw, height: H, fill: 'transparent' })); // big tap target
    g.append(el('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'lbl' }, v.label));
    if (v.highlight && v.value > 0) g.append(el('text', { x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'val' }, format(v.value)));
    const show = () => { readout.textContent = `${v.label}: ${format(v.value)}`; };
    g.addEventListener('click', show);
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
    svg.append(g);
  });
  return h('div', { class: 'chart' }, svg, readout);
}
