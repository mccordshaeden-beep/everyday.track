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
6. Open the app. Once sync is set up, it starts on a **login screen**. Tap **Create account**, enter an email + password, tap the link in the confirmation email, then sign in.
7. Sign in with the same account on every other device. Done: changes show up everywhere within a few seconds of opening the app.

## 4b. Letting other people use it

Anyone with the link can create their own account and gets their own empty, private tracker. The database rules (Row Level Security) only let each account read and write its own rows. Just send them the link.

- Each person picks which trackers they want in **Settings → Your trackers**, and that choice follows their account.
- **Signing out wipes that device's copy** (it's safe in the account), so a shared iPad never shows the last person's stuff.
- **Be upfront with friends:** as the owner of the Supabase project, you *can* see everyone's data in the Supabase dashboard (Table Editor). The app hides it from other users, not from the database admin.
- Want it to be just you again? Supabase → **Authentication → Sign In / Providers** → turn off "Allow new users to sign up".
- The free Supabase plan's built-in email sender only sends a few emails per hour, which is fine for a handful of friends. For more, add your own email provider under **Authentication → Emails → SMTP**.

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
│   ├── app.js              starts everything, login gate, navigation, redraws
│   ├── login.js            sign in / create account / forgot password screen
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

## Reminders (phone notifications)

Settings → **Reminders** → **Turn on for this device** (on iPhone/iPad this only works when Everyday is opened from its Home Screen icon). You get a morning summary, a heads-up before timed events, and a "due tomorrow" note in the evening, all adjustable.

How it works: the app writes the next 10 days of reminders into the `reminders` table whenever your data changes. A database cron job (`everyday-send-reminders`, every 5 minutes) calls the `push` Edge Function, which sends anything due to every device you turned on. Push keys are generated by the function itself and kept in the server-only `app_secrets` table.

## Canvas import

School → **Paste Canvas link**. In Canvas: Calendar → "Calendar Feed" → copy. The `canvas-feed` Edge Function downloads it (browsers can't fetch Canvas directly). Assignments become School assignments (classes are created automatically from the course code), other Canvas calendar items go into Calendar. It refreshes every 6 hours when you open the app, and never undoes what you've checked off, graded or deleted.

## Bank imports (QFX/OFX/QBO, CSV or PDF)

Bank imports no longer have a separate password. They're saved like any other spending, private to your account, and show up in Money → Activity. Data from the old password vault is moved over after one last unlock (or can be deleted and re-imported).

Quicken (.qfx), Microsoft Money (.ofx) and QuickBooks (.qbo) files are read directly; they're the most reliable format, and the bank's own transaction ids (FITID) prevent duplicates when date ranges overlap. Only date, payee/memo, amount and the bank's name are kept; account and routing numbers are ignored.

PDF statements also work: pdf.js (bundled in `js/vendor/pdfjs`, Apache-2.0, loaded only when you import a PDF) reads the text on the device. The app then finds date/description/amount lines, works out the year from the statement period, and handles credit-card sign conventions. Scanned (image-only) or password-protected PDFs are rejected with a clear message. The preview asks you to double-check, because PDF layouts vary between banks.



Importing: download a CSV from your bank's website (step-by-step instructions are in the app), tap **Import bank file**, check the preview, Import. Columns are detected automatically (Chase, Wells Fargo, Bank of America, Capital One and most credit unions work). Duplicates are skipped, transfers and card payments are unticked, and categories you correct are remembered per merchant. While unlocked, bank spending counts in the Budget tab. The vault locks after 10 minutes idle or 2 minutes in the background.

## Meta Muse (owner's account only)

Settings → **Meta Muse** → Create a key. Muse gets read-only access to the Calendar (events and due items) through the `calendar-mcp` Edge Function. Only the owner's account can create keys (enforced by the database policy and the function).

## Cleaning tab

Home freshness score, Mon–Sun week strip with real due dates, rooms, move/snooze, "every week on Saturdays" scheduling, ⚡ Quick clean, checklists inside chores, seasonal deep-clean ideas, and badges.

**Roommates:** Cleaning → Create a household (or Join with a code). New chores are shared with everyone in the household; edit a chore to assign it to someone, take turns (it moves to the next roommate after whoever did it last), or make it private. Shared chores sync through `shared_items`; only household members can read or change them. Your other trackers stay private. "Just mine" filters to your chores, and reminders/Today only include chores that are yours.

## Habits tab

Tap-to-log rings grouped into Morning / Afternoon / Evening / Anytime routines (▶ Start walks you through one at a time). Each habit can be every day, certain days, or N times a week; "build" or "quit" (days clean, slips). Tap a habit's name for stats (current/best streak, 30-day success %) and a month heatmap; tap a day to change it or use a 🧊 streak freeze (2 a month). Optional reminder time per habit (uses the same push reminders). Daily mood & energy check-in with simple habit/mood insights. Milestone celebrations at 3, 7, 14, 21, 30, 50, 66, 100, 200, 365 and 9 badges.

## Workouts tab

Pick one goal (Bulk / Maintain / Shred). It changes rep advice and rest times, adds an extra set on big lifts when you bulk, and sets estimated calorie and protein targets that the Food tab uses (recipes that suit the goal are listed first). Under Plans you can build your own plan or start from a ready-made one: gym, dumbbell, band, kettlebell, no-equipment or calisthenics. Guided sessions fill in your last weights and tell you when to go up. The rule: once every set reaches the top of the rep range, add 5 lb on upper body, 10 lb on lower body, or move to the next dumbbell. If you stall twice, drop about 10%. The Calisthenics tab has a how-to guide, 6 skill ladders that track your level, and 3 plans.

## Today and the To-do list

Use the ⚙ button on Today to reorder or hide cards. The old Tasks tab now lives under Calendar → To-do.

## Notes tab

Notes save as you type and are private to your account.
- **Formatting:** checklists you can tick off, headings, bold, italic, strikethrough, bullets, numbered lists, quotes, links and #tags. The toolbar inserts these for you, and pressing Enter keeps a list going.
- **Organizing:** folders, colors, pins, and filters by folder or #tag.
- **Templates:** class notes, study guide, meeting, weekly plan, project plan, packing list, book/movie and brain dump. You can also save your own with "Save as template".
- **Links:** link a note to a class or event. On each class card, School shows a 📝 button that opens that class's notes.
- **Journal tab:** one entry per day with a mood, a highlight, what you're grateful for and a daily prompt. It also shows a 4-week mood strip, your streak, and a "Looking back" section (1 week, 1 month and years ago). You can add a Journal card to Today.

**iPhone Notes:** Apple doesn't let other apps read the Notes app, so it can't sync both ways. You can bring notes in two ways, both explained under Notes → 📋 Import:
- Paste a note.
- Use an "Add to Everyday" Shortcut in the Share menu. It opens `#/notes?add=1&text=<url-encoded text>`.

The first line of the note becomes the title, and Apple checklist and bullet marks are converted.

## Money tab: Safe to spend

Everything is built around one number:

**Safe to spend** = income − bills & subscriptions − savings − everyday spending so far.

- **Income:** your planned take-home pay, or what actually came in if that's more.
- **Bills & subscriptions:** your list, or what was really paid if that's more. So nothing counts twice, and nothing is missed.
- **Savings:** your monthly amount, or what you logged with the category "Savings" if that's more.

The app also shows it per day for the rest of the month and for the rest of this week.

The tab has three sections:
- **This month:** the number and how it's worked out, bills and subscriptions due in the next 2 weeks, everyday spending against category limits, heads-up tips, and spending over the last 6 months.
- **Activity:** every transaction in one list, whether typed in, imported from the bank, or money in. Filter by All / Spending / Money in / From bank / Typed in. Import bank files from here. Transfers and card payments aren't counted.
- **Plan:** income, savings each month (with what your goals need), the everyday-spending money that leaves, optional category limits, bills, subscriptions, goals, and the Grow calculator.

## Security

- **Row Level Security** on every table: each account can only read its own rows, plus whatever someone deliberately shares with it.
- **App lock** (Settings → Security, set per device): a 6–12 digit PIN, stored only as a salted PBKDF2 hash, plus optional Face ID / Touch ID through a WebAuthn passkey.
  - Auto-locks when you leave the app or after a set time, and hides content in the app switcher.
  - After 5 wrong PINs you have to wait; after 10, the device signs out and wipes its copy.
- **Two-step login** with an authenticator app (TOTP, via Supabase MFA). The database enforces it: once an account has an authenticator, a restrictive policy on every table and a check in every sharing function need an `aal2` session (password + code). See `supabase/mfa.sql`.
- **Private vault:** locked notes and the journal (when "Encrypt my journal" is on) are encrypted on the device with AES-256-GCM. The key comes from a random 130-bit vault password (PBKDF2-SHA256, 600k rounds), and the database only stores ciphertext. Each device can remember the key as a non-extractable CryptoKey in IndexedDB. 
- **Content Security Policy** (in `index.html`): scripts can load only from this site, jsDelivr (supabase-js) and Cloudflare Turnstile, and the app only connects to this Supabase project. Plugins and `<base>` tricks are blocked, and a frame-buster stops the app being embedded on other sites.
- **Sign-up rules:** passwords need 12+ characters, can't be a common password, and can't contain your email name.
- **Sign out if unused:** an optional per-device timer (1, 7 or 30 days).

**Two dashboard settings to finish (2 minutes):**
1. In Supabase, go to **Authentication → Sign In / Providers → Email** and set the **minimum password length to 12**. The app already enforces this, and this setting makes the server enforce it too.
2. Optional bot protection (Cloudflare Turnstile, free):
   1. Create a Turnstile widget at dash.cloudflare.com → Turnstile for `mccordshaeden-beep.github.io`.
   2. Put the **site key** in `js/config.js` → `TURNSTILE_SITE_KEY`.
   3. In Supabase, go to **Authentication → Attack Protection → Enable CAPTCHA protection**, choose Turnstile, and paste the **secret key**.

   Do steps 2 and 3 together. If the server requires CAPTCHA but the app doesn't show it, sign-in fails.

**Lost your authenticator?** The app owner can remove it in the Supabase dashboard (Authentication → Users → the user → MFA factors). Adding a second authenticator ahead of time avoids this.

## Sharing

You can share with another Everyday user by their account email, which creates a private space for the two of you, or with your household:
- **Events:** pick a Calendar when you edit an event.
- **Whole calendars:** Calendar → 👥 Share a calendar. Tap a calendar chip to show or hide it.
- **Habits:** use "Do it together with". Each person tracks their own progress and can see the other's.
- **Shopping list:** Food → Groceries → Share list.

Settings → Sharing lists everyone you share with and lets you stop. In the database this uses the `share_with_person()` RPC and `households.kind = 'pair'`, with the same member-only RLS as households.

## Ideas for later

- Recurring tasks, a "skip one occurrence" option for repeating events
- Charts of spending by month, habit history
- Barcode/receipt scanning for groceries
