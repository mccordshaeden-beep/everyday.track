// today.js — the home screen: everything that matters today, in one place.
import * as store from '../store.js';
import { h, pageHead, card, empty, btn, bar, iconBtn, ymd, relDay, money } from '../ui.js';
import { eventsOn, eventRow } from './calendar.js';
import { taskRow, quickAdd } from './tasks.js';
import { habits, habitRow } from './habits.js';
import { mealsSummary, editLog, groceryCount, setTab as setFoodTab } from './food.js';
import { isOn } from './settings.js';
import { summaryBlock, editTxn, upcomingSubs, billsDueSoon, billRow, setTab as setMoneyTab } from './money.js';
import { choreRow, myChores as chores, dueDate, weekProgress } from './chores.js';
import { upcomingAssignments, editAssignment } from './school.js';

export const id = 'today';
export const title = 'Today';
export const glyph = 'today';

export function render(root, { navigate }) {
  const today = ymd();
  const hr = new Date().getHours();
  const greeting = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  root.append(pageHead(greeting, {
    eyebrow: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    actions: [iconBtn('search', () => navigate('search'), 'Search everything')],
  }));

  const grid = h('div', { class: 'grid' });

  // Schedule
  const evs = eventsOn(today);
  if (isOn('calendar')) grid.append(card('Schedule', { link: () => navigate('calendar') },
    evs.length ? evs.map(eventRow) : empty('Nothing on the calendar today.')));

  // Tasks due today or overdue
  const tasks = store.list('tasks').filter(t => !t.done && t.due && t.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due));
  const doneToday = store.list('tasks').filter(t => t.done && t.doneAt === today).length;
  if (isOn('tasks')) grid.append(card('Tasks', { link: () => navigate('tasks') },
    quickAdd({ key: 'today-task', due: today, placeholder: 'Add a task for today…' }),
    tasks.length ? tasks.map(taskRow) : empty(doneToday ? `All clear. ${doneToday} done today.` : 'Nothing due today.')));

  // School: what's due in the next 7 days (beyond today)
  const soon = upcomingAssignments(7).filter(a => a.due > today);
  if (isOn('school') && soon.length) grid.append(card('School: next 7 days', { link: () => navigate('school') },
    soon.slice(0, 6).map(a => h('div', { class: 'row compact', onclick: () => editAssignment(a) },
      h('div', { class: 'row-main' }, a.title, h('span', { class: 'muted' }, ` · ${a.list || ''}`)),
      h('span', { class: 'tag' }, relDay(a.due))))));

  // Cleaning: due today or overdue
  if (isOn('chores') && chores().length) {
    const due = chores().filter(c => dueDate(c) <= today || c.lastDone === today).sort((a, b) => dueDate(a).localeCompare(dueDate(b)));
    const p = weekProgress();
    grid.append(card('Cleaning', { link: () => navigate('chores'), action: h('span', { class: 'muted small' }, `${p.done}/${p.total} this week`) },
      due.length ? due.map(choreRow) : empty('Nothing to clean today ✨')));
  }

  // Habits
  const hb = habits();
  if (isOn('habits')) grid.append(card('Habits', { link: () => navigate('habits') },
    hb.length ? hb.map(x => habitRow(x, today)) : empty('Set up habits like water, sleep or workouts.')));

  // Food
  const groc = groceryCount();
  if (isOn('food')) grid.append(card('Food', { link: () => navigate('food'), action: btn('+ Log', () => editLog(null, { date: today }), 'ghost sm') },
    mealsSummary(today),
    h('button', { type: 'button', class: 'mini-link', onclick: () => { setFoodTab('groceries'); navigate('food'); } },
      groc ? `🛒 ${groc} item${groc > 1 ? 's' : ''} on your grocery list` : '🛒 Grocery list is empty')));

  // Money
  const renewals = upcomingSubs(7);
  const bills = billsDueSoon(7);
  if (isOn('money')) grid.append(card('Money this month', { link: () => { setMoneyTab('budget'); navigate('money'); }, action: btn('+ Spent', () => editTxn(null), 'ghost sm') },
    summaryBlock(today.slice(0, 7)),
    bills.length ? h('div', { class: 'renewals' }, h('p', { class: 'eyebrow' }, 'Bills due'), bills.map(billRow)) : null,
    renewals.length ? h('div', { class: 'renewals' },
      h('p', { class: 'eyebrow' }, 'Renewing this week'),
      renewals.map(s => h('div', { class: 'row compact' },
        h('div', { class: 'row-main' }, s.name, h('span', { class: 'muted' }, ` · ${relDay(s.next)}`)),
        h('div', { class: 'amt' }, money(s.amount))))) : null));

  root.append(grid.children.length ? grid : empty('Turn on some trackers in Settings to see them here.'));
}
