// today.js — the home screen: everything that matters today, in one place.
import * as store from '../store.js';
import { h, pageHead, card, empty, btn, bar, iconBtn, openSheet, toast, ymd, relDay, money } from '../ui.js';
import { eventsOn, eventRow, setTab as setCalTab } from './calendar.js';
import { taskRow, quickAdd } from './tasks.js';
import { habits, habitRow, scheduled } from './habits.js';
import { todayWorkoutCard } from './workouts.js';
import { todayJournalCard } from './notes.js';
import { mealsSummary, editLog, groceryCount, setTab as setFoodTab } from './food.js';
import { isOn } from './settings.js';
import { summaryBlock, editTxn, upcomingSubs, billsDueSoon, billRow, setTab as setMoneyTab } from './money.js';
import { choreRow, myChores as chores, dueDate, weekProgress } from './chores.js';
import { upcomingAssignments, editAssignment } from './school.js';

export const id = 'today';
export const title = 'Today';
export const glyph = 'today';

// ---- layout (which cards, in what order) --------------------------------------------------
const LAYOUT_ID = 'settings:today';
const CARDS = [['schedule', '📅 Schedule'], ['todo', '☑ To-do'], ['school', '🎓 School'], ['habits', '🔁 Habits'], ['workout', '💪 Workout'],
  ['cleaning', '🧽 Cleaning'], ['food', '🍽 Food'], ['money', '💵 Money'], ['journal', '📔 Journal']];
const LABEL = Object.fromEntries(CARDS);
function getLayout() {
  const saved = store.get(LAYOUT_ID) || {};
  const order = (saved.order || []).filter(k => LABEL[k]);
  for (const [k] of CARDS) if (!order.includes(k)) order.push(k); // new cards appear at the end
  return { order, hidden: saved.hidden || [] };
}
const saveLayout = l => store.save('settings', { order: l.order, hidden: l.hidden }, LAYOUT_ID);

function customize() {
  const l = getLayout();
  const list = h('div', { class: 'cust-list' });
  const draw = () => list.replaceChildren(...l.order.map((k, i) => h('div', { class: 'cust-row' + (l.hidden.includes(k) ? ' off' : '') },
    h('label', { class: 'cust-label' },
      h('input', { type: 'checkbox', checked: !l.hidden.includes(k), onchange: e => {
        l.hidden = e.target.checked ? l.hidden.filter(x => x !== k) : [...l.hidden, k]; saveLayout(l); draw();
      } }), LABEL[k]),
    h('div', { class: 'cust-move' },
      iconBtn('up', () => { if (i > 0) { [l.order[i - 1], l.order[i]] = [l.order[i], l.order[i - 1]]; saveLayout(l); draw(); } }, `Move ${LABEL[k]} up`),
      iconBtn('down', () => { if (i < l.order.length - 1) { [l.order[i + 1], l.order[i]] = [l.order[i], l.order[i + 1]]; saveLayout(l); draw(); } }, `Move ${LABEL[k]} down`)))));
  draw();
  openSheet({
    title: 'Customize Today',
    body: [h('p', { class: 'muted' }, 'Tick what you want on your Today screen, and use the arrows to change the order. Cards with nothing to show stay hidden automatically.'), list,
      h('button', { type: 'button', class: 'mini-link', onclick: () => { store.save('settings', { order: CARDS.map(c => c[0]), hidden: [] }, LAYOUT_ID); toast('Reset to default'); } }, 'Reset to default')],
    actions: [{ label: 'Done', cls: 'primary' }],
  });
}

export function render(root, { navigate }) {
  const today = ymd();
  const hr = new Date().getHours();
  const greeting = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  root.append(pageHead(greeting, {
    eyebrow: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    actions: [iconBtn('settings', customize, 'Customize Today'), iconBtn('search', () => navigate('search'), 'Search everything')],
  }));

  // Each card is built by a function; the order and which ones show are up to you (Customize).
  const builders = {
    schedule: () => {
      if (!isOn('calendar')) return null;
      const evs = eventsOn(today);
      return card('Schedule', { link: () => { setCalTab('calendar'); navigate('calendar'); } },
        evs.length ? evs.map(eventRow) : empty('Nothing on the calendar today.'));
    },
    todo: () => {
      if (!isOn('calendar')) return null;
      const tasks = store.list('tasks').filter(t => !t.done && t.due && t.due <= today).sort((a, b) => a.due.localeCompare(b.due));
      const doneToday = store.list('tasks').filter(t => t.done && t.doneAt === today).length;
      return card('To-do', { link: () => { setCalTab('todo'); navigate('calendar'); } },
        quickAdd({ key: 'today-task', due: today, placeholder: 'Add a to-do for today…' }),
        tasks.length ? tasks.map(taskRow) : empty(doneToday ? `All clear. ${doneToday} done today.` : 'Nothing due today.'));
    },
    school: () => {
      const soon = upcomingAssignments(7).filter(a => a.due > today);
      if (!isOn('school') || !soon.length) return null;
      return card('School: next 7 days', { link: () => navigate('school') },
        soon.slice(0, 6).map(a => h('div', { class: 'row compact', onclick: () => editAssignment(a) },
          h('div', { class: 'row-main' }, a.title, h('span', { class: 'muted' }, ` · ${a.list || ''}`)),
          h('span', { class: 'tag' }, relDay(a.due)))));
    },
    cleaning: () => {
      if (!isOn('chores') || !chores().length) return null;
      const due = chores().filter(c => dueDate(c) <= today || c.lastDone === today).sort((a, b) => dueDate(a).localeCompare(dueDate(b)));
      const p = weekProgress();
      return card('Cleaning', { link: () => navigate('chores'), action: h('span', { class: 'muted small' }, `${p.done}/${p.total} this week`) },
        due.length ? due.map(choreRow) : empty('Nothing to clean today ✨'));
    },
    habits: () => {
      if (!isOn('habits')) return null;
      const hb = habits().filter(x => scheduled(x, today));
      return card('Habits', { link: () => navigate('habits') },
        hb.length ? hb.map(x => habitRow(x, today)) : empty('Set up habits like water, sleep or workouts.'));
    },
    workout: () => (isOn('workouts') ? todayWorkoutCard(navigate) : null),
    journal: () => (isOn('notes') ? todayJournalCard(navigate) : null),
    food: () => {
      if (!isOn('food')) return null;
      const groc = groceryCount();
      return card('Food', { link: () => navigate('food'), action: btn('+ Log', () => editLog(null, { date: today }), 'ghost sm') },
        mealsSummary(today),
        h('button', { type: 'button', class: 'mini-link', onclick: () => { setFoodTab('groceries'); navigate('food'); } },
          groc ? `🛒 ${groc} item${groc > 1 ? 's' : ''} on your grocery list` : '🛒 Grocery list is empty'));
    },
    money: () => {
      if (!isOn('money')) return null;
      const renewals = upcomingSubs(7);
      const bills = billsDueSoon(7);
      return card('Money this month', { link: () => { setMoneyTab('budget'); navigate('money'); }, action: btn('+ Spent', () => editTxn(null), 'ghost sm') },
        summaryBlock(today.slice(0, 7)),
        bills.length ? h('div', { class: 'renewals' }, h('p', { class: 'eyebrow' }, 'Bills due'), bills.map(billRow)) : null,
        renewals.length ? h('div', { class: 'renewals' },
          h('p', { class: 'eyebrow' }, 'Renewing this week'),
          renewals.map(s => h('div', { class: 'row compact' },
            h('div', { class: 'row-main' }, s.name, h('span', { class: 'muted' }, ` · ${relDay(s.next)}`)),
            h('div', { class: 'amt' }, money(s.amount))))) : null);
    },
  };

  const layout = getLayout();
  const grid = h('div', { class: 'grid' });
  for (const key of layout.order) {
    if (layout.hidden.includes(key) || !builders[key]) continue;
    const el = builders[key]();
    if (el) grid.append(el);
  }
  root.append(grid.children.length ? grid : empty('Nothing to show. Tap the ⚙ button to choose what appears here.'));
}
