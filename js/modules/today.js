// today.js — the home screen: everything that matters today, in one place.
import * as store from '../store.js';
import { h, pageHead, card, empty, btn, ymd, relDay, money } from '../ui.js';
import { eventsOn, eventRow } from './calendar.js';
import { taskRow, quickAdd } from './tasks.js';
import { habits, habitRow } from './habits.js';
import { mealsSummary, editLog, groceryCount, setTab as setFoodTab } from './food.js';
import { summaryBlock, editTxn, upcomingSubs, setTab as setMoneyTab } from './money.js';

export const id = 'today';
export const title = 'Today';
export const glyph = 'today';

export function render(root, { navigate }) {
  const today = ymd();
  const hr = new Date().getHours();
  const greeting = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  root.append(pageHead(greeting, {
    eyebrow: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  }));

  const grid = h('div', { class: 'grid' });

  // Schedule
  const evs = eventsOn(today);
  grid.append(card('Schedule', { link: () => navigate('calendar') },
    evs.length ? evs.map(eventRow) : empty('Nothing on the calendar today.')));

  // Tasks due today or overdue
  const tasks = store.list('tasks').filter(t => !t.done && t.due && t.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due));
  const doneToday = store.list('tasks').filter(t => t.done && t.doneAt === today).length;
  grid.append(card('Tasks', { link: () => navigate('tasks') },
    quickAdd({ key: 'today-task', due: today, placeholder: 'Add a task for today…' }),
    tasks.length ? tasks.map(taskRow) : empty(doneToday ? `All clear. ${doneToday} done today.` : 'Nothing due today.')));

  // Habits
  const hb = habits();
  grid.append(card('Habits', { link: () => navigate('habits') },
    hb.length ? hb.map(x => habitRow(x, today)) : empty('Set up habits like water, sleep or workouts.')));

  // Food
  const groc = groceryCount();
  grid.append(card('Food', { link: () => navigate('food'), action: btn('+ Log', () => editLog(null, { date: today }), 'ghost sm') },
    mealsSummary(today),
    h('button', { type: 'button', class: 'mini-link', onclick: () => { setFoodTab('groceries'); navigate('food'); } },
      groc ? `🛒 ${groc} item${groc > 1 ? 's' : ''} on your grocery list` : '🛒 Grocery list is empty')));

  // Money
  const renewals = upcomingSubs(7);
  grid.append(card('Money this month', { link: () => { setMoneyTab('budget'); navigate('money'); }, action: btn('+ Spent', () => editTxn(null), 'ghost sm') },
    summaryBlock(today.slice(0, 7)),
    renewals.length ? h('div', { class: 'renewals' },
      h('p', { class: 'eyebrow' }, 'Renewing this week'),
      renewals.map(s => h('div', { class: 'row compact' },
        h('div', { class: 'row-main' }, s.name, h('span', { class: 'muted' }, ` · ${relDay(s.next)}`)),
        h('div', { class: 'amt' }, money(s.amount))))) : null));

  root.append(grid);
}
