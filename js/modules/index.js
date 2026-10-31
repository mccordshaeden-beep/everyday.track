// modules/index.js — the list of screens in the app.
//
// To add a new tracker later: copy modules/_template.js, give it a new id,
// import it here, and add it to the array. It shows up in the sidebar and
// under "More" automatically, and its data syncs with no extra work.

import * as today from './today.js';
import * as tasks from './tasks.js';
import * as calendar from './calendar.js';
import * as food from './food.js';
import * as money from './money.js';
import * as habits from './habits.js';
import * as notes from './notes.js';
import * as settings from './settings.js';
import * as more from './more.js';

export const modules = [today, tasks, calendar, food, money, habits, notes, settings, more];
export const byId = Object.fromEntries(modules.map(m => [m.id, m]));
