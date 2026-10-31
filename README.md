# Everyday

One app for tasks, calendar, food, money, habits and notes. It runs on your iPhone, iPad, laptop and tabletop computer from **one codebase**, works offline, and (optionally) syncs between all of them.

It's a **Progressive Web App (PWA)**: a website that installs to your home screen and opens full-screen like a normal app. No App Store, no Xcode, no $99 developer account, and every device runs the same code.

---

## 1. Try it on your laptop (2 minutes)

You need Python (already on Macs; on Windows install it from python.org).

```bash
cd everyday
python3 -m http.server 8000
```

Open http://localhost:8000. Everything works right away; data is saved in that browser.

Make the window narrow (or open DevTools → device toolbar) to see the phone layout with the bottom tab bar.

## 2. Put it online so your iPhone can install it

An iPhone only installs web apps from an **https://** address. The easiest free option is **GitHub Pages**:

1. Make a free account at github.com → **New repository** → name it `everyday` → **Public** → Create.
2. On the repo page: **Add file → Upload files** → drag in everything *inside* the `everyday` folder (index.html, css, js, icons, …) → Commit.
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save.
4. After a minute your app is at `https://YOUR-USERNAME.github.io/everyday/`.

Other options that also work: Netlify Drop (drag the folder onto app.netlify.com/drop), or any HTTPS web server, such as an Apache server with a Let's Encrypt certificate (just copy the folder into the web root).

## 3. Install it on each device

| Device | How |
|---|---|
| **iPhone / iPad** | Open the link in **Safari** → Share button → **Add to Home Screen** → Add |
| **Mac** | Safari → File → **Add to Dock**, or Chrome → install icon in the address bar |
| **Windows / tabletop PC** | Chrome or Edge → install icon at the right of the address bar |
| **Android** | Chrome menu ⋮ → **Add to Home screen** |

Without sync, each device keeps its own separate data. Step 4 connects them.

## 4. Turn on sync (free, about 10 minutes)

Sync uses **Supabase**, a hosted Postgres database with built-in logins.

1. Sign up at supabase.com → **New project** (any name, pick a strong DB password, region close to Utah e.g. *West US*).
2. Left menu → **SQL Editor** → **New query** → paste all of `supabase/schema.sql` → **Run**. You should see "Success".
3. Left menu → **Project Settings → API Keys** (or **Data API**). Copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable** key (`sb_publishable_…`). Older projects call it the **anon** key; either works.
4. Paste them into `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_KEY = 'sb_publishable_...';
   ```
   Upload the changed `config.js` to GitHub (open it in the repo → pencil icon → paste → Commit).
5. **Authentication → URL Configuration** → set **Site URL** to your app's address (`https://YOUR-USERNAME.github.io/everyday/`) so the "confirm your email" link opens the right place.
6. Open the app → **Settings** → enter an email + password → **Create account** → confirm the email → **Sign in**.
7. Sign in with the same account on every other device. Done: changes show up everywhere within a few seconds of opening the app.
8. **Lock the door:** Supabase → **Authentication → Sign In / Providers** → turn **off** "Allow new users to sign up". Now nobody else can make an account on your database.

The green dot next to each page title means synced; amber means not signed in or offline; red means a problem (details in Settings).

> Free Supabase projects pause after about a week with no use. Using the app daily keeps it awake. If it ever pauses, click **Restore** in the Supabase dashboard; nothing is lost, and the app keeps working offline meanwhile.

### Is it safe to put the key in the code?

Yes. That's what the publishable key is for. Security comes from **Row Level Security** in `schema.sql`: the database itself refuses any read or write where `user_id` isn't the signed-in user. Never put the *secret* / `service_role` key in the app.

---

## 5. How the code works

No frameworks and no build step: plain HTML, CSS and JavaScript modules, so every file you see is exactly what runs.

```
everyday/
├── index.html              the one HTML page; JS fills it in
├── manifest.webmanifest    name + icons → makes it installable
├── sw.js                   service worker → offline + instant loading
├── css/app.css             all styling (phone layout, then ≥820px sidebar layout)
├── js/
│   ├── app.js              starts everything, navigation, redraws on changes
│   ├── store.js            local database (localStorage)
│   ├── sync.js             Supabase sign-in + push/pull
│   ├── ui.js               helpers: h(), icons, cards, forms, dates, money
│   ├── config.js           your Supabase URL + key
│   └── modules/            one file per screen
│       ├── index.js        the list of screens
│       ├── today.js        dashboard pulling from all the others
│       ├── tasks.js  calendar.js  food.js  money.js  habits.js  notes.js
│       ├── settings.js  more.js
│       └── _template.js    copy this to add a new tracker
└── supabase/schema.sql     database table + security rules
```

### The flow of one tap

1. You tap **+** and fill in a form → `openForm()` in `ui.js` shows a bottom sheet.
2. On Save, the module calls `store.save('tasks', {...})`.
3. `store.js` writes it to `localStorage`, marks it *dirty*, and tells subscribers "something changed".
4. `app.js` hears that and redraws the current screen.
5. `sync.js` also hears it, waits 1.5 s (so rapid taps batch together), then **pushes** dirty items to Supabase and **pulls** anything newer from your other devices.

### Data model

Everything is one kind of record, so new trackers need zero database changes:

```js
{ id: 'a1b2…', col: 'tasks', data: { title: 'Read ch 5', due: '2026-11-01', done: false },
  updatedAt: '2026-10-31T20:15:03.120Z', deleted: false }
```

Collections in use: `tasks`, `events`, `meallog`, `groceries`, `foods` (saved meals & snacks), `txns` (spending), `subs`, `habits`, `habitlogs`, `notes`, `settings`.

### Conflicts

If you edit the same thing on two devices while offline, the **most recent edit wins** (compared by `updatedAt`). The database trigger in `schema.sql` enforces this on the server too, so an old copy can never overwrite a newer one. Deletes are "soft" (`deleted: true`) so they sync like any other change.

### Screens

Each module exports `id`, `title`, `glyph` (icon) and `render(root, ctx)`. `render` builds the screen with `h()`:

```js
h('div', { class: 'row', onclick: () => edit(item) }, 'Hello')
// → <div class="row">Hello</div> with a click handler
```

Screen state like "which tab is open" lives in plain variables at the top of each module; calling `ctx.rerender()` redraws.

### Responsive layout

`css/app.css` is written phone-first. At **820px** wide and up (iPad landscape, laptop, tabletop) the bottom tab bar is swapped for a sidebar and cards flow into 2 columns, and 3 columns at 1400px+. You can choose which 4 screens sit in the phone's tab bar in **Settings**.

## 6. Adding a new tracker later

1. Copy `js/modules/_template.js` to e.g. `js/modules/workouts.js` and edit the fields.
2. In `js/modules/index.js`: `import * as workouts from './workouts.js';` and add `workouts` to the array.
3. Add `'js/modules/workouts.js'` to `SHELL` in `sw.js` and change `CACHE` to `'everyday-v2'`.
4. Upload. It appears in the menu and syncs automatically.

## 7. Updating the app

Edit files → upload to GitHub. Installed copies pick up the new version the next time they're opened (sometimes it takes two opens, because the service worker shows the saved copy first and fetches the new one in the background). Bumping `CACHE` in `sw.js` on each release makes this cleaner.

## 8. Backups

**Settings → Download backup** saves a JSON file of everything. **Restore from file** merges one back in. Worth doing occasionally even with sync on.

## Ideas for later

- Reminders/notifications (iOS supports web push for installed apps; needs a small server function)
- Recurring tasks, a "skip one occurrence" option for repeating events
- Charts of spending by month, habit history
- Barcode/receipt scanning for groceries
- Import your school calendar (.ics feed)
