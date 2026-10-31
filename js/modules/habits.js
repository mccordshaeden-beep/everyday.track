// habits.js — daily habits & health: water, sleep, workouts, vitamins… anything you
// want to count each day. Each day's count is its own record ("hl:<habit>:<date>")
// so two devices logging on different days never overwrite each other.
import * as store from '../store.js';
import { h, pageHead, card, empty, addBtn, btn, iconBtn, openForm, dayNav, bar, ymd, addDays, fmtDay } from '../ui.js';

export const id = 'habits';
export const title = 'Habits';
export const glyph = 'habits';

const COL = 'habits';      // { name, emoji, goal, unit, order }
const LOGS = 'habitlogs';  // { habitId, date, count }
let day = ymd();

const STARTERS = [
  { emoji: '💧', name: 'Water', goal: 8, unit: 'glasses' },
  { emoji: '😴', name: 'Sleep', goal: 8, unit: 'hours' },
  { emoji: '🏃', name: 'Workout', goal: 1, unit: '' },
  { emoji: '💊', name: 'Vitamins', goal: 1, unit: '' },
  { emoji: '📚', name: 'Study', goal: 2, unit: 'hours' },
];

export const habits = () => store.list(COL).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created || '').localeCompare(b.created || ''));
const logId = (hid, d) => `hl:${hid}:${d}`;
export const count = (hid, d) => Number(store.get(logId(hid, d))?.count) || 0;
const setCount = (hid, d, n) => store.save(LOGS, { habitId: hid, date: d, count: Math.max(0, n) }, logId(hid, d));

function streak(hb) {
  const goal = Number(hb.goal) || 1;
  let d = ymd();
  if (count(hb.id, d) < goal) d = addDays(d, -1); // today isn't over yet
  let n = 0;
  while (n < 366 && count(hb.id, d) >= goal) { n++; d = addDays(d, -1); }
  return n;
}

function editHabit(hb) {
  openForm({
    title: hb ? hb.name : 'New habit',
    values: hb || { goal: 1, emoji: '✅' },
    fields: [
      { name: 'name', label: 'Habit', required: true, autofocus: true, placeholder: 'Water, sleep, stretch…' },
      { name: 'emoji', label: 'Emoji', placeholder: '💧' },
      { name: 'goal', label: 'Daily goal', type: 'number', min: '1', step: '1', inputmode: 'numeric', required: true },
      { name: 'unit', label: 'Unit (optional)', placeholder: 'glasses, hours, pages…' },
    ],
    onSubmit: v => { store.save(COL, v, hb?.id); },
    onDelete: hb ? () => store.remove(hb.id) : null,
  });
}

export function habitRow(hb, d, { week = false } = {}) {
  const n = count(hb.id, d);
  const goal = Number(hb.goal) || 1;
  const s = streak(hb);
  return h('div', { class: 'row habit' + (n >= goal ? ' met' : '') },
    h('span', { class: 'emoji', 'aria-hidden': 'true' }, hb.emoji || '•'),
    h('div', { class: 'row-main', onclick: () => editHabit(hb) },
      h('div', { class: 'row-title' }, hb.name),
      h('div', { class: 'row-sub' }, `${n} / ${goal}${hb.unit ? ' ' + hb.unit : ''}`, s > 1 ? ` · 🔥 ${s} days` : ''),
      bar(n, goal, 'thin'),
      week ? h('div', { class: 'week' }, Array.from({ length: 7 }, (_, i) => {
        const dd = addDays(d, i - 6);
        return h('span', { class: 'wd' + (count(hb.id, dd) >= goal ? ' on' : ''), title: fmtDay(dd) }, fmtDay(dd, { weekday: 'narrow' }));
      })) : null),
    h('div', { class: 'stepper' },
      iconBtn('minus', () => setCount(hb.id, d, n - 1), `Less ${hb.name}`),
      iconBtn('plus', () => setCount(hb.id, d, n + 1), `More ${hb.name}`)));
}

export function render(root, ctx) {
  root.append(pageHead('Habits', { actions: [addBtn('Habit', () => editHabit(null))] }));
  root.append(dayNav(day, d => { day = d; ctx.rerender(); }));
  const list = habits();
  if (list.length) {
    root.append(card(day === ymd() ? 'Today' : fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' }), {},
      list.map(hb => habitRow(hb, day, { week: true }))));
  }
  const have = new Set(list.map(x => x.name.toLowerCase()));
  const ideas = STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  if (ideas.length && list.length < 6) {
    root.append(card(list.length ? 'Ideas' : 'Start with a few', {},
      h('p', { class: 'muted' }, 'Tap to add. You can change the goals any time.'),
      h('div', { class: 'chip-row' }, ideas.map(s => btn(`${s.emoji} ${s.name}`, () => store.save(COL, { ...s, order: list.length }), 'chip-btn')))));
  }
}
