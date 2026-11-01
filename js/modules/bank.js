// bank.js — bringing bank transactions in (Money → Activity → Import bank file).
// Reads Quicken/Money/QuickBooks (QFX/OFX/QBO), CSV and PDF statements on this device, then
// saves each transaction as normal spending/income (source: 'bank'), so it shows up in the
// one Activity list and in Safe to spend. Only date, description, amount and an account name
// are kept, never account or routing numbers.
//
// Earlier versions kept bank data in a separate password-protected vault. migrateLegacy()
// unlocks that once and moves everything into the normal list.
import * as store from '../store.js';
import {
  h, card, empty, btn, icon, iconBtn, openForm, openSheet, toast, bar, money,
  ymd, addMonths, parseYmd, relDay,
} from '../ui.js';

const VAULT_ID = 'settings:bankvault'; // { salt, iter, check: { iv, ct }, created }
const COL = 'banktx';                  // { v, iv, ct }  (encrypted transaction)
const ITER = 600000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const PW_CHARS = 26;                                  // 26 × 5 bits = 130 bits

let rr = () => {};
const TX = 'txns';

// ---- crypto helpers ---------------------------------------------------------------------
const te = new TextEncoder(), td = new TextDecoder();
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

export function generatePassword() {
  const out = [];
  const buf = new Uint8Array(PW_CHARS);
  crypto.getRandomValues(buf);
  for (const b of buf) out.push(ALPHABET[b & 31]); // 256 is a multiple of 32, so no bias
  return out.join('').match(/.{1,5}/g).join('-');
}
/** Accept the password typed with or without dashes/spaces, any case, O for 0, I/L for 1. */
export function normalizePassword(p) {
  return String(p).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
export const passwordBits = p => { const n = normalizePassword(p); return [...n].every(c => ALPHABET.includes(c)) ? n.length * 5 : 0; };

async function derive(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 512));
  return {
    aes: await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']),
    hmac: await crypto.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  };
}
async function seal(obj, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.aes, te.encode(JSON.stringify(obj))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
async function open_(box, k) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k.aes, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

// ---- ids + old vault migration ---------------------------------------------------------------
async function recordId(text) {
  return 'bk:' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)))).slice(0, 32);
}
/** Bank transactions still locked in the old password vault? */
export const legacyCount = () => (store.get(VAULT_ID)?.salt ? store.list(COL).length : 0);
const toTx = (r, extra = {}) => ({
  date: r.date, amount: Math.abs(Number(r.amount) || 0), type: Number(r.amount) > 0 ? 'income' : 'expense',
  category: r.category || 'Other', note: r.note || r.desc, desc: r.desc, account: r.account || '', source: 'bank', catSet: !!r.catSet, ...extra,
});
/** Unlock the old vault once and move everything into the normal list. */
export async function migrateLegacy(password) {
  const v = store.get(VAULT_ID);
  const k = await derive(password, unb64(v.salt), v.iter || ITER);
  try { await open_(v.check, k); } catch { throw new Error('That bank password isn\'t right.'); }
  let moved = 0;
  const seen = {};
  for (const it of store.list(COL)) {
    let r;
    try { r = await open_(it, k); } catch { continue; }
    const base = `${r.date}|${Math.round(r.amount * 100) / 100}|${r.desc}`;
    seen[base] = (seen[base] || 0) + 1;
    const id = await recordId(`${base}|${seen[base]}`);
    if (!store.get(id)) { store.save(TX, toTx(r), id); moved++; }
    store.remove(it.id);
  }
  store.remove(VAULT_ID);
  return moved;
}
/** Forgot the old password: delete the locked copies (re-import from the bank instead). */
export function dropLegacy() {
  for (const it of store.list(COL)) store.remove(it.id);
  store.remove(VAULT_ID);
}

// ---- OFX / QFX / QBO reading (Quicken, Money and QuickBooks downloads) -----------------------
// Works for both the old SGML style (tags without closing tags) and the newer XML style.
// Only the date, amount, payee/memo and the bank's own transaction id (FITID) are kept.
export const isOFX = text => /OFXHEADER|<OFX>/i.test(text.slice(0, 4000));
const ofxDecode = v => String(v || '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&nbsp;/gi, ' ').trim();
const ofxTag = (block, tag) => { const m = block.match(new RegExp(`<${tag}>([^<\r\n]*)`, 'i')); return m ? ofxDecode(m[1]) : ''; };
export function parseOFX(text) {
  const rows = [['Date', 'Description', 'Amount', 'FITID']];
  const blocks = text.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
  for (const b of blocks) {
    const d = ofxTag(b, 'DTPOSTED') || ofxTag(b, 'DTUSER');
    const date = /^\d{8}/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
    const name = ofxTag(b, 'NAME'), memo = ofxTag(b, 'MEMO');
    const desc = (name && memo && !memo.toLowerCase().includes(name.toLowerCase()) && name.length < 12) ? `${name} ${memo}` : (name || memo || ofxTag(b, 'PAYEE'));
    rows.push([date, desc, ofxTag(b, 'TRNAMT'), ofxTag(b, 'FITID')]);
  }
  const org = ofxTag(text, 'ORG');
  return { rows, org };
}

// ---- PDF statements -------------------------------------------------------------------------
// pdf.js (bundled in js/vendor, loaded only when needed) pulls the text out on this device; we
// rebuild the lines, then look for "date … description … amount" rows. Less exact than QFX/CSV,
// so the preview always asks you to check.
const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';
const WORKER_URL = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
async function openPdf(buf) {
  let pdfjs;
  try { pdfjs = await import('../vendor/pdfjs/pdf.min.mjs'); }
  catch (e) { throw new Error(`PDF reader didn't load (${e?.message || e}). Check your connection, then close and reopen the app.`); }
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
  const opts = () => ({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false, disableFontFace: true, stopAtErrors: false, useWorkerFetch: false, useWasm: false });
  const attempt = async () => {
    const task = pdfjs.getDocument(opts());
    return Promise.race([task.promise, new Promise((_, rej) => setTimeout(() => { task.destroy?.(); rej(new Error('timed out')); }, 20000))]);
  };
  try { return await attempt(); }
  catch (e) {
    if (/password/i.test(`${e?.name} ${e?.message}`)) throw e;
    // Plan B: run the PDF reader on the main thread instead of a background worker
    // (some browsers block or break module workers).
    try { globalThis.pdfjsWorker = globalThis.pdfjsWorker || await import('../vendor/pdfjs/pdf.worker.min.mjs'); } catch (e2) { throw new Error(`${e?.message || e}; fallback: ${e2?.message || e2}`); }
    try { return await attempt(); } catch (e3) { throw new Error(`${e?.name || 'Error'}: ${e?.message || e}; fallback: ${e3?.name || ''} ${e3?.message || e3}`); }
  }
}
async function pdfLines(buf) {
  const doc = await openPdf(buf);
  const lines = [];
  for (let n = 1; n <= Math.min(doc.numPages, 60); n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let r = rows.find(r => Math.abs(r.y - y) < 3);
      if (!r) { r = { y, items: [] }; rows.push(r); }
      r.items.push({ x, str: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      for (const it of r.items) { if (end != null) line += it.x - end > 10 ? '   ' : it.x - end > 0.8 ? ' ' : ''; line += it.str; end = it.x + it.w; }
      lines.push(line.replace(/\s+$/, ''));
    }
  }
  return lines;
}
const MONTH_NUM = m => ({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 })[m.slice(0, 3).toLowerCase()];
/** Turn statement text lines into [Date, Description, Amount] rows. */
export function parseStatementLines(lines) {
  const text = lines.join('\n');
  // statement end date → the year for "10/28"-style dates
  let endY = null, endM = 12, m;
  if ((m = text.match(new RegExp(`(${MON})\\.?\\s+\\d{1,2},?\\s+(\\d{4})\\s*(?:-|–|—|through|thru|to)\\s*(${MON})\\.?\\s+\\d{1,2},?\\s+(\\d{4})`, 'i')))) { endY = +m[4]; endM = MONTH_NUM(m[3]); }
  else if ((m = text.match(/(\d{1,2})\/\d{1,2}\/(\d{2,4})\s*(?:-|–|—|through|thru|to)\s*(\d{1,2})\/\d{1,2}\/(\d{2,4})/i))) { endY = m[4].length === 2 ? 2000 + +m[4] : +m[4]; endM = +m[3]; }
  else if ((m = text.match(/\b(20\d\d)\b/))) endY = +m[1];
  endY = endY || new Date().getFullYear();
  const isCard = /credit card|card ?member|minimum payment|payment due date|credit (limit|line)|new balance|previous balance/i.test(text);
  const bank = (text.slice(0, 3000).match(/chase|wells fargo|bank of america|capital one|discover|american express|citi(bank)?|america first|mountain america|zions|u\.?s\.? bank|navy federal|usaa|ally|goldman sachs|apple card/i) || [''])[0];

  const DATE = `(\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|(?:${MON})\\.?\\s+\\d{1,2})`;
  const AMT = '(-?\\s?\\(?\\$?\\s?[\\d,]+\\.\\d{2}\\)?(?:\\s?(?:CR|DR|-))?)';
  const TX = new RegExp(`^\\s*${DATE}\\s+(.+?)\\s+${AMT}(?:\\s+${AMT})?\\s*$`, 'i');
  const SKIP = /beginning balance|ending balance|opening balance|closing balance|balance forward|previous balance|new balance|^total|subtotal|daily balance|minimum payment|payment due|interest charged? on|annual percentage/i;
  let section = null;
  const raw = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    const head = l.replace(/\s{2,}.*$/, '').toLowerCase();
    if (l.length < 60 && !/\d+\.\d{2}\s*$/.test(l) || /^(total )?(deposits|additions|credits|payments|withdrawals|purchases|debits|checks|fees|atm|electronic|card)/i.test(head)) {
      if (/deposit|addition|credits?\b|payments? and (other )?credits|money in|refund/i.test(head)) section = 1;
      else if (/withdrawal|debit|purchase|checks? paid|fees?\b|money out|card transactions|charges/i.test(head)) section = -1;
      else if (/^payments?\b/.test(head)) section = isCard ? 1 : -1;
    }
    if (!(m = l.match(TX))) continue;
    let [, d, desc, a1] = m;
    desc = desc.replace(new RegExp(`^${DATE}\\s+`, 'i'), '').replace(/\s{2,}/g, ' ').trim(); // drop a 2nd (post) date
    if (!desc || SKIP.test(desc) || /^\d+$/.test(desc)) continue;
    // date → YYYY-MM-DD
    let mo, dy, yr = null;
    if ((m = d.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) { mo = +m[1]; dy = +m[2]; if (m[3]) yr = m[3].length === 2 ? 2000 + +m[3] : +m[3]; }
    else { const p = d.split(/\.?\s+/); mo = MONTH_NUM(p[0]); dy = +p[1]; }
    if (!mo || mo > 12 || !dy || dy > 31) continue;
    if (!yr) yr = mo > endM ? endY - 1 : endY; // December lines on a January statement
    const neg = /^-|\(|DR|-\s*$/.test(a1.trim()), cr = /CR\s*$/i.test(a1);
    const abs = Math.abs(parseAmount(a1.replace(/CR|DR/i, '')) || 0);
    if (!abs) continue;
    raw.push({ date: `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`, desc, abs, neg, cr, section });
  }
  const anyNeg = raw.some(t => t.neg);
  const rows = [['Date', 'Description', 'Amount']];
  for (const t of raw) {
    let v;
    if (isCard) v = t.neg || t.cr ? t.abs : (t.section === 1 ? t.abs : -t.abs);     // cards: purchases are listed as positive
    else if (t.neg) v = -t.abs;
    else if (t.cr) v = t.abs;
    else if (t.section != null) v = t.section * t.abs;
    else v = anyNeg ? t.abs : -t.abs;                                                  // "-" marks money out → unsigned is money in
    rows.push([t.date, t.desc, v.toFixed(2)]);
  }
  return { rows, bank, isCard };
}

// ---- CSV reading -----------------------------------------------------------------------------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t'
    : (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
export function parseAmount(s) {
  s = String(s ?? '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s) || /\bDR\b/i.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Guess which column is which, from the header names (or the contents, if there's no header). */
export function detectColumns(rows) {
  const head = rows[0].map(x => x.toLowerCase());
  const find = re => head.findIndex(x => re.test(x));
  let map = {
    date: find(/^(posted |posting |transaction |trans\.? )?date$|^date posted$|^date$/),
    desc: find(/description|payee|merchant|^name$|details|narrative|memo/),
    amount: find(/^(transaction )?amount$|^amount \(?usd\)?$/),
    debit: find(/debit|withdrawal|money out|charges?$/),
    credit: find(/credit|deposit|money in|payments?$/),
    fitid: find(/^fitid$/),
    hasHeader: true,
  };
  if (map.date < 0) map.date = find(/date/);
  if (map.date >= 0 && map.desc >= 0 && (map.amount >= 0 || map.debit >= 0 || map.credit >= 0)) return map;

  // no usable header: look at the data (e.g. Wells Fargo exports have no header row)
  const sample = rows.slice(0, 20);
  const cols = Math.max(...sample.map(r => r.length));
  const score = (i, fn) => sample.filter(r => fn(r[i])).length;
  const dateCol = [...Array(cols).keys()].sort((a, b) => score(b, parseDate) - score(a, parseDate))[0];
  const numCols = [...Array(cols).keys()].filter(i => i !== dateCol && score(i, v => /^[-($]*[\d,]+\.\d{2}\)?$/.test(String(v || '').trim())) >= sample.length * 0.6);
  const textCol = [...Array(cols).keys()].filter(i => i !== dateCol && !numCols.includes(i))
    .sort((a, b) => sample.reduce((s, r) => s + (r[b] || '').length, 0) - sample.reduce((s, r) => s + (r[a] || '').length, 0))[0];
  return { date: dateCol, desc: textCol ?? -1, amount: numCols[0] ?? -1, debit: -1, credit: -1, fitid: -1, hasHeader: !!parseDate(rows[0][dateCol]) === false };
}

// ---- categories --------------------------------------------------------------------------------
const RULES = [
  ['Transfer', /transfer|xfer|payment thank you|autopay payment|online payment|credit card payment|card pmt|crcardpmt|to savings|from savings|zelle to|venmo cashout/i],
  ['Income', /payroll|direct dep|dir dep|salary|paycheck|interest paid|refund/i],
  ['Groceries', /walmart|smith'?s|kroger|costco|winco|trader joe|aldi|sprouts|harmons|whole foods|safeway|albertsons|grocery|market|sam'?s club|fresh market|lees market|maceys|macey'?s/i],
  ['Eating out', /mcdonald|chick-?fil|taco bell|wendy|subway|chipotle|starbucks|cafe rio|cubby|in-?n-?out|crumbl|swig|sodalicious|fiiz|doordash|uber ?eats|grubhub|restaurant|grill|pizza|burger|coffee|panda express|jimmy john|arby|sonic|dutch bros|cafe|diner|kitchen|bbq/i],
  ['Gas & transport', /shell|chevron|maverik|sinclair|exxon|conoco|phillips 66|7-?eleven|circle k|holiday|fuel|gas station|uber(?! ?eats)|lyft|parking|uta |bus |toll/i],
  ['Subscriptions', /netflix|spotify|hulu|disney|apple\.com\/bill|icloud|youtube|prime video|amazon prime|hbo|max\.com|paramount|peacock|audible|chatgpt|openai|adobe|microsoft 365|xbox|playstation|nintendo|patreon/i],
  ['Bills', /rent|apartment|utilit|power|rocky mountain power|dominion|enbridge|water|sewer|verizon|t-?mobile|at&t|xfinity|comcast|internet|insurance|geico|progressive|state farm|allstate|loan|tuition|suu /i],
  ['Shopping', /amazon|amzn|target|best buy|etsy|ebay|shein|temu|kohl|old navy|ross|tj ?maxx|marshalls|nike|walgreens|cvs|dollar tree|five below/i],
  ['Fun', /cinema|theater|theatre|movie|steam|ticketmaster|bowling|golf|concert|arcade|spotify concerts/i],
];
const merchantKey = d => String(d).toLowerCase().replace(/\d{3,}/g, ' ').replace(/[^a-z& ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');

function categories(catNames) {
  return [...new Set([...catNames, 'Bills', 'Subscriptions', 'Income', 'Transfer', 'Other'])];
}
function guessCategory(desc, amount, catNames, learned) {
  const k = merchantKey(desc);
  if (learned[k]) return learned[k];
  for (const [cat, re] of RULES) {
    if (!re.test(desc)) continue;
    if (cat === 'Transfer') return 'Transfer';
    if (cat === 'Income') return amount > 0 ? 'Income' : 'Other';
    if (amount > 0) return 'Income';
    return catNames.includes(cat) || ['Bills', 'Subscriptions'].includes(cat) ? cat : 'Other';
  }
  return amount > 0 ? 'Income' : 'Other';
}
/** Categories you picked yourself are remembered per merchant and reused next import. */
function learnedRules() {
  const out = {};
  for (const t of store.list(TX).filter(t => t.source === 'bank' && t.catSet).sort((a, b) => (a.date || '').localeCompare(b.date || ''))) out[merchantKey(t.desc || t.note)] = t.category;
  return out;
}

// ---- import flow -------------------------------------------------------------------------------
const BANK_STEPS = [
  ['Use a computer if you can', 'Bank apps usually can\'t export. Sign in to your bank\'s website in a browser instead. (On iPhone, use Safari. If you can\'t find a download option, tap aA → Request Desktop Website.)'],
  ['Open the account', 'Pick your checking account or credit card, and go to its Transactions, Activity or History page.'],
  ['Find Download / Export', 'Look for a button or ⤓ icon called Download, Export, or Download transactions. It\'s often near the search or filter options.'],
  ['Choose Quicken or CSV', 'Best: "Quicken (.qfx)", "Microsoft Money (.ofx)" or "QuickBooks (.qbo)". These are the most reliable. Otherwise pick CSV ("Comma delimited", "Spreadsheet (.csv)" or "Microsoft Excel (.csv)"). A PDF statement works too, but check the preview carefully.'],
  ['Pick the dates', 'Choose a date range, such as the last 30–90 days or since your last import. Overlapping dates are fine because duplicates are skipped.'],
  ['Import it here', 'Tap "Choose bank file" below and pick the file (on iPhone it\'s usually in Files → Downloads). Check the preview, then tap Import.'],
];
const BANK_HINTS = [
  ['Chase', 'Account → ⤓ (Download account activity) → File type: Quicken (QFX) or CSV'],
  ['Wells Fargo', 'Account Activity → Download Account Activity → Quicken/Microsoft Money or Comma Delimited'],
  ['Bank of America', 'Account → Download → File type: Quicken (.qfx), Microsoft Money (.ofx) or Microsoft Excel format'],
  ['Capital One', 'Account → View more transactions → Download Transactions → QFX, OFX or CSV'],
  ['Credit unions (America First, Mountain America…)', 'Account → Transactions/History → Export or Download → OFX/QFX ("Quicken") or CSV'],
];

function showInstructions(catNames) {
  // No "accept" filter: iPhone greys out .qfx/.ofx files it doesn't recognize. The file is checked when read.
  const file = h('input', { type: 'file', hidden: true,
    onchange: async e => { const f = e.target.files[0]; if (f) previewImport(f, catNames); e.target.value = ''; } });
  document.body.append(file);
  openSheet({
    title: 'Import from your bank',
    body: [
      h('p', { class: 'muted' }, 'Download your transactions from your bank as a Quicken (QFX/OFX) or CSV file, or use a PDF statement, then bring it in here. It takes about 2 minutes.'),
      h('ol', { class: 'big-steps' }, BANK_STEPS.map(([t, d]) => h('li', {}, h('b', {}, t), h('span', {}, d)))),
      h('details', { class: 'bank-hints' }, h('summary', {}, 'Where it is at popular banks'),
        h('ul', {}, BANK_HINTS.map(([b, d]) => h('li', {}, h('b', {}, b + ': '), d))),
        h('p', { class: 'hint' }, 'Menus change sometimes. If you can\'t find it, search "[your bank] download transactions QFX" or "… CSV". Tip: stick to one format per account so the same purchase isn\'t imported twice.')),
      h('p', { class: 'hint' }, '🔒 The file is read on this device. Only the date, description and amount are kept, never account or routing numbers.'),
    ],
    actions: [{ label: 'Choose bank file', cls: 'primary', onClick: () => file.click() }],
  });
}

async function previewImport(file, catNames) {
  let rows, org = '', ofx = false, pdf = false;
  try {
    const buf = await file.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buf.slice(0, 8)));
    if (/^PK/.test(magic)) { toast('That\'s an Excel file. Download QFX/OFX, CSV or the PDF statement instead.'); return; }
    if (/%PDF/.test(magic)) {
      toast('Reading PDF…');
      let lines;
      try { lines = await pdfLines(buf); }
      catch (e) {
        if (/password/i.test(`${e?.name} ${e?.message}`)) { toast('That PDF is password-protected. Open it, save a copy without a password, and try again.'); return; }
        console.error('PDF import failed', e);
        openSheet({ title: 'Couldn\'t open that PDF', body: [
          h('p', {}, 'Everyday couldn\'t read this PDF. Things to try:'),
          h('ol', { class: 'steps' },
            h('li', {}, 'Close Everyday completely (swipe it away) and open it again, so the newest version loads.'),
            h('li', {}, 'In the Chase app, open the statement → Share → "Save to Files", then pick that saved copy here.'),
            h('li', {}, 'Or download the activity as QFX or CSV from chase.com instead. Those are the most reliable.')),
          h('p', { class: 'hint' }, 'Details (send a screenshot of this to get it fixed):'),
          h('code', { class: 'err-detail' }, `${String(e?.message || e).slice(0, 400)} · ${file.name || 'file'} · ${Math.round(buf.byteLength / 1024)} KB · ${navigator.userAgent.match(/(iPhone|iPad|Mac|Windows|Android)[^;)]*/)?.[0] || ''} ${navigator.userAgent.match(/Version\/[\d.]+|Chrome\/\d+/)?.[0] || ''}`)] });
        return;
      }
      if (!lines.join('').trim()) { toast('That PDF looks like a scan (a picture of the page), so there\'s no text to read. Download QFX/CSV instead.'); return; }
      const res = parseStatementLines(lines);
      rows = res.rows; org = res.bank; pdf = true;
      if (rows.length < 2) { toast('Couldn\'t find any transactions in that PDF. QFX or CSV from your bank\'s website will work better.'); return; }
    } else {
      const text = new TextDecoder().decode(buf);
      if (isOFX(text)) { ({ rows, org } = parseOFX(text)); ofx = true; }
      else rows = parseCSV(text);
    }
  } catch { toast('Couldn\'t read that file.'); return; }
  if (rows.length < 2) { toast(ofx ? 'No transactions in that file. Try a wider date range.' : 'That file looks empty.'); return; }
  const map = detectColumns(rows);
  const cats = categories(catNames);
  const learned = learnedRules();
  const existing = new Set(store.list(TX).filter(t => t.source === 'bank').map(t => t.id));
  const colNames = rows[0].map((c, i) => map.hasHeader ? (c || `Column ${i + 1}`) : `Column ${i + 1} (e.g. ${String(c).slice(0, 18)})`);
  const colSelect = (key, label, optional) => {
    const sel = h('select', { onchange: () => { map[key] = Number(sel.value); draw(); } },
      optional ? h('option', { value: -1 }, '—') : null, colNames.map((n, i) => h('option', { value: i }, n)));
    sel.value = String(map[key]);
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), sel);
  };
  const account = h('input', { type: 'text', placeholder: 'e.g. Checking, Visa', value: (org && org.slice(0, 40)) || file.name.match(/chase|wells|capital|amex|discover|citi|boa|america first|mountain america/i)?.[0] || '' });
  const flip = h('input', { type: 'checkbox', onchange: () => draw() });
  const list = h('div', {});
  const summaryEl = h('p', { class: 'muted' });
  let parsed = [];

  function build() {
    const out = [];
    const seen = {};
    for (const r of rows.slice(map.hasHeader ? 1 : 0)) {
      const date = parseDate(r[map.date]);
      let amount = map.amount >= 0 ? parseAmount(r[map.amount]) : null;
      if (amount == null && (map.debit >= 0 || map.credit >= 0)) {
        const d = parseAmount(r[map.debit]), c = parseAmount(r[map.credit]);
        amount = c ? Math.abs(c) : d ? -Math.abs(d) : null;
      }
      const desc = String(r[map.desc] ?? '').replace(/\s+/g, ' ').trim();
      if (!date || amount == null || !desc) continue;
      if (flip.checked) amount = -amount;
      amount = Math.round(amount * 100) / 100;
      let sig = `${date}|${amount}|${desc}`;
      seen[sig] = (seen[sig] || 0) + 1;
      sig = `${sig}|${seen[sig]}`;
      const fitid = map.fitid >= 0 ? String(r[map.fitid] || '').trim() : '';
      if (fitid) sig = `fitid|${fitid}|${date}|${amount}`; // the bank's own id: best for skipping duplicates
      const category = guessCategory(desc, amount, catNames, learned);
      out.push({ date, amount, desc, sig, category, include: category !== 'Transfer' });
    }
    return out;
  }
  function draw() {
    parsed = build();
    const spentNeg = parsed.filter(t => t.amount < 0).length;
    list.replaceChildren(...parsed.slice(0, 60).map(t => {
      const cb = h('input', { type: 'checkbox', checked: t.include, onchange: e => { t.include = e.target.checked; count(); } });
      const sel = h('select', { class: 'inline-sel', onchange: e => { t.category = e.target.value; t.catSet = true; } }, cats.map(c => h('option', {}, c)));
      sel.value = t.category;
      return h('div', { class: 'row imp-row' + (t.include ? '' : ' muted') }, cb,
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, t.desc), h('div', { class: 'row-sub' }, relDay(t.date)), sel),
        h('div', { class: t.amount > 0 ? 'amt in' : 'amt' }, (t.amount > 0 ? '+' : '') + money(t.amount)));
    }), ...(parsed.length > 60 ? [h('p', { class: 'hint' }, `…and ${parsed.length - 60} more, categorized automatically.`)] : []));
    count();
    if (parsed.length && spentNeg === 0) summaryEl.textContent += ' ⚠ Nothing shows as money out. If spending looks like "+", tick "Flip signs".';
  }
  function count() {
    const inc = parsed.filter(t => t.include);
    const dates = parsed.map(t => t.date).sort();
    summaryEl.textContent = parsed.length
      ? `${parsed.length} transactions (${dates[0] ? relDay(dates[0]) : ''} – ${dates.length ? relDay(dates[dates.length - 1]) : ''}). ${inc.length} will be imported; transfers and card payments are unticked so they aren't counted twice.`
      : 'No transactions found with these columns. Try changing the column choices above.';
  }
  draw();

  openSheet({
    title: 'Check before importing',
    body: [
      summaryEl,
      ofx ? h('p', { class: 'hint' }, '✓ Quicken/OFX file: dates, amounts and money in/out come straight from your bank.') : null,
      pdf ? h('p', { class: 'warn-box' }, '📄 Read from a PDF statement. Check the list: make sure amounts are right and spending shows as "−". If spending shows as "+", tick "Flip signs" under Columns. Untick anything that isn\'t a real transaction.') : null,
      h('details', { class: 'bank-hints', open: !parsed.length && !ofx && !pdf },
        h('summary', {}, 'Columns (fix these if things look wrong)'),
        colSelect('date', 'Date'), colSelect('desc', 'Description'),
        colSelect('amount', 'Amount', true), colSelect('debit', '…or Debit / money out', true), colSelect('credit', '…and Credit / money in', true),
        h('label', { class: 'field check' }, h('span', { class: 'field-label' }, 'Flip signs (use if spending shows as "+")'), flip)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Account name (optional)'), account),
      list,
    ],
    actions: [{ label: 'Import', cls: 'primary', onClick: async () => {
      const inc = parsed.filter(t => t.include);
      let added = 0, skipped = 0;
      for (const t of inc) {
        const id = await recordId(t.sig);
        if (existing.has(id) || (store.known(id) && !store.get(id))) { skipped++; continue; }
        store.save(TX, toTx({ date: t.date, amount: t.amount, desc: t.desc, category: t.category, catSet: !!t.catSet, account: account.value.trim() }), id);
        existing.add(id);
        added++;
      }
      toast(`Imported ${added} transaction${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already here` : ''}`);
      rr();
    } }],
  });
}

// ---- used by Money → Activity --------------------------------------------------------------
export const setBankRerender = fn => { rr = fn; };
export const importBank = catNames => showInstructions(catNames);
export { merchantKey };
