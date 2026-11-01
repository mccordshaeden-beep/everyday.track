// chores.js — the Cleaning tab.
//
// Every chore has a real due date. It repeats every N days, can be pinned to a weekday
// ("Bathroom every Saturday"), and can be moved or snoozed to any date. Checking it off
// schedules the next one. The screen shows:
//   • a "home freshness" score (how on top of things you are right now), streak and points
//   • a Mon–Sun week strip with what's due each day
//   • rooms, each with its own freshness bar
//   • ⚡ Quick clean: "I have 15 minutes", which picks the most important chores that fit
//   • roommates: a shared household list, chores assigned to someone or taking turns
//   • checklists inside a chore, seasonal deep-clean ideas, and badges
import * as store from '../store.js';
import { getStatus, households, createHousehold, joinHousehold, leaveHousehold, newInviteCode } from '../sync.js';
import {
  h, pageHead, card, empty, addBtn, btn, iconBtn, icon, openForm, openSheet, toast,
  ymd, addDays, daysBetween, relDay, parseYmd, fmtDay,
} from '../ui.js';

export const id = 'chores';
export const title = 'Cleaning';
export const glyph = 'clean';

const COL = 'chores'; // { name, room, every (days), day (0–6 or ''), minutes, startOn, due (moved date), lastDone, history: [dates],
                      //   steps (text, one per line), stepState: { cycle, done: [i] }, deep, assignee (user id), rotate, by: { date: user id }, count }
const STATS_ID = 'settings:chorestats'; // { quick, clearWeeks: [monday dates], unlocked: { badge: date } }
const EVERY = [['1', 'Every day'], ['2', 'Every 2 days'], ['3', 'Twice a week'], ['7', 'Every week'], ['14', 'Every 2 weeks'], ['30', 'Every month'], ['90', 'Every 3 months'], ['182', 'Every 6 months'], ['365', 'Every year']];
const EVERY_LABEL = Object.fromEntries(EVERY);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ROOMS = {
  Kitchen: { emoji: '🍳', color: 'orange' },
  Bathroom: { emoji: '🛁', color: 'blue' },
  Bedroom: { emoji: '🛏️', color: 'purple' },
  'Living room': { emoji: '🛋️', color: 'teal' },
  Laundry: { emoji: '🧺', color: 'pink' },
  'Whole place': { emoji: '🏠', color: 'green' },
  Outside: { emoji: '🌿', color: 'lime' },
  Car: { emoji: '🚗', color: 'gray' },
};
const roomOf = c => ROOMS[c.room] || { emoji: '🧽', color: 'gray' };

const STARTERS = [
  { name: 'Clean bathroom (toilet, sink, mirror)', room: 'Bathroom', every: 7, minutes: 20, steps: 'Spray & scrub toilet\nWipe sink & counter\nClean mirror\nWipe faucet & handles\nEmpty trash\nQuick floor sweep' },
  { name: 'Shower & tub scrub', room: 'Bathroom', every: 14, minutes: 20, steps: 'Spray tub/shower walls\nScrub & rinse\nClean drain\nWash shower mat' },
  { name: 'Wipe kitchen counters & stove', room: 'Kitchen', every: 3, minutes: 10, steps: 'Clear clutter off counters\nWipe counters\nWipe stove top\nScrub the sink' },
  { name: 'Take out trash & recycling', room: 'Kitchen', every: 3, minutes: 5 },
  { name: 'Run & empty the dishwasher', room: 'Kitchen', every: 2, minutes: 10 },
  { name: 'Clean out fridge', room: 'Kitchen', every: 30, minutes: 20 },
  { name: 'Clean microwave & oven', room: 'Kitchen', every: 30, minutes: 20 },
  { name: 'Laundry', room: 'Laundry', every: 7, minutes: 15 },
  { name: 'Wash towels', room: 'Laundry', every: 7, minutes: 10 },
  { name: 'Change bed sheets', room: 'Bedroom', every: 14, minutes: 15 },
  { name: 'Tidy desk & nightstand', room: 'Bedroom', every: 7, minutes: 10 },
  { name: 'Vacuum / sweep floors', room: 'Whole place', every: 7, minutes: 20, steps: 'Pick up stuff off the floor\nBedroom\nLiving room\nKitchen\nBathroom\nEmpty the vacuum' },
  { name: 'Mop floors', room: 'Whole place', every: 14, minutes: 25 },
  { name: 'Dust surfaces', room: 'Whole place', every: 14, minutes: 15 },
  { name: 'Tidy the couch & coffee table', room: 'Living room', every: 3, minutes: 5 },
  { name: 'Clean out the car', room: 'Car', every: 30, minutes: 20 },
];

// Deep cleans: a few times a year. `season` puts them first at the right time of year.
const DEEP = [
  { name: 'Clean the oven', room: 'Kitchen', every: 182, minutes: 45, season: 'fall', steps: 'Remove racks & soak\nApply oven cleaner or baking soda paste\nWait (or overnight)\nWipe out & rinse\nScrub racks & put back' },
  { name: 'Clean behind & under the fridge', room: 'Kitchen', every: 365, minutes: 30, season: 'spring' },
  { name: 'Wipe cabinet fronts & handles', room: 'Kitchen', every: 90, minutes: 20 },
  { name: 'Descale shower head & faucets', room: 'Bathroom', every: 90, minutes: 15 },
  { name: 'Wash windows & screens', room: 'Whole place', every: 182, minutes: 45, season: 'spring' },
  { name: 'Wipe baseboards & door frames', room: 'Whole place', every: 90, minutes: 30 },
  { name: 'Clean ceiling fans & light fixtures', room: 'Whole place', every: 90, minutes: 20, season: 'summer' },
  { name: 'Replace air filter', room: 'Whole place', every: 90, minutes: 5, season: 'fall' },
  { name: 'Vacuum under furniture & cushions', room: 'Living room', every: 90, minutes: 25 },
  { name: 'Flip / rotate mattress', room: 'Bedroom', every: 182, minutes: 10 },
  { name: 'Wash pillows & comforter', room: 'Bedroom', every: 182, minutes: 20, season: 'fall' },
  { name: 'Declutter closet & donate', room: 'Bedroom', every: 182, minutes: 60, season: 'spring', steps: 'Pull out what you haven\'t worn in a year\nBag for donation\nFold & organize the rest\nDrop off donations' },
  { name: 'Deep clean the car (inside)', room: 'Car', every: 90, minutes: 45, steps: 'Trash out\nVacuum seats & floors\nWipe dash & doors\nClean windows inside' },
];
const SEASON = () => { const m = new Date().getMonth(); return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'fall'; };
const SEASON_LABEL = { winter: '❄️ Winter', spring: '🌸 Spring', summer: '☀️ Summer', fall: '🍂 Fall' };

let selected = ymd();
let who = 'all'; // 'all' | 'mine' (when you're in a household)
let roomFilter = '';
let rr = () => {};

export const chores = () => store.list(COL);

// ---- household ----------------------------------------------------------------------------
const me = () => getStatus().user?.id || '';
const household = () => (getStatus().user ? households().find(g => g.kind !== 'pair') : null) || null;
const members = () => household()?.members || [];
const nameOf = uid => (uid === me() ? 'You' : members().find(m => m.id === uid)?.name || 'Someone');
const isShared = c => !!store.householdOf(c.id);
/** Chores that are yours to do: private ones, unassigned shared ones, and ones assigned to you. */
/** Whose turn it is for a "take turns" chore: the next roommate after whoever did it last. */
function turnOf(c) {
  const ids = members().map(m => m.id);
  if (!ids.length) return me();
  const last = c.lastDone && c.by ? c.by[c.lastDone] : '';
  if (!last) return ids.includes(c.firstTurn) ? c.firstTurn : ids[0];
  if (c.lastDone === ymd()) return last; // show who did it today until tomorrow
  const i = ids.indexOf(last);
  return ids[(i + 1) % ids.length];
}
const assigneeOf = c => (c.rotate ? turnOf(c) : c.assignee || '');
const isMine = c => !isShared(c) || !assigneeOf(c) || assigneeOf(c) === me();
export const myChores = () => chores().filter(isMine);
const myDates = c => (c.history || []).filter(d => !isShared(c) || !c.by || !c.by[d] || c.by[d] === me());
function nextAfter(uid) {
  const ids = members().map(m => m.id);
  return ids.length ? ids[(ids.indexOf(uid) + 1) % ids.length] : uid;
}

// ---- dates ---------------------------------------------------------------------------------
/** Next weekday `wd` (0–6) on or after date d. */
function onOrAfterWeekday(d, wd) {
  const diff = (Number(wd) - parseYmd(d).getDay() + 7) % 7;
  return addDays(d, diff);
}

/** The date this chore is due next. */
export function dueDate(c) {
  const every = Number(c.every) || 7;
  if (c.due && (!c.lastDone || c.due > c.lastDone)) return c.due; // you moved or snoozed it
  if (!c.lastDone) return c.startOn || (c.created || ymd()).slice(0, 10);
  const base = addDays(c.lastDone, every);
  if (c.day === '' || c.day == null || every < 7) return base;
  // pinned to a weekday: the nearest one around the normal date, never before the day after you did it
  let d = onOrAfterWeekday(addDays(base, -3), c.day);
  if (d <= c.lastDone) d = addDays(d, 7);
  return d;
}

function weekOf(d = ymd()) {
  const day = parseYmd(d).getDay();
  const start = addDays(d, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

// ---- scores -----------------------------------------------------------------------------------
/** 0–100: 100 when not overdue, dropping as it gets overdue (0 once it's a full cycle late). */
function freshness(c, today = ymd()) {
  const late = daysBetween(dueDate(c), today);
  if (late <= 0 || c.lastDone === today) return 100;
  return Math.max(0, Math.round(100 * (1 - late / Math.max(Number(c.every) || 7, 2))));
}
const avg = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 100);
export const homeScore = (list = chores()) => avg(list.map(c => freshness(c)));
const mood = n => n >= 90 ? ['✨', 'Sparkling'] : n >= 70 ? ['😊', 'Pretty clean'] : n >= 45 ? ['🙂', 'Getting messy'] : ['😬', 'Needs some love'];

/** Days in a row (ending today or yesterday) with at least one chore done. */
function streak(list = chores()) {
  const done = new Set(list.flatMap(myDates));
  let d = done.has(ymd()) ? ymd() : addDays(ymd(), -1);
  let n = 0;
  while (done.has(d) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
const pointsThisWeek = (list = chores()) => {
  const { start, end } = weekOf();
  return list.reduce((s, c) => s + myDates(c).filter(d => d >= start && d <= end).length * (10 + Math.min(20, Number(c.minutes) || 10)), 0);
};

/** "4 of 7 done this week" — counts chores due this week plus ones finished this week. */
export function weekProgress() {
  const { start, end } = weekOf();
  const list = myChores();
  const doneThisWeek = list.filter(c => (c.history || []).some(d => d >= start && d <= end));
  const stillDue = list.filter(c => dueDate(c) <= end && !doneThisWeek.includes(c));
  return { done: doneThisWeek.length, total: doneThisWeek.length + stillDue.length };
}

// ---- actions -------------------------------------------------------------------------------------
export function markDone(c) {
  const today = ymd();
  const history = [today, ...(c.history || []).filter(d => d !== today)].slice(0, 400);
  const patch = { lastDone: today, history, due: '', count: (c.count || (c.history || []).length) + 1, stepState: null };
  if (isShared(c)) {
    patch.by = { ...(c.by || {}), [today]: me() };
  }
  store.save(COL, patch, c.id);
  const nextTurn = c.rotate && isShared(c) ? nextAfter(me()) : '';
  if (nextTurn && nextTurn !== me()) toast(`Nice! Next time it's ${nameOf(nextTurn)}'s turn 🔄`);
  recordWeek();
  checkBadges({ ...c, ...patch });
  const next = dueDate({ ...c, lastDone: today, due: '' });
  if (nextTurn && nextTurn !== me()) return;
  const left = myChores().filter(x => x.id !== c.id && dueDate(x) <= today && x.lastDone !== today).length;
  if (!left) { celebrate(); toast('✨ All done for today! Next: ' + relDay(next)); }
  else toast(`Nice! +${10 + Math.min(20, Number(c.minutes) || 10)} points · next ${relDay(next)}`);
}

function undoDone(c) {
  const history = (c.history || []).slice(1);
  const by = { ...(c.by || {}) }; delete by[ymd()];
  store.save(COL, { lastDone: history[0] || '', history, by, count: Math.max(0, (c.count || 1) - 1) }, c.id);
}

// ---- checklists ------------------------------------------------------------------------------
const stepList = c => String(c.steps || '').split('\n').map(x => x.trim()).filter(Boolean);
const stepsDone = c => (c.stepState && c.stepState.cycle === dueDate(c) ? c.stepState.done || [] : []);
function toggleStep(c, i) {
  const done = new Set(stepsDone(c));
  done.has(i) ? done.delete(i) : done.add(i);
  const stepState = { cycle: dueDate(c), done: [...done] };
  store.save(COL, { stepState }, c.id);
  return { ...c, stepState };
}

const snooze = (c, days = 1) => { const d = addDays(dueDate(c) < ymd() ? ymd() : dueDate(c), days); store.save(COL, { due: d }, c.id); toast(`Moved to ${relDay(d)}`); };

function moveTo(c) {
  openForm({
    title: `Move "${c.name}"`,
    values: { due: dueDate(c) < ymd() ? ymd() : dueDate(c) },
    fields: [{ name: 'due', label: 'Do it on', type: 'date', required: true, hint: 'After you do it, it goes back to its normal schedule.' }],
    onSubmit: v => { store.save(COL, { due: v.due }, c.id); toast(`Moved to ${relDay(v.due)}`); },
  });
}

function choreMenu(c) {
  const r = roomOf(c);
  const due = dueDate(c);
  openSheet({
    title: c.name,
    body: [
      h('div', { class: `chore-hero room-${r.color}` }, h('span', { class: 'chore-hero-emoji' }, r.emoji),
        h('div', {}, h('b', {}, c.room || 'Anywhere'), h('div', { class: 'muted small' }, scheduleText(c)))),
      stepList(c).length && c.lastDone !== ymd() ? checklist(c) : null,
      h('dl', { class: 'facts' },
        isShared(c) ? [h('dt', {}, 'Who'), h('dd', {}, whoText(c))] : null,
        h('dt', {}, 'Next due'), h('dd', {}, fmtDay(due, { weekday: 'long', month: 'short', day: 'numeric' })),
        h('dt', {}, 'Last done'), h('dd', {}, c.lastDone ? relDay(c.lastDone) + (isShared(c) && c.by?.[c.lastDone] ? ` by ${nameOf(c.by[c.lastDone])}` : '') : 'Not yet'),
        h('dt', {}, 'Takes about'), h('dd', {}, `${Number(c.minutes) || 10} min`),
        h('dt', {}, 'Done in the last 30 days'), h('dd', {}, String((c.history || []).filter(d => d >= addDays(ymd(), -30)).length))),
    ],
    actions: [
      c.lastDone === ymd() ? { label: 'Undo today', onClick: () => undoDone(c) } : { label: '✓ Done', cls: 'primary', onClick: () => markDone(c) },
      { label: 'Tomorrow', onClick: () => snooze(c, 1) },
      { label: 'Pick a date', onClick: () => moveTo(c) },
      { label: 'Edit', onClick: () => editChore(c) },
    ],
  });
}

function checklist(c) {
  let cur = c;
  const steps = stepList(c);
  const wrap = h('div', { class: 'checklist' }, h('p', { class: 'field-label' }, 'Checklist'));
  steps.forEach((label, i) => {
    const on = stepsDone(c).includes(i);
    const b = h('button', { type: 'button', class: 'step' + (on ? ' on' : ''), onclick: () => {
      cur = toggleStep(cur, i);
      b.classList.toggle('on');
      if (stepsDone(cur).length === steps.length) { wrap.closest('dialog')?.close(); markDone(cur); }
    } }, h('span', { class: 'step-box' }), label);
    wrap.append(b);
  });
  return wrap;
}

function whoText(c) {
  if (c.rotate) return `🔄 Taking turns · ${c.lastDone === ymd() ? `done by ${nameOf(turnOf(c))} today` : `${nameOf(turnOf(c))}'s turn`}`;
  if (c.assignee) return `👤 ${nameOf(c.assignee)}`;
  return '👥 Anyone';
}

function scheduleText(c) {
  const every = Number(c.every) || 7;
  const base = (EVERY_LABEL[String(every)] || `Every ${every} days`);
  return c.day !== '' && c.day != null && every >= 7 ? `${base} on ${WEEKDAYS[c.day]}s` : base;
}

function editChore(c, defaults = {}) {
  const hh = household();
  const shared = c ? isShared(c) : !!hh;
  const whoVal = c?.rotate ? 'rotate' : c?.assignee || '';
  openForm({
    title: c ? 'Edit chore' : 'New chore',
    values: c ? { ...c, every: String(c.every), day: c.day ?? '', minutes: c.minutes || 10, startOn: dueDate(c), steps: c.steps || '', shared, who: whoVal }
      : { every: '7', day: '', minutes: 15, startOn: ymd(), shared, who: '', ...defaults },
    fields: [
      { name: 'name', label: 'Chore', required: true, autofocus: true, placeholder: 'Clean bathroom, vacuum…' },
      { name: 'room', label: 'Room', type: 'select', options: [['', 'Anywhere'], ...Object.entries(ROOMS).map(([n, r]) => [n, `${r.emoji} ${n}`])] },
      { name: 'every', label: 'How often', type: 'select', options: EVERY },
      { name: 'day', label: 'On a certain day? (weekly or less often)', type: 'select', options: [['', 'Any day'], ...WEEKDAYS.map((d, i) => [String(i), d + 's'])] },
      { name: 'startOn', label: c ? 'Next due date' : 'First due date', type: 'date', required: true },
      { name: 'minutes', label: 'About how many minutes?', type: 'number', min: '1', step: '1', inputmode: 'numeric', hint: 'Used by ⚡ Quick clean' },
      { name: 'steps', label: 'Checklist (optional, one step per line)', type: 'textarea', rows: 4, placeholder: 'Scrub toilet\nWipe sink\nClean mirror' },
      ...(hh ? [
        { name: 'shared', label: `Share with ${hh.name}`, type: 'checkbox' },
        { name: 'who', label: 'Who does it? (shared chores)', type: 'select', options: [['', '👥 Anyone'], ['rotate', '🔄 Take turns'], ...members().map(m => [m.id, `👤 ${m.id === me() ? 'Me' : m.name}`])] },
      ] : []),
    ],
    onSubmit: v => {
      const { shared: share, who: w, ...rest } = v;
      const fields = { ...rest, every: Number(v.every), day: v.day === '' ? '' : Number(v.day), minutes: Number(v.minutes) || 10 };
      if (hh) { fields.rotate = w === 'rotate'; fields.assignee = w === 'rotate' ? '' : w; if (w === 'rotate' && !c?.firstTurn) fields.firstTurn = me(); }
      if (c) { fields.due = v.startOn; delete fields.startOn; }
      const wantHH = hh && share ? hh.id : '';
      if (c && wantHH !== store.householdOf(c.id)) {
        // moving between private and shared: make a fresh copy in the new place
        const { id: _i, ...old } = c;
        store.save(COL, { ...old, ...fields }, undefined, { hh: wantHH });
        store.remove(c.id);
        toast(wantHH ? `Shared with ${hh.name}` : 'Made private');
        return;
      }
      store.save(COL, fields, c?.id, c ? {} : { hh: wantHH });
    },
    onDelete: c ? () => store.remove(c.id) : null,
  });
}

// ---- quick clean ----------------------------------------------------------------------------
function quickClean() {
  const today = ymd();
  const st = stats();
  store.save('settings', { quick: (st.quick || 0) + 1 }, STATS_ID);
  checkBadges();
  const pick = mins => {
    // most overdue first, then due soonest; fill up the time
    const list = myChores().filter(c => c.lastDone !== today && dueDate(c) <= addDays(today, 3))
      .sort((a, b) => freshness(a) - freshness(b) || dueDate(a).localeCompare(dueDate(b)));
    const out = []; let total = 0;
    for (const c of list) { const m = Number(c.minutes) || 10; if (total + m <= mins) { out.push(c); total += m; } }
    return { out, total };
  };
  const body = h('div', { class: 'stack' });
  const show = mins => {
    const { out, total } = pick(mins);
    body.replaceChildren(
      h('p', { class: 'muted' }, out.length ? `Here's ${total} minutes of the most important stuff. Put on some music. 🎵` : 'Nothing urgent fits. You\'re in good shape! ✨'),
      ...out.map(c => {
        const r = roomOf(c);
        const row = h('div', { class: 'row' },
          h('button', { type: 'button', class: 'check', 'aria-label': 'Done', onclick: e => { markDone(c); e.currentTarget.classList.add('on'); row.classList.add('done'); } }),
          h('span', { class: `room-dot room-${r.color}` }, r.emoji),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-sub' }, `${Number(c.minutes) || 10} min`)));
        return row;
      }));
  };
  const timeBtns = h('div', { class: 'seg' }, [10, 15, 30, 60].map(m => {
    const b = h('button', { type: 'button', onclick: () => { timeBtns.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); show(m); } }, m < 60 ? `${m} min` : '1 hour');
    if (m === 15) b.classList.add('on');
    return b;
  }));
  show(15);
  openSheet({ title: '⚡ Quick clean', body: [h('p', { class: 'field-label' }, 'How much time do you have?'), timeBtns, body], actions: [{ label: 'Done', cls: 'primary' }] });
}


// ---- badges ----------------------------------------------------------------------------------
const stats = () => store.get(STATS_ID) || {};
function recordWeek() {
  const p = weekProgress();
  if (!p.total || p.done < p.total) return;
  const { start } = weekOf();
  const st = stats();
  if (!(st.clearWeeks || []).includes(start)) store.save('settings', { clearWeeks: [...(st.clearWeeks || []), start].slice(-200) }, STATS_ID);
}
function bestStreak(list = chores()) {
  const dates = [...new Set(list.flatMap(myDates))].sort();
  let best = 0, run = 0, prev = '';
  for (const d of dates) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
const totalDone = (list = chores()) => list.reduce((s, c) => s + myDates(c).length, 0);
function roomsThisWeek(list = chores()) {
  const { start, end } = weekOf();
  return new Set(list.filter(c => c.room && myDates(c).some(d => d >= start && d <= end)).map(c => c.room)).size;
}
const BADGES = [
  { id: 'first', emoji: '🧽', name: 'First scrub', how: 'Finish your first chore', test: () => totalDone() >= 1, progress: () => `${Math.min(1, totalDone())}/1` },
  { id: 'streak7', emoji: '🔥', name: 'On a roll', how: 'Clean 7 days in a row', test: () => bestStreak() >= 7, progress: () => `${Math.min(7, bestStreak())}/7 days` },
  { id: 'streak30', emoji: '🌟', name: 'Unstoppable', how: 'Clean 30 days in a row', test: () => bestStreak() >= 30, progress: () => `${Math.min(30, bestStreak())}/30 days` },
  { id: 'week1', emoji: '✅', name: 'Clean week', how: 'Finish everything due in a week', test: () => (stats().clearWeeks || []).length >= 1, progress: () => `${Math.min(1, (stats().clearWeeks || []).length)}/1` },
  { id: 'week4', emoji: '🏆', name: 'Month of clean', how: 'Have 4 clean weeks', test: () => (stats().clearWeeks || []).length >= 4, progress: () => `${Math.min(4, (stats().clearWeeks || []).length)}/4 weeks` },
  { id: 'rooms', emoji: '🌈', name: 'Every corner', how: 'Clean 5 different rooms in one week', test: () => roomsThisWeek() >= 5, progress: () => `${Math.min(5, roomsThisWeek())}/5 rooms this week` },
  { id: 'hundred', emoji: '💯', name: 'Century', how: 'Finish 100 chores', test: () => totalDone() >= 100, progress: () => `${Math.min(100, totalDone())}/100` },
  { id: 'quick', emoji: '⚡', name: 'Speed cleaner', how: 'Use Quick clean 5 times', test: () => (stats().quick || 0) >= 5, progress: () => `${Math.min(5, stats().quick || 0)}/5` },
  { id: 'deep', emoji: '🫧', name: 'Deep cleaner', how: 'Finish a deep clean', test: () => chores().some(c => c.deep && myDates(c).length), progress: () => '0/1' },
  { id: 'team', emoji: '🤝', name: 'Team player', how: 'Finish a chore shared with roommates', test: () => chores().some(c => isShared(c) && myDates(c).length), progress: () => '0/1' },
];
function checkBadges() {
  const st = stats();
  const unlocked = { ...(st.unlocked || {}) };
  const fresh = BADGES.filter(b => !unlocked[b.id] && b.test());
  if (!fresh.length) return;
  for (const b of fresh) unlocked[b.id] = ymd();
  store.save('settings', { unlocked }, STATS_ID);
  setTimeout(() => { celebrate(); toast(`🏅 New badge: ${fresh.map(b => `${b.emoji} ${b.name}`).join(', ')}`); }, 900);
}
function badgeShelf() {
  const unlocked = stats().unlocked || {};
  const n = BADGES.filter(b => unlocked[b.id]).length;
  return card(`Badges · ${n}/${BADGES.length}`, {}, h('div', { class: 'badges' }, BADGES.map(b => {
    const got = unlocked[b.id];
    return h('button', { type: 'button', class: 'badge' + (got ? ' got' : ''), onclick: () => toast(got ? `${b.emoji} ${b.name}: earned ${relDay(got)}` : `${b.how} (${b.progress()})`) },
      h('span', { class: 'badge-emoji' }, got ? b.emoji : '🔒'), h('span', { class: 'badge-name' }, b.name));
  })));
}

// ---- roommates (household) -------------------------------------------------------------------
function householdCard() {
  const s = getStatus();
  if (!s.configured) return null;
  if (!s.user) return card('👥 Clean with roommates', {}, h('p', { class: 'muted' }, 'Sign in to share a cleaning list with your roommates.'));
  const hh = household();
  if (!hh) {
    return card('👥 Clean with roommates', { cls: 'hh-card' },
      h('p', { class: 'muted' }, 'Share chores with the people you live with. Assign chores to someone or take turns automatically, and everyone sees what\'s done. Your other trackers stay private.'),
      h('div', { class: 'btn-row' },
        btn('Create a household', () => openForm({
          title: 'Create a household',
          fields: [
            { name: 'name', label: 'Household name', required: true, autofocus: true, placeholder: 'Our apartment, Unit 12B…' },
            { name: 'me', label: 'Your name (what roommates see)', required: true },
          ],
          submitLabel: 'Create',
          onSubmit: v => { createHousehold(v.name, v.me).then(() => { toast('Household created. Share the invite code!'); rr(); }).catch(e => toast(e.message)); },
        }), 'primary'),
        btn('Join with a code', () => openForm({
          title: 'Join a household',
          fields: [
            { name: 'code', label: 'Invite code', required: true, autofocus: true, placeholder: 'e.g. 7KQM2-XDFA9', hint: 'Ask whoever made the household for it.' },
            { name: 'me', label: 'Your name (what roommates see)', required: true },
          ],
          submitLabel: 'Join',
          onSubmit: v => { joinHousehold(v.code, v.me).then(() => { toast('Joined! Shared chores will appear in a moment.'); rr(); }).catch(e => toast(e.message)); },
        }), 'ghost')));
  }
  const code = hh.invite_code.replace(/(.{5})(.{5})/, '$1-$2');
  const isOwner = hh.created_by === s.user.id;
  const invite = `Join our cleaning list "${hh.name}" in Everyday: ${location.origin}${location.pathname} → Cleaning → Join with a code → ${code}`;
  return card(`👥 ${hh.name}`, { cls: 'hh-card' },
    h('div', { class: 'chip-row' }, members().map(m => h('span', { class: 'member' }, h('span', { class: 'avatar' }, m.name.charAt(0).toUpperCase()), m.id === s.user.id ? `${m.name} (you)` : m.name))),
    h('p', { class: 'field-label', style: { marginTop: '12px' } }, 'Invite code'),
    h('div', { class: 'invite' }, h('code', {}, code),
      btn('Share', async () => {
        try { if (navigator.share) await navigator.share({ title: 'Join our household', text: invite }); else { await navigator.clipboard.writeText(invite); toast('Invite copied'); } }
        catch { /* cancelled */ }
      }, 'ghost sm')),
    h('p', { class: 'hint' }, 'New chores are shared automatically. Edit a chore to choose who does it or to make it private.'),
    h('div', { class: 'btn-row' },
      isOwner ? btn('New code', () => { if (confirm('Make a new invite code? The old one stops working.')) newInviteCode(hh.id).then(() => rr()).catch(e => toast(e.message)); }, 'ghost sm') : null,
      btn('Leave household', () => {
        if (confirm(`Leave "${hh.name}"? Shared chores will disappear from your app (your roommates keep them).`)) leaveHousehold(hh.id).then(() => { toast('Left household'); rr(); }).catch(e => toast(e.message));
      }, 'ghost sm')));
}

// ---- deep clean ideas -------------------------------------------------------------------------
function deepCard(list) {
  const have = new Set(list.map(c => c.name.toLowerCase()));
  const ideas = DEEP.filter(d => !have.has(d.name.toLowerCase()));
  if (!ideas.length) return null;
  const season = SEASON();
  const now = ideas.filter(d => d.season === season);
  const rest = ideas.filter(d => d.season !== season);
  const chip = d => btn(`${ROOMS[d.room]?.emoji || ''} ${d.name} · ${(EVERY_LABEL[String(d.every)] || '').toLowerCase()}`, () => {
    store.save(COL, { ...d, deep: true, day: '', startOn: addDays(ymd(), 2 + (chores().length % 5)) }, undefined, { hh: household()?.id || '' });
    toast(`Added "${d.name}"`);
  }, 'chip-btn');
  return card(`${SEASON_LABEL[season]} deep clean`, { cls: 'deep-card' },
    h('p', { class: 'muted' }, 'Bigger jobs to do a few times a year. Tap to add them to your schedule.'),
    now.length ? h('div', { class: 'chip-row' }, now.map(chip)) : null,
    rest.length ? h('details', { class: 'more-ideas' }, h('summary', {}, `More deep cleans (${rest.length})`), h('div', { class: 'chip-row' }, rest.map(chip))) : null);
}

// ---- celebrate --------------------------------------------------------------------------------
function celebrate() {
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  const bits = ['✨', '🫧', '🧼', '⭐', '🎉', '💫'];
  for (let i = 0; i < 26; i++) {
    layer.append(h('span', { style: { left: Math.random() * 100 + '%', animationDelay: Math.random() * 0.4 + 's', fontSize: 16 + Math.random() * 16 + 'px' } }, bits[i % bits.length]));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2200);
}

// ---- rows & pieces ----------------------------------------------------------------------------------
function dueLabel(c) {
  const today = ymd();
  if (c.lastDone === today) return ['Done today ✓', 'tag ok-tag'];
  const due = dueDate(c);
  const days = daysBetween(today, due);
  if (days < 0) return [`${-days} day${days === -1 ? '' : 's'} late · was ${fmtDay(due, { month: 'short', day: 'numeric' })}`, 'tag red'];
  if (days === 0) return ['Due today', 'tag due-today'];
  return [`Due ${fmtDay(due, { weekday: 'short', month: 'short', day: 'numeric' })}`, 'tag'];
}

export function choreRow(c) {
  const today = ymd();
  const doneToday = c.lastDone === today;
  const r = roomOf(c);
  const [label, cls] = dueLabel(c);
  return h('div', { class: 'row chore-row' + (doneToday ? ' done' : '') },
    h('button', {
      type: 'button', class: 'check' + (doneToday ? ' on' : ''), 'aria-label': doneToday ? 'Undo' : `Mark ${c.name} done`,
      onclick: () => (doneToday ? undoDone(c) : markDone(c)),
    }),
    h('span', { class: `room-dot room-${r.color}`, title: c.room || '' }, r.emoji),
    h('div', { class: 'row-main', onclick: () => choreMenu(c) },
      h('div', { class: 'row-title' }, c.name),
      h('div', { class: 'row-meta' },
        h('span', { class: cls }, label),
        isShared(c) ? h('span', { class: 'tag who' + (assigneeOf(c) === me() ? ' mine' : '') },
          c.rotate ? `🔄 ${nameOf(turnOf(c))}` : c.assignee ? `👤 ${nameOf(c.assignee)}` : '👥 Anyone') : null,
        c.deep ? h('span', { class: 'tag deep' }, 'Deep clean') : null,
        stepList(c).length && !doneToday ? h('span', { class: 'tag' }, `☑ ${stepsDone(c).length}/${stepList(c).length}`) : null,
        h('span', { class: 'row-sub' }, `↻ ${scheduleText(c).replace(/^Every /, '').replace(/^\w/, ch => ch.toLowerCase())} · ${Number(c.minutes) || 10} min`))),
    !doneToday ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Snooze ${c.name} to tomorrow`, title: 'Tomorrow', onclick: () => snooze(c, 1) }, '💤') : null);
}

function ring(score) {
  const r = 34, C = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 84 84'); svg.setAttribute('class', 'ring'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle cx="42" cy="42" r="${r}" class="ring-bg"/><circle cx="42" cy="42" r="${r}" class="ring-fg ${score < 45 ? 'low' : score < 70 ? 'mid' : ''}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - score / 100)}"/>`;
  return h('div', { class: 'ring-wrap' }, svg, h('div', { class: 'ring-num' }, h('b', {}, score), h('span', {}, '%')));
}

function hero(list) {
  const score = homeScore(list);
  const [emoji, word] = mood(score);
  const p = weekProgress();
  const s = streak(list);
  return h('section', { class: 'card clean-hero' },
    ring(score),
    h('div', { class: 'clean-hero-text' },
      h('p', { class: 'eyebrow' }, 'Home freshness'),
      h('h2', {}, `${emoji} ${word}`),
      h('div', { class: 'clean-stats' },
        h('span', {}, h('b', {}, `${p.done}/${p.total}`), ' this week'),
        h('span', {}, h('b', {}, `🔥 ${s}`), ` day${s === 1 ? '' : 's'}`),
        h('span', {}, h('b', {}, `⭐ ${pointsThisWeek(list)}`), ' pts')),
      h('button', { type: 'button', class: 'btn quick-btn', onclick: quickClean }, '⚡ Quick clean')));
}

function weekStrip(list) {
  const today = ymd();
  const { start } = weekOf(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dueOn = d => list.filter(c => {
    if (c.lastDone === d) return true;
    const due = dueDate(c);
    return d === today ? (due <= today) : due === d;
  });
  return h('div', { class: 'week-strip-wrap' },
    iconBtn('left', () => { selected = addDays(selected, -7); rr(); }, 'Previous week'),
    h('div', { class: 'week-strip' }, days.map(d => {
      const items = dueOn(d);
      const left = items.filter(c => c.lastDone !== d).length;
      const allDone = items.length && !left;
      const cls = ['wday'];
      if (d === selected) cls.push('sel');
      if (d === today) cls.push('today');
      if (d < today) cls.push('past');
      return h('button', { type: 'button', class: cls.join(' '), 'aria-label': `${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${left} to do`, onclick: () => { selected = d; rr(); } },
        h('span', { class: 'wday-name' }, fmtDay(d, { weekday: 'short' })),
        h('span', { class: 'wday-num' }, Number(d.slice(8))),
        h('span', { class: 'wday-dots' }, allDone ? '✓' : left ? '•'.repeat(Math.min(left, 3)) : ''));
    })),
    iconBtn('right', () => { selected = addDays(selected, 7); rr(); }, 'Next week'));
}

function roomsGrid(list) {
  const rooms = Object.keys(ROOMS).filter(n => list.some(c => c.room === n));
  if (list.some(c => !ROOMS[c.room])) rooms.push('');
  if (rooms.length < 2) return null;
  return h('div', {},
    h('div', { class: 'section-head' }, h('h2', { class: 'card-title' }, 'Rooms'), roomFilter !== '' ? btn('Show all', () => { roomFilter = ''; rr(); }, 'ghost sm') : null),
    h('div', { class: 'rooms' }, rooms.map(n => {
      const mine = list.filter(c => (n ? c.room === n : !ROOMS[c.room]));
      const score = avg(mine.map(c => freshness(c)));
      const r = ROOMS[n] || { emoji: '🧽', color: 'gray' };
      const late = mine.filter(c => dueDate(c) < ymd() && c.lastDone !== ymd()).length;
      return h('button', { type: 'button', class: `room-card room-${r.color}${roomFilter === n ? ' sel' : ''}`, onclick: () => { roomFilter = roomFilter === n ? '' : n; rr(); } },
        h('span', { class: 'room-emoji' }, r.emoji),
        h('span', { class: 'room-name' }, n || 'Anywhere'),
        h('span', { class: 'room-bar' }, h('i', { style: { width: score + '%' } })),
        h('span', { class: 'room-sub' }, late ? `${late} late` : `${score}% fresh`));
    })));
}

// ---- screen -------------------------------------------------------------------------------------------
export function render(root, ctx) {
  rr = ctx.rerender;
  const list = chores();
  root.append(pageHead('Cleaning', { actions: [addBtn('Chore', () => editChore(null))] }));

  if (list.length) {
    const today = ymd();
    const hh = household();
    const base = hh && who === 'mine' ? list.filter(isMine) : list;
    const filtered = roomFilter === '' ? base : base.filter(c => (roomFilter ? c.room === roomFilter : !ROOMS[c.room]));
    root.append(hero(list));
    if (hh) root.append(h('div', { class: 'seg' }, [['all', '👥 Everyone'], ['mine', '👤 Just mine']].map(([v, l]) =>
      h('button', { type: 'button', class: who === v ? 'on' : '', onclick: () => { who = v; rr(); } }, l))));
    root.append(weekStrip(base));

    // the selected day: overdue ones show on today
    const forDay = filtered.filter(c => c.lastDone === selected || (selected === today ? dueDate(c) <= today : dueDate(c) === selected && c.lastDone !== selected))
      .sort((a, b) => (a.lastDone === selected) - (b.lastDone === selected) || dueDate(a).localeCompare(dueDate(b)));
    const dayTitle = selected === today ? 'Today' : fmtDay(selected, { weekday: 'long', month: 'short', day: 'numeric' });
    const mins = forDay.filter(c => c.lastDone !== selected).reduce((s, c) => s + (Number(c.minutes) || 10), 0);
    const split = h('div', { class: 'split' });
    split.append(card(dayTitle + (roomFilter !== '' ? ` · ${roomFilter || 'Anywhere'}` : ''), {
      action: mins ? h('span', { class: 'muted small' }, `about ${mins} min`) : null,
      cls: 'day-card',
    }, forDay.length ? forDay.map(choreRow)
      : empty(selected < today ? 'Nothing was due this day.' : selected === today ? '✨ Nothing due today. Enjoy it!' : 'Nothing due this day.')));

    // coming up: the next 14 days, by date
    const upcoming = filtered.filter(c => dueDate(c) > (selected > today ? selected : today) && dueDate(c) <= addDays(today, 14) && c.lastDone !== today)
      .sort((a, b) => dueDate(a).localeCompare(dueDate(b)));
    const dates = [...new Set(upcoming.map(dueDate))];
    split.append(card('Coming up', {}, dates.length ? dates.map(d => [
      h('p', { class: 'eyebrow day-sep' }, fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' })),
      upcoming.filter(c => dueDate(c) === d).map(choreRow),
    ]) : empty('Nothing else in the next two weeks.')));
    root.append(split);

    const rg = roomsGrid(list);
    if (rg) root.append(rg);
    root.append(h('div', { class: 'grid' }, badgeShelf(), householdCard()));
    const dc = deepCard(list);
    if (dc) root.append(dc);
  } else {
    root.append(h('section', { class: 'card clean-empty' },
      h('div', { class: 'clean-empty-emoji' }, '🧼✨'),
      h('h2', {}, 'Let\'s build your cleaning routine'),
      h('p', { class: 'muted' }, 'Tap the chores below that you want to keep up with. Each one gets a due date, repeats on its own, and you can move it to any day.')));
  }

  const have = new Set(list.map(c => c.name.toLowerCase()));
  const ideas = STARTERS.filter(s => !have.has(s.name.toLowerCase()));
  if (ideas.length && list.length < 14) {
    const rooms = [...new Set(ideas.map(s => s.room))];
    root.append(card(list.length ? 'Add more chores' : 'Pick your chores', {},
      rooms.map(rn => h('div', { class: 'starter-room' },
        h('p', { class: 'eyebrow' }, `${ROOMS[rn]?.emoji || ''} ${rn}`),
        h('div', { class: 'chip-row' }, ideas.filter(s => s.room === rn).map(s => btn(`${s.name} · ${(EVERY_LABEL[String(s.every)] || '').toLowerCase()}`,
          // spread new chores over the next few days so they don't all land today
          () => { store.save(COL, { ...s, day: '', startOn: addDays(ymd(), Math.min(chores().length % 4, s.every - 1)) }, undefined, { hh: household()?.id || '' }); toast(`Added "${s.name}"`); }, 'chip-btn'))))),
      h('div', { class: 'btn-row' }, btn('+ Make my own', () => editChore(null), 'ghost sm'))));
  }
  if (!list.length) { const hc = householdCard(); if (hc) root.append(hc); }
}
