// notes.js — notes with checklists and simple formatting, folders, tags and
// colors, templates, links to classes/events, and a daily journal.
// Everything here is private to your account.
import * as store from '../store.js';
import { h, pageHead, empty, addBtn, btn, card, openSheet, toast, relDay, ymd, addDays, parseYmd } from '../ui.js';

export const id = 'notes';
export const title = 'Notes';
export const glyph = 'notes';

const COL = 'notes';   // { title, body, pinned, folder, color, link, edited, ts, kind?: 'journal', date, mood, highlight, grateful }
const TPL = 'notetpl'; // your own templates: { name, title, body }
const FOLDERS_ID = 'settings:notefolders'; // { list: [names] }

let tab = 'notes';      // 'notes' | 'journal'
let query = '';
let filter = 'all';     // 'all' | 'pinned' | 'folder:<name>' | 'tag:<tag>' | 'link:<link>'
let jDate = ymd();
let pendingOpen = null;

export function setTab(t) { tab = t === 'journal' ? 'journal' : 'notes'; }
/** Used by Search: jump straight to a note or journal day. */
export function focusItem(x) {
  if (x.kind === 'journal') { tab = 'journal'; jDate = x.date || ymd(); }
  else { tab = 'notes'; pendingOpen = x.id; }
}
/** Used by School: show the notes linked to one class. */
export function showLinked(link) { tab = 'notes'; filter = 'link:' + link; query = ''; }

const isJournal = n => n.kind === 'journal';
export const notes = () => store.list(COL).filter(n => !isJournal(n));
export const journal = () => store.list(COL).filter(isJournal).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const journalId = d => `journal:${d}`;
export const entryOn = d => { const e = store.get(journalId(d)); return e && isJournal(e) ? { id: journalId(d), ...e } : null; };
export const linkedNotes = link => notes().filter(n => n.link === link);

// ---- formatting (a small, safe Markdown subset) -------------------------------------------
// # Heading, **bold**, *italic*, ~~strike~~, `code`, - bullets, 1. numbers,
// - [ ] checklists (tap to tick), > quotes, --- lines, links and #tags.
const CHECK = /^(\s*)[-*] \[( |x|X)\]\s?(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUM = /^\s*(\d+)[.)]\s+(.*)$/;
const INLINE = /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(`[^`\n]+`)|(\*[^*\s][^*\n]*\*)|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])|(#[A-Za-z][\w-]{0,30})/g;

function inline(text) {
  const out = [];
  let last = 0, m;
  const re = new RegExp(INLINE.source, 'g'); // fresh copy: inline() calls itself for **bold** etc.
  while ((m = re.exec(text))) {
    const [all, bold, strike, code, ital, url, tag] = m;
    if (tag && m.index > 0 && !/\s|\(/.test(text[m.index - 1])) continue; // "a#b" is not a tag
    out.push(text.slice(last, m.index));
    if (bold) out.push(h('strong', {}, inline(bold.slice(2, -2))));
    else if (strike) out.push(h('s', {}, inline(strike.slice(2, -2))));
    else if (code) out.push(h('code', {}, code.slice(1, -1)));
    else if (ital) out.push(h('em', {}, inline(ital.slice(1, -1))));
    else if (url) out.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: e => e.stopPropagation() }, url.replace(/^https?:\/\//, '').slice(0, 48)));
    else if (tag) out.push(h('span', { class: 'md-tag' }, tag));
    last = m.index + all.length;
  }
  out.push(text.slice(last));
  return out.filter(x => x !== '');
}

/** Turn note text into elements. onToggle(lineIndex) is called when a checkbox is tapped. */
export function renderMd(body, onToggle) {
  const lines = String(body || '').split('\n');
  const out = [];
  let list = null, para = null;
  const endBlocks = () => { list = null; para = null; };
  lines.forEach((line, i) => {
    let m;
    if (!line.trim()) { endBlocks(); return; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { endBlocks(); out.push(h(`h${m[1].length + 2}`, { class: 'md-h' }, inline(m[2]))); return; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { endBlocks(); out.push(h('hr', {})); return; }
    if ((m = line.match(CHECK))) {
      para = null;
      if (list?.dataset.kind !== 'check') { list = h('div', { class: 'md-checks', 'data-kind': 'check' }); out.push(list); }
      const done = m[2] !== ' ';
      list.append(h('label', { class: 'md-check' + (done ? ' done' : ''), style: { marginLeft: `${Math.min(m[1].length, 6) * 8}px` }, onclick: e => e.stopPropagation() },
        h('input', { type: 'checkbox', checked: done, disabled: !onToggle, onchange: () => onToggle?.(i) }),
        h('span', {}, inline(m[3]))));
      return;
    }
    if ((m = line.match(BULLET)) || (m = line.match(NUM))) {
      para = null;
      const kind = line.match(NUM) && !line.match(BULLET) ? 'ol' : 'ul';
      if (list?.dataset.kind !== kind) { list = h(kind, { class: 'md-list', 'data-kind': kind }); out.push(list); }
      list.append(h('li', {}, inline(kind === 'ol' ? line.match(NUM)[2] : m[1])));
      return;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { endBlocks(); out.push(h('blockquote', {}, inline(m[1]))); return; }
    list = null;
    if (!para) { para = h('p', {}); out.push(para); } else para.append(h('br', {}));
    para.append(...inline(line));
  });
  return h('div', { class: 'md' }, out);
}

const plain = s => String(s || '').split('\n')
  .filter(l => !/^[ \t]*([-*•]|[-*] \[[ xX]\]|\d+[.)]|#{1,3})[ \t]*$/.test(l)) // skip empty items
  .map(l => l.replace(/^#{1,3}[ \t]+/, '').replace(/^[ \t]*[-*] \[ \][ \t]?/, '☐ ').replace(/^[ \t]*[-*] \[[xX]\][ \t]?/, '☑ ')
    .replace(/^[ \t]*[-*•][ \t]+/, '• ').replace(/^>[ \t]?/, '').replace(/^[ \t]*-{3,}[ \t]*$/, '').replace(/\*\*|~~|`/g, ''))
  .join('\n').replace(/\n{3,}/g, '\n\n').trim();
export function checkStats(body) {
  let total = 0, done = 0;
  for (const l of String(body || '').split('\n')) { const m = l.match(CHECK); if (m) { total++; if (m[2] !== ' ') done++; } }
  return { total, done };
}
function toggleLine(body, i) {
  const lines = String(body || '').split('\n');
  lines[i] = lines[i].replace(/\[( |x|X)\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
  return lines.join('\n');
}
export const tagsOf = n => {
  const set = new Set();
  for (const m of `${n.title || ''} ${n.body || ''}`.matchAll(/(?:^|[\s(])#([A-Za-z][\w-]{0,30})/g)) set.add(m[1].toLowerCase());
  return [...set];
};

// ---- folders, colors, links ----------------------------------------------------------------
const COLORS = [['', 'None'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['purple', 'Purple'], ['pink', 'Pink'], ['orange', 'Orange']];
export function folders() {
  const saved = (store.get(FOLDERS_ID) || {}).list || [];
  const used = notes().map(n => n.folder).filter(Boolean);
  return [...new Set([...saved, ...used])].sort((a, b) => a.localeCompare(b));
}
const saveFolders = list => store.save('settings', { list: [...new Set(list)] }, FOLDERS_ID);

function linkOptions() {
  const opts = [['', 'Not linked']];
  for (const c of store.list('classes').sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name))) opts.push([`class:${c.id}`, `🎓 ${c.code || c.name}`]);
  const from = addDays(ymd(), -21), to = addDays(ymd(), 45);
  for (const ev of store.list('events').filter(e => e.date && (e.repeat ? (!e.until || e.until >= from) : e.date >= from && e.date <= to)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40)) {
    opts.push([`event:${ev.id}`, `📅 ${ev.title}${ev.repeat ? ' (repeats)' : ` · ${relDay(ev.date)}`}`]);
  }
  return opts;
}
export function linkLabel(link) {
  if (!link) return '';
  const [type, id] = [link.slice(0, link.indexOf(':')), link.slice(link.indexOf(':') + 1)];
  const x = store.get(id);
  if (!x) return '';
  return type === 'class' ? `🎓 ${x.code || x.name}` : `📅 ${x.title}`;
}

// ---- templates ---------------------------------------------------------------------------
const longDay = d => parseYmd(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const TEMPLATES = [
  { key: 'checklist', icon: '☑', name: 'Checklist', title: '', body: '- [ ] \n' },
  { key: 'class', icon: '🎓', name: 'Class notes', title: '{class}: {date}', body: '## Topics\n- \n\n## Key points\n- \n\n## Questions to ask\n- [ ] \n\n## Homework\n- [ ] ', folder: 'School' },
  { key: 'study', icon: '📚', name: 'Study guide', title: 'Study guide: ', body: '**Exam date:** \n\n## Topics to review\n- [ ] \n- [ ] \n\n## Definitions & formulas\n- \n\n## Practice questions\n1. \n\n## Weak spots\n- ', folder: 'School' },
  { key: 'meeting', icon: '🗣', name: 'Meeting', title: 'Meeting: {date}', body: '**When:** {date}\n**Who:** \n\n## Agenda\n- \n\n## Notes\n\n\n## Action items\n- [ ] ' },
  { key: 'week', icon: '🗓', name: 'Weekly plan', title: 'Week of {date}', body: '## Must do\n- [ ] \n\n## Should do\n- [ ] \n\n## Want to\n- [ ] \n\n## Notes\n' },
  { key: 'project', icon: '🚀', name: 'Project plan', title: '', body: '## Goal\n\n\n## Steps\n- [ ] \n- [ ] \n- [ ] \n\n## Deadline\n\n\n## Resources & links\n- ' },
  { key: 'packing', icon: '🧳', name: 'Packing list', title: 'Packing: ', body: '## Clothes\n- [ ] Shirts\n- [ ] Pants / shorts\n- [ ] Underwear & socks\n- [ ] Pajamas\n- [ ] Jacket\n- [ ] Shoes\n\n## Toiletries\n- [ ] Toothbrush & toothpaste\n- [ ] Deodorant\n- [ ] Shampoo\n- [ ] Medications\n\n## Tech\n- [ ] Phone charger\n- [ ] Laptop & charger\n- [ ] Headphones\n\n## Other\n- [ ] Wallet & ID\n- [ ] Keys\n- [ ] Water bottle', folder: 'Lists' },
  { key: 'media', icon: '🎬', name: 'Book / movie', title: '', body: '**Type:** \n**Rating:** /5\n**Finished:** {date}\n\n## Thoughts\n\n\n## Favorite parts\n- ' },
  { key: 'ideas', icon: '💡', name: 'Brain dump', title: 'Ideas', body: '#ideas\n- ' },
];
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

function chooseTemplate(navigate) {
  const today = longDay(ymd());
  const classes = store.list('classes');
  const mine = store.list(TPL).sort((a, b) => a.name.localeCompare(b.name));
  const start = (t, extra = {}) => { dlg.close(); setTimeout(() => openNote(null, { title: fill(t.title, { date: today, ...extra.vars }), body: fill(t.body, { date: today, ...extra.vars }), folder: t.folder || '', ...extra.fields }, navigate), 30); };
  const dlg = openSheet({
    title: 'New from template',
    body: [
      h('div', { class: 'tpl-grid' },
        h('button', { type: 'button', class: 'tpl', onclick: () => start({ title: '', body: '' }) }, h('b', {}, '📝'), 'Blank'),
        TEMPLATES.map(t => h('button', { type: 'button', class: 'tpl', onclick: () => start(t) }, h('b', {}, t.icon), t.name))),
      classes.length ? [h('p', { class: 'field-label' }, 'Class notes for…'),
        h('div', { class: 'chip-row' }, classes.map(c => h('button', { type: 'button', class: 'chip', onclick: () => start(TEMPLATES.find(t => t.key === 'class'), { vars: { class: c.code || c.name }, fields: { link: `class:${c.id}` } }) }, c.code || c.name)))] : null,
      mine.length ? [h('p', { class: 'field-label' }, 'Your templates'),
        h('div', { class: 'stack-sm' }, mine.map(t => h('div', { class: 'row compact' },
          h('button', { type: 'button', class: 'row-main link-row', onclick: () => start(t) }, `⭐ ${t.name}`),
          h('button', { type: 'button', class: 'btn ghost sm', 'aria-label': `Delete template ${t.name}`, onclick: () => { store.remove(t.id); dlg.close(); toast('Template deleted'); } }, '✕'))))] : null,
      h('p', { class: 'hint' }, 'Tip: open any note and tap "Save as template" to add your own.'),
    ],
  });
}


// ---- bringing notes in from the iPhone Notes app ---------------------------------------------
// Apple Notes can't be read by other apps, so notes come in as text: either pasted, or sent by
// the "Add to Everyday" Shortcut, which opens #/notes?add=1&text=… . First line = title.
export function fromAppleText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u2028]/g, ' ').replace(/\ufffc/g, '').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const conv = l => l
    .replace(/^(\s*)[◦○☐□⚪]\s*/u, '$1- [ ] ')
    .replace(/^(\s*)[✓✔☑✅]\s*/u, '$1- [x] ')
    .replace(/^(\s*)[•▪●·–]\s+/u, '$1- ')
    .replace(/^\t/, '  ');
  const title = (lines.shift() || '').trim().replace(/^#+\s*/, '').slice(0, 120);
  const body = lines.map(conv).join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  return { title, body };
}
function importNote(text, navigate, source = 'pasted') {
  const { title, body } = fromAppleText(text);
  if (!title && !body) { toast('Nothing to import'); return; }
  const dupe = notes().find(n => (n.title || '') === title && (n.body || '') === body);
  const nid = dupe ? dupe.id : store.save(COL, { title, body, folder: '', edited: ymd(), ts: Date.now(), source });
  toast(dupe ? 'Already imported, opening it' : 'Note imported ✓');
  setTimeout(() => openNote({ id: nid, ...store.get(nid) }, {}, navigate), 40);
}
async function pasteNote(navigate) {
  try {
    const text = await navigator.clipboard.readText();
    if (text?.trim()) { importNote(text, navigate); return; }
  } catch { /* clipboard blocked: fall back to a paste box */ }
  const ta = h('textarea', { rows: 10, placeholder: 'Paste your note here', 'aria-label': 'Paste note text' });
  const dlg = openSheet({ title: 'Paste a note', body: [h('p', { class: 'muted' }, 'In the Notes app, open the note, tap and hold → Select All → Copy. Then paste it here. The first line becomes the title.'), ta],
    actions: [{ label: 'Import', cls: 'primary', onClick: () => importNote(ta.value, navigate) }] });
  setTimeout(() => ta.focus(), 60);
  return dlg;
}
function importHelp(navigate) {
  const url = `${location.origin}${location.pathname}#/notes?add=1&text=`;
  const dlg = openSheet({
    title: 'Bring in iPhone notes',
    body: [
      h('p', {}, 'Apple doesn\'t let other apps read the Notes app, so notes can\'t stay synced with it. You can copy them into Everyday, and from then on they sync across all your devices here.'),
      h('h3', {}, 'Quick way: paste'),
      h('ol', { class: 'steps' }, h('li', {}, 'In Notes, open the note. Tap and hold the text → Select All → Copy.'), h('li', {}, 'Come back here and tap "Paste a note".')),
      h('div', { class: 'btn-row' }, btn('📋 Paste a note', () => { dlg.close(); pasteNote(navigate); }, 'primary')),
      h('h3', {}, 'One-tap way: a Shortcut in the Share menu'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the Shortcuts app → tap + → name it "Add to Everyday".'),
        h('li', {}, 'Tap the ⓘ / settings button → turn on "Show in Share Sheet".'),
        h('li', {}, 'Add the action "URL Encode" (it uses Shortcut Input automatically).'),
        h('li', {}, 'Add the action "Text" and paste in the address below, then tap the end of it and insert the "URL Encoded Text" variable.'),
        h('li', {}, 'Add the action "Open URLs". Done.'),
        h('li', {}, 'To use it: in Notes, open a note → Share (or ⋯ → Send a Copy) → "Add to Everyday".')),
      h('div', { class: 'copy-box' }, h('code', {}, url), btn('Copy', () => navigator.clipboard?.writeText(url).then(() => toast('Copied ✓')), 'ghost sm')),
      h('p', { class: 'hint' }, 'The Shortcut opens Everyday in Safari. If you\'re signed in there with the same account (turn on sync), the note appears on your home-screen app and other devices within a few seconds.'),
    ],
  });
}

// ---- the editor ---------------------------------------------------------------------------
const MOODS = [['1', 'Awful'], ['2', 'Low'], ['3', 'Okay'], ['4', 'Good'], ['5', 'Great']];
const PROMPTS = [
  'What went well today, and why?', 'What\'s one thing you\'d do differently today?', 'What are you looking forward to this week?',
  'Who made your day better today?', 'What\'s been on your mind lately?', 'What did you learn today?', 'What drained your energy today? What gave you energy?',
  'What\'s one small win from today?', 'What are you worried about, and what\'s one step you can take?', 'Describe today in three words.',
  'What would make tomorrow great?', 'What are you proud of this week?', 'What habit is helping you most right now?', 'What\'s something you\'re grateful for that you usually overlook?',
  'What did you spend the most time on today? Was it worth it?', 'What\'s a goal you\'re working toward? How did today move it forward?', 'What made you laugh today?',
  'If today were a chapter in a book, what would it be called?', 'What\'s one thing you want to remember about today?', 'How did you take care of yourself today?',
  'What\'s a challenge you handled well recently?', 'What\'s something you want to try this month?', 'What conversation stuck with you today?',
  'What are three things you\'re looking forward to?', 'What would you tell yourself from a year ago?', 'Where did you feel most focused today?',
  'What\'s one thing you can let go of?', 'What surprised you today?', 'What\'s something kind you did or saw today?', 'How are you feeling about school right now?',
];
const promptFor = (d, shift = 0) => { let x = shift; for (const c of d) x = (x * 31 + c.charCodeAt(0)) >>> 0; return PROMPTS[x % PROMPTS.length]; };

/** Open a note (or a new one with `defaults`) in a full editor that saves as you type. */
export function openNote(n, defaults = {}, navigate) {
  const journalMode = defaults.kind === 'journal' || n?.kind === 'journal';
  let noteId = n?.id || (journalMode ? journalId(defaults.date) : null);
  let data = { title: '', body: '', folder: '', color: '', link: '', pinned: false, ...defaults, ...(n || {}) };
  let mode = n && data.body && !defaults.edit ? 'view' : 'edit';
  let timer = null, dirty = false;
  const status = h('span', { class: 'muted small save-status' }, n ? `Edited ${relDay(n.edited || ymd())}` : '');

  const hasContent = () => (data.title || '').trim() || (data.body || '').trim() || data.mood || data.highlight || data.grateful;
  function saveNow() {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    if (!noteId && !hasContent()) return;
    const { id: _i, created: _c, edit: _e, ...fields } = data;
    noteId = store.save(COL, { ...fields, edited: ymd(), ts: Date.now() }, noteId || undefined);
    status.textContent = 'Saved ✓';
  }
  const change = patch => { Object.assign(data, patch); dirty = true; status.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(saveNow, 600); };

  // title
  const titleIn = journalMode
    ? h('h2', { class: 'journal-day' }, longDay(data.date))
    : h('input', { class: 'note-title-in', placeholder: 'Title', value: data.title, 'aria-label': 'Note title', oninput: e => change({ title: e.target.value }) });

  // text area + live list continuation
  const ta = h('textarea', { class: 'note-ta', rows: 12, placeholder: journalMode ? 'Write anything…' : 'Start typing… Use the buttons above for checklists, headings and more.', 'aria-label': 'Note text' });
  ta.value = data.body || '';
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(220, ta.scrollHeight + 4) + 'px'; };
  ta.addEventListener('input', () => { change({ body: ta.value }); grow(); });
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return;
    const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const line = ta.value.slice(lineStart, pos);
    const m = line.match(/^(\s*)([-*] \[[ xX]\] |[-*•] |(\d+)[.)] )/);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[2].trim()) { // empty item → end the list
      ta.setRangeText('', lineStart, pos, 'end');
    } else {
      const next = m[3] ? `${Number(m[3]) + 1}. ` : m[2].replace(/\[[xX]\]/, '[ ]');
      ta.setRangeText('\n' + m[1] + next, pos, pos, 'end');
    }
    ta.dispatchEvent(new Event('input'));
  });
  function wrap(mark, holder = 'text') {
    const [a, b] = [ta.selectionStart, ta.selectionEnd];
    const sel = ta.value.slice(a, b) || holder;
    ta.setRangeText(mark + sel + mark, a, b, 'select');
    ta.setSelectionRange(a + mark.length, a + mark.length + sel.length);
    ta.focus(); ta.dispatchEvent(new Event('input'));
  }
  function prefix(p) {
    const a = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let b = ta.value.indexOf('\n', ta.selectionEnd); if (b < 0) b = ta.value.length;
    const lines = ta.value.slice(a, b).split('\n');
    const strip = l => l.replace(/^(#{1,3} |[-*] \[[ xX]\] |[-*•] |\d+[.)] |> )/, '');
    const all = lines.every(l => (p === '1. ' ? /^\d+[.)] /.test(l) : l.startsWith(p)));
    const out = lines.map((l, i) => (all ? strip(l) : (p === '1. ' ? `${i + 1}. ` : p) + strip(l))).join('\n');
    ta.setRangeText(out, a, b, 'end');
    ta.focus(); ta.dispatchEvent(new Event('input'));
  }
  const tool = (label, fn, aria) => h('button', { type: 'button', class: 'tool', 'aria-label': aria, title: aria, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  const toolbar = h('div', { class: 'note-tools' },
    tool('☐', () => prefix('- [ ] '), 'Checklist'), tool('•', () => prefix('- '), 'Bullet list'), tool('1.', () => prefix('1. '), 'Numbered list'),
    tool('H', () => prefix('## '), 'Heading'), tool(h('b', {}, 'B'), () => wrap('**'), 'Bold'), tool(h('i', {}, 'I'), () => wrap('*'), 'Italic'),
    tool(h('s', {}, 'S'), () => wrap('~~'), 'Strikethrough'), tool('❝', () => prefix('> '), 'Quote'), tool('—', () => { ta.setRangeText('\n---\n', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }, 'Divider'),
    tool('#', () => { ta.setRangeText(' #', ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); ta.dispatchEvent(new Event('input')); }, 'Add a tag'));

  // view mode
  const view = h('div', { class: 'note-view', onclick: () => setMode('edit') });
  const drawView = () => view.replaceChildren(data.body?.trim() ? renderMd(data.body, i => { data.body = toggleLine(data.body, i); ta.value = data.body; change({}); saveNow(); drawView(); }) : h('p', { class: 'muted' }, 'Empty. Tap to write.'));
  const modeSeg = h('div', { class: 'seg seg-sm' });
  function setMode(m) {
    mode = m;
    modeSeg.replaceChildren(...[['edit', '✎ Edit'], ['view', '👁 View']].map(([v, l]) => h('button', { type: 'button', class: mode === v ? 'on' : '', onclick: e => { e.stopPropagation(); setMode(v); } }, l)));
    if (mode === 'view') { drawView(); view.hidden = false; ta.hidden = true; toolbar.hidden = true; }
    else { view.hidden = true; ta.hidden = false; toolbar.hidden = false; requestAnimationFrame(() => { grow(); }); }
  }

  // organize row (notes only)
  let organize = null;
  if (!journalMode) {
    const folderSel = h('select', { 'aria-label': 'Folder' });
    const drawFolders = () => {
      folderSel.replaceChildren(h('option', { value: '' }, '📁 No folder'), ...folders().map(f => h('option', { value: f }, `📁 ${f}`)), h('option', { value: '__new' }, '➕ New folder…'));
      folderSel.value = data.folder || '';
    };
    drawFolders();
    const newFolderIn = h('input', { placeholder: 'Folder name', 'aria-label': 'New folder name', hidden: true,
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
      onblur: e => { const v = e.target.value.trim(); if (v) { saveFolders([...folders(), v]); change({ folder: v }); } e.target.hidden = true; folderSel.hidden = false; drawFolders(); } });
    folderSel.addEventListener('change', () => {
      if (folderSel.value === '__new') { folderSel.hidden = true; newFolderIn.hidden = false; newFolderIn.value = ''; newFolderIn.focus(); }
      else change({ folder: folderSel.value });
    });
    const linkSel = h('select', { 'aria-label': 'Linked to' }, linkOptions().map(([v, l]) => h('option', { value: v }, l)));
    if (data.link && ![...linkSel.options].some(o => o.value === data.link)) linkSel.append(h('option', { value: data.link }, linkLabel(data.link) || 'Linked item'));
    linkSel.value = data.link || '';
    linkSel.addEventListener('change', () => change({ link: linkSel.value }));
    const colorRow = h('div', { class: 'color-dots', role: 'radiogroup', 'aria-label': 'Color' });
    const drawColors = () => colorRow.replaceChildren(...COLORS.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String((data.color || '') === v), 'aria-label': l, title: l, class: `cdot nc-${v || 'none'}` + ((data.color || '') === v ? ' on' : ''), onclick: () => { change({ color: v }); drawColors(); dlg.classList.toggle('tinted', !!v); dlg.dataset.color = v; } })));
    drawColors();
    const pinBtn = h('button', { type: 'button', class: 'chip' + (data.pinned ? ' on' : ''), 'aria-pressed': String(!!data.pinned), onclick: () => { change({ pinned: !data.pinned }); pinBtn.classList.toggle('on', data.pinned); pinBtn.setAttribute('aria-pressed', String(data.pinned)); } }, '📌 Pin');
    organize = h('details', { class: 'note-org', open: !n },
      h('summary', {}, 'Folder, color, link & pin'),
      h('div', { class: 'note-org-grid' }, h('label', {}, h('span', { class: 'field-label' }, 'Folder'), folderSel, newFolderIn), h('label', {}, h('span', { class: 'field-label' }, 'Linked to'), linkSel)),
      h('div', { class: 'note-org-row' }, colorRow, pinBtn));
  }

  // journal extras
  let jExtras = null;
  if (journalMode) {
    let shift = 0;
    const moodRow = h('div', { class: 'mood-words', role: 'radiogroup', 'aria-label': 'Mood' });
    const drawMood = () => moodRow.replaceChildren(...MOODS.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(data.mood === v), class: `chip mood-${v}` + (data.mood === v ? ' on' : ''), onclick: () => { change({ mood: data.mood === v ? '' : v }); drawMood(); } }, l)));
    drawMood();
    const promptText = h('span', {}, data.prompt || promptFor(data.date));
    const promptBox = h('div', { class: 'jprompt' },
      h('span', { class: 'eyebrow' }, 'Prompt'), promptText,
      h('div', { class: 'btn-row' },
        btn('Write about this', () => { const p = `**${promptText.textContent}**\n`; ta.value = (ta.value ? ta.value.replace(/\s*$/, '\n\n') : '') + p; change({ body: ta.value, prompt: promptText.textContent }); setMode('edit'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 'ghost sm'),
        btn('↻ Another', () => { shift++; promptText.textContent = promptFor(data.date, shift); }, 'ghost sm')));
    jExtras = h('div', { class: 'stack-sm' },
      h('div', {}, h('span', { class: 'field-label' }, 'How was today?'), moodRow),
      h('label', {}, h('span', { class: 'field-label' }, 'Highlight of the day'), h('input', { value: data.highlight || '', placeholder: 'One good thing', oninput: e => change({ highlight: e.target.value }) })),
      h('label', {}, h('span', { class: 'field-label' }, 'Grateful for'), h('input', { value: data.grateful || '', placeholder: 'Big or small', oninput: e => change({ grateful: e.target.value }) })),
      promptBox);
  }

  // footer actions
  let armed = false;
  const delBtn = h('button', { type: 'button', class: 'btn ghost sm danger', onclick: () => {
    if (!noteId) { dlg.close(); return; }
    if (!armed) { armed = true; delBtn.textContent = 'Tap again to delete'; setTimeout(() => { armed = false; delBtn.textContent = 'Delete'; }, 3000); return; }
    clearTimeout(timer); dirty = false; store.remove(noteId); noteId = null; dlg.close(); toast(journalMode ? 'Entry deleted' : 'Note deleted');
  } }, 'Delete');
  const copyText = () => {
    const txt = [journalMode ? longDay(data.date) : data.title, data.highlight && `Highlight: ${data.highlight}`, data.grateful && `Grateful for: ${data.grateful}`, data.body].filter(Boolean).join('\n\n');
    if (navigator.share) navigator.share({ title: data.title || 'Note', text: txt }).catch(() => {});
    else navigator.clipboard?.writeText(txt).then(() => toast('Copied ✓'), () => toast('Couldn\'t copy'));
  };
  const footer = h('div', { class: 'note-foot' }, status, h('span', { class: 'spacer' }),
    !journalMode ? btn('Save as template', () => {
      const name = (data.title || '').trim() || 'My template';
      store.save(TPL, { name, title: data.title || '', body: data.body || '' });
      toast(`Saved template "${name}" ✓`);
    }, 'ghost sm') : null,
    !journalMode && noteId ? btn('Duplicate', () => { saveNow(); const { id: _x, created: _c, ...copy } = data; store.save(COL, { ...copy, title: `${data.title || 'Note'} (copy)`, edited: ymd(), ts: Date.now() }); toast('Duplicated ✓'); }, 'ghost sm') : null,
    btn(navigator.share ? 'Share text' : 'Copy text', copyText, 'ghost sm'),
    delBtn);

  const linkChip = !journalMode && data.link && linkLabel(data.link) ? h('span', { class: 'tag' }, linkLabel(data.link)) : null;
  const dlg = openSheet({
    title: journalMode ? 'Journal' : (n ? (data.folder ? `📁 ${data.folder}` : 'Note') : 'New note'),
    body: [titleIn, linkChip, jExtras, organize, h('div', { class: 'note-mode' }, modeSeg), toolbar, ta, view, footer].filter(Boolean),
  });
  dlg.classList.add('note-sheet');
  if (data.color) { dlg.classList.add('tinted'); dlg.dataset.color = data.color; }
  dlg.addEventListener('close', () => saveNow());
  setMode(mode);
  if (!n && !journalMode) setTimeout(() => (data.title ? ta : titleIn).focus(), 60);
  return dlg;
}

// ---- notes list -----------------------------------------------------------------------------
function noteCard(n, navigate) {
  const cs = checkStats(n.body);
  const tags = tagsOf(n);
  const preview = plain(n.body).replace(/#[A-Za-z][\w-]{0,30}/g, '').trim();
  return h('button', { type: 'button', class: `note nc-${n.color || 'none'}`, onclick: () => openNote(n, {}, navigate) },
    (n.pinned || n.folder) ? h('div', { class: 'note-top' }, n.pinned ? h('span', { class: 'pin' }, '📌 Pinned') : null, n.folder && !filter.startsWith('folder:') ? h('span', { class: 'note-folder' }, `📁 ${n.folder}`) : null) : null,
    n.title ? h('h3', {}, n.title) : null,
    preview ? h('p', {}, preview.slice(0, 260)) : null,
    cs.total ? h('div', { class: 'note-checks' }, h('span', {}, `☑ ${cs.done}/${cs.total}`), h('span', { class: 'mini-bar' }, h('i', { style: { width: `${Math.round(100 * cs.done / cs.total)}%` } }))) : null,
    (tags.length || n.link) ? h('div', { class: 'note-tags' }, n.link && linkLabel(n.link) ? h('span', { class: 'tag' }, linkLabel(n.link)) : null, tags.slice(0, 4).map(t => h('span', { class: 'md-tag' }, '#' + t))) : null,
    h('small', {}, relDay(n.edited || (n.created || '').slice(0, 10) || ymd())));
}

function manageFolders(rerender) {
  const dlg = openSheet({
    title: 'Folders',
    body: [h('p', { class: 'muted' }, 'Rename a folder by editing its name. Removing a folder keeps its notes; they just move out of the folder.'),
      folders().length ? folders().map(f => {
        const count = notes().filter(n => n.folder === f).length;
        return h('div', { class: 'row compact' },
          h('input', { value: f, 'aria-label': `Rename ${f}`, onchange: e => {
            const v = e.target.value.trim(); if (!v || v === f) return;
            for (const n of notes().filter(x => x.folder === f)) store.save(COL, { folder: v }, n.id);
            saveFolders(folders().map(x => (x === f ? v : x)).filter(x => x !== f).concat(v));
            if (filter === 'folder:' + f) filter = 'folder:' + v;
            toast('Renamed ✓');
          } }),
          h('span', { class: 'muted small' }, `${count}`),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => {
            for (const n of notes().filter(x => x.folder === f)) store.save(COL, { folder: '' }, n.id);
            saveFolders(((store.get(FOLDERS_ID) || {}).list || []).filter(x => x !== f));
            if (filter === 'folder:' + f) filter = 'all';
            dlg.close(); rerender();
          } }, 'Remove'));
      }) : empty('No folders yet.'),
      h('div', { class: 'row compact' },
        h('input', { placeholder: 'New folder name', 'aria-label': 'New folder name', onkeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { saveFolders([...folders(), e.target.value.trim()]); dlg.close(); toast('Folder added ✓'); } } }),
        h('span', { class: 'muted small' }, 'Enter to add'))],
  });
}

function renderNotes(root, ctx) {
  const all = notes();
  const fl = folders();
  const tags = [...new Set(all.flatMap(tagsOf))].sort();
  if (filter.startsWith('folder:') && !fl.includes(filter.slice(7))) filter = 'all';
  if (filter.startsWith('tag:') && !tags.includes(filter.slice(4))) filter = 'all';

  root.append(h('input', {
    type: 'search', class: 'search', placeholder: 'Search notes', value: query, 'data-fk': 'note-search', 'aria-label': 'Search notes',
    oninput: e => { query = e.target.value; ctx.rerender(); },
  }));
  const chip = (key, label) => h('button', { type: 'button', class: 'chip' + (filter === key ? ' on' : ''), 'aria-pressed': String(filter === key), onclick: () => { filter = filter === key && key !== 'all' ? 'all' : key; ctx.rerender(); } }, label);
  root.append(h('div', { class: 'chip-row note-filters' },
    chip('all', `All ${all.length}`),
    all.some(n => n.pinned) ? chip('pinned', '📌 Pinned') : null,
    fl.map(f => chip('folder:' + f, `📁 ${f}`)),
    filter.startsWith('link:') ? chip(filter, linkLabel(filter.slice(5)) || 'Linked') : null,
    h('button', { type: 'button', class: 'chip chip-ghost', onclick: () => manageFolders(ctx.rerender) }, fl.length ? '⋯ Folders' : '＋ Folder'),
    h('button', { type: 'button', class: 'chip chip-ghost', onclick: () => importHelp(ctx.navigate) }, '📋 Import')));
  if (tags.length) root.append(h('div', { class: 'chip-row tag-filters' }, tags.slice(0, 24).map(t => chip('tag:' + t, '#' + t))));

  const q = query.trim().toLowerCase();
  const list = all
    .filter(n => {
      if (filter === 'pinned' && !n.pinned) return false;
      if (filter.startsWith('folder:') && n.folder !== filter.slice(7)) return false;
      if (filter.startsWith('tag:') && !tagsOf(n).includes(filter.slice(4))) return false;
      if (filter.startsWith('link:') && n.link !== filter.slice(5)) return false;
      return !q || `${n.title} ${n.body} ${n.folder || ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.pinned === true) - (a.pinned === true) || (b.ts || 0) - (a.ts || 0) || (b.edited || b.created || '').localeCompare(a.edited || a.created || ''));

  if (!all.length) {
    root.append(card('Your notes', {},
      h('p', { class: 'muted' }, 'Jot down anything: class notes, checklists, ideas, plans. Notes save as you type and stay private to you.'),
      h('div', { class: 'btn-row' }, btn('Write a note', () => openNote(null, {}, ctx.navigate), 'primary'), btn('Use a template', () => chooseTemplate(ctx.navigate), 'ghost'), btn('Make a checklist', () => openNote(null, { body: '- [ ] ', edit: true }, ctx.navigate), 'ghost'), btn('📋 Bring in iPhone notes', () => importHelp(ctx.navigate), 'ghost'))));
    return;
  }
  if (!list.length) { root.append(empty(q ? 'No notes match.' : 'Nothing here yet.')); return; }
  root.append(h('div', { class: 'note-grid' }, list.map(n => noteCard(n, ctx.navigate))));
}

// ---- journal --------------------------------------------------------------------------------
function journalStreak() {
  let d = entryOn(ymd()) ? ymd() : addDays(ymd(), -1), n = 0;
  while (entryOn(d)) { n++; d = addDays(d, -1); }
  return n;
}
const excerpt = e => [e.highlight, plain(e.body)].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 160);

function renderJournal(root, ctx) {
  const today = ymd();
  if (jDate > today) jDate = today;
  const e = entryOn(jDate);
  const go = d => { jDate = d > today ? today : d; ctx.rerender(); };
  const write = () => openNote(e, { kind: 'journal', date: jDate, edit: true }, ctx.navigate);

  root.append(h('div', { class: 'daynav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => go(addDays(jDate, -1)) }, '‹'),
    h('button', { type: 'button', class: 'daynav-label', onclick: () => go(today) }, relDay(jDate)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next day', disabled: jDate >= today, onclick: () => go(addDays(jDate, 1)) }, '›')));

  // mood strip for the last 28 days
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
  root.append(h('div', { class: 'jstrip', 'aria-label': 'Last 4 weeks' }, days.map(d => {
    const x = entryOn(d);
    return h('button', { type: 'button', class: `jday${x ? ' has' : ''}${x?.mood ? ` mood-${x.mood}` : ''}${d === jDate ? ' sel' : ''}`, title: `${relDay(d)}${x ? ' · written' : ''}`, 'aria-label': `${relDay(d)}${x ? ', has an entry' : ''}`, onclick: () => go(d) }, Number(d.slice(8)));
  })));
  const streak = journalStreak();
  const month = journal().filter(x => (x.date || '').startsWith(today.slice(0, 7))).length;
  root.append(h('p', { class: 'muted small jstats' }, `${streak ? `${streak}-day streak · ` : ''}${month} entr${month === 1 ? 'y' : 'ies'} this month · ${journal().length} total`));

  if (e) {
    const mood = MOODS.find(m => m[0] === e.mood)?.[1];
    root.append(h('section', { class: 'card jentry' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, longDay(jDate)), btn('✎ Edit', write, 'ghost sm')),
      mood ? h('p', {}, h('span', { class: `chip on mood-${e.mood}` }, mood)) : null,
      e.highlight ? h('p', {}, h('b', {}, 'Highlight: '), e.highlight) : null,
      e.grateful ? h('p', {}, h('b', {}, 'Grateful for: '), e.grateful) : null,
      e.body ? renderMd(e.body, i => store.save(COL, { body: toggleLine(e.body, i) }, e.id)) : null));
  } else {
    root.append(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, jDate === today ? 'Today\'s entry' : longDay(jDate))),
      h('p', { class: 'jprompt-big' }, promptFor(jDate)),
      h('div', { class: 'btn-row' }, btn(jDate === today ? 'Write today\'s entry' : 'Write an entry', write, 'primary'),
        h('span', { class: 'mood-words' }, MOODS.map(([v, l]) => h('button', { type: 'button', class: `chip mood-${v}`, title: `Just log mood: ${l}`, onclick: () => store.save(COL, { kind: 'journal', date: jDate, mood: v, body: '', edited: ymd(), ts: Date.now() }, journalId(jDate)) }, l)))),
      h('p', { class: 'hint' }, 'Short on time? Tap a mood to log just that.')));
  }

  // looking back
  const back = [];
  const md = jDate.slice(5);
  for (const x of journal()) if (x.date && x.date < jDate && x.date.slice(5) === md) back.push([`${Number(jDate.slice(0, 4)) - Number(x.date.slice(0, 4))} year${Number(jDate.slice(0, 4)) - Number(x.date.slice(0, 4)) > 1 ? 's' : ''} ago`, x]);
  for (const [label, d] of [['1 week ago', addDays(jDate, -7)], ['1 month ago', addDays(jDate, -30)]]) { const x = entryOn(d); if (x) back.push([label, x]); }
  if (back.length) root.append(card('Looking back', {}, back.map(([label, x]) => h('button', { type: 'button', class: 'row result', onclick: () => go(x.date) },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, label, x.mood ? h('span', { class: 'muted' }, ` · ${MOODS.find(m => m[0] === x.mood)?.[1]}`) : null), h('div', { class: 'row-sub' }, excerpt(x) || 'Mood only'))))));

  const recent = journal().filter(x => x.date !== jDate).slice(0, 8);
  if (recent.length) root.append(card('Recent entries', {}, recent.map(x => h('button', { type: 'button', class: 'row result', onclick: () => go(x.date) },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, relDay(x.date), x.mood ? h('span', { class: `tag mood-t${x.mood}` }, MOODS.find(m => m[0] === x.mood)?.[1]) : null), excerpt(x) ? h('div', { class: 'row-sub' }, excerpt(x)) : null)))));
}

/** Small card for the Today screen. */
export function todayJournalCard(navigate) {
  const e = entryOn(ymd());
  const open = () => { tab = 'journal'; jDate = ymd(); navigate('notes'); };
  return card('Journal', { link: open },
    e ? h('p', { class: 'muted' }, MOODS.find(m => m[0] === e.mood) ? `Mood: ${MOODS.find(m => m[0] === e.mood)[1]}. ` : '', excerpt(e) || 'Written today ✓')
      : [h('p', { class: 'muted' }, promptFor(ymd())), h('div', { class: 'btn-row' }, btn('Write', () => openNote(null, { kind: 'journal', date: ymd(), edit: true }, navigate), 'ghost sm'))]);
}

export function render(root, ctx) {
  const qs = location.hash.split('?')[1];
  if (qs) {
    const p = new URLSearchParams(qs);
    history.replaceState(null, '', '#/notes');
    if (p.get('add')) { tab = 'notes'; const t = p.get('text') || [p.get('title'), p.get('body')].filter(Boolean).join('\n'); setTimeout(() => importNote(t, ctx.navigate, 'shortcut'), 30); }
    else if (p.get('journal')) tab = 'journal';
  }
  root.append(pageHead('Notes', {
    actions: tab === 'journal'
      ? [addBtn('Entry', () => openNote(entryOn(jDate), { kind: 'journal', date: jDate, edit: true }, ctx.navigate))]
      : [btn('Templates', () => chooseTemplate(ctx.navigate), 'ghost'), addBtn('Note', () => openNote(null, {}, ctx.navigate))],
  }));
  root.append(h('div', { class: 'seg seg-main' }, [['notes', '📝 Notes'], ['journal', '📔 Journal']].map(([v, l]) =>
    h('button', { type: 'button', class: tab === v ? 'on' : '', onclick: () => { tab = v; ctx.rerender(); } }, l))));
  if (tab === 'journal') renderJournal(root, ctx); else renderNotes(root, ctx);
  if (pendingOpen) {
    const n = store.get(pendingOpen) ? { id: pendingOpen, ...store.get(pendingOpen) } : null;
    pendingOpen = null;
    if (n) setTimeout(() => openNote(n, {}, ctx.navigate), 30);
  }
}
