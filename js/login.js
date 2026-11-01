// login.js — the first screen people see: sign in or create an account.
// Every account has its own private data (enforced by the database's
// Row Level Security), so anyone can make an account and only see their own stuff.
import { signIn, signUp, resetPassword, mfaVerify, signOut } from './sync.js';
import { h } from './ui.js';
import * as config from './config.js';
const TURNSTILE_SITE_KEY = config.TURNSTILE_SITE_KEY || ''; // optional; older config files don't have it

// ---- password rules (sign-up and new passwords) ----------------------------------------------
// Length beats complexity: 12+ characters, not a well-known password, not your email.
const COMMON = new Set(['password', 'password1', 'password123', '123456789012', 'qwertyuiop', 'iloveyou', 'letmein', 'welcome', 'admin', 'monkey', 'dragon',
  'football', 'baseball', 'sunshine', 'princess', 'starwars', 'trustno1', 'whatever', 'superman', 'qwerty123', 'passw0rd', 'abc123', 'everyday', 'everyday123',
  'qwertyuiop12', 'password1234', 'iloveyou1234', 'aaaaaaaaaaaa', '111111111111', 'abcdefghijkl', '1q2w3e4r5t6y', 'zaq12wsxcde3']);
export function passwordProblems(pw, email = '') {
  const out = [];
  const low = pw.toLowerCase();
  const name = email.split('@')[0].toLowerCase();
  if (pw.length < 12) out.push('Use at least 12 characters (a few random words works great).');
  if (COMMON.has(low) || COMMON.has(low.replace(/[\d!@#$%^&*.]+$/, ''))) out.push('That password is too common.');
  if (name.length >= 4 && low.includes(name)) out.push('Don\'t use your email name in it.');
  if (/^(.)\1+$/.test(pw) || new Set(pw).size < 5) out.push('Use more different characters.');
  return out;
}

// ---- optional bot check (Cloudflare Turnstile) -------------------------------------------------
let captchaToken = '';
function captchaBox() {
  if (!TURNSTILE_SITE_KEY) return null;
  const box = h('div', { class: 'captcha' });
  const draw = () => window.turnstile?.render(box, { sitekey: TURNSTILE_SITE_KEY, callback: t => { captchaToken = t; }, 'expired-callback': () => { captchaToken = ''; } });
  if (window.turnstile) setTimeout(draw, 0);
  else if (!document.getElementById('ts-script')) {
    const sc = document.createElement('script');
    sc.id = 'ts-script'; sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; sc.async = true; sc.onload = draw;
    document.head.append(sc);
  } else document.getElementById('ts-script').addEventListener('load', draw);
  return box;
}
const resetCaptcha = () => { captchaToken = ''; try { window.turnstile?.reset(); } catch {} };

let mode = 'signin'; // signin | signup

export function renderLogin(rerender) {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', 'aria-label': 'Email', required: true, inputmode: 'email' });
  const pw = h('input', {
    type: 'password', placeholder: mode === 'signup' ? 'Choose a password (12+ characters)' : 'Password',
    autocomplete: mode === 'signup' ? 'new-password' : 'current-password', 'aria-label': 'Password', minlength: mode === 'signup' ? '12' : '6', required: true,
  });
  const rules = mode === 'signup' ? h('ul', { class: 'pw-rules', 'aria-live': 'polite' }) : null;
  if (rules) {
    const draw = () => { const p = pw.value ? passwordProblems(pw.value, email.value) : []; rules.replaceChildren(...(pw.value && !p.length ? [h('li', { class: 'good' }, '✓ Strong enough')] : p.map(x => h('li', {}, x)))); };
    pw.addEventListener('input', draw); email.addEventListener('input', draw);
  }
  const captcha = captchaBox();
  const msg = h('p', { class: 'login-msg', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'btn primary big' }, mode === 'signup' ? 'Create account' : 'Sign in');

  const form = h('form', {
    class: 'stack-form',
    onsubmit: async e => {
      e.preventDefault();
      if (mode === 'signup') {
        const p = passwordProblems(pw.value, email.value);
        if (p.length) { msg.className = 'login-msg bad'; msg.textContent = p[0]; return; }
      }
      if (TURNSTILE_SITE_KEY && !captchaToken) { msg.className = 'login-msg bad'; msg.textContent = 'Please finish the "I\'m human" check first.'; return; }
      submit.disabled = true;
      msg.className = 'login-msg';
      msg.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
      try {
        if (mode === 'signup') {
          const res = await signUp(email.value.trim(), pw.value, captchaToken);
          if (!res.session) {
            msg.textContent = `Almost done! We sent a link to ${email.value.trim()}. Tap it to confirm your account.`;
          }
        } else {
          await signIn(email.value.trim(), pw.value, captchaToken);
        }
      } catch (err) {
        msg.className = 'login-msg bad';
        msg.textContent = friendly(err.message);
      } finally {
        submit.disabled = false;
        resetCaptcha();
      }
    },
  }, email, pw, rules, captcha, submit, msg);

  const forgot = h('button', {
    type: 'button', class: 'btn ghost sm',
    onclick: async () => {
      if (!email.value.trim() || !email.checkValidity()) { msg.className = 'login-msg bad'; msg.textContent = 'Type your email above first.'; return; }
      if (TURNSTILE_SITE_KEY && !captchaToken) { msg.className = 'login-msg bad'; msg.textContent = 'Please finish the "I\'m human" check first.'; return; }
      try { await resetPassword(email.value.trim(), captchaToken); resetCaptcha(); msg.className = 'login-msg'; msg.textContent = 'Check your email for a link to set a new password.'; }
      catch (err) { msg.className = 'login-msg bad'; msg.textContent = friendly(err.message); }
    },
  }, 'Forgot password?');

  return h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('div', { class: 'login-brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 56, height: 56 }), h('h1', {}, 'Everyday')),
      h('p', { class: 'muted' }, 'Tasks, calendar, food, money and habits in one place, on all your devices.'),
      h('div', { class: 'seg' },
        h('button', { type: 'button', class: mode === 'signin' ? 'on' : '', onclick: () => { mode = 'signin'; rerender(); } }, 'Sign in'),
        h('button', { type: 'button', class: mode === 'signup' ? 'on' : '', onclick: () => { mode = 'signup'; rerender(); } }, 'Create account')),
      form,
      mode === 'signin' ? forgot : null,
      h('p', { class: 'hint center' }, '🔒 Each account\'s data is kept separate and private.')));
}

/** Second step of signing in: the 6-digit code from the authenticator app. */
export function renderMfa(rerender) {
  const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: '7', placeholder: '123 456', 'aria-label': '6-digit code', class: 'mfa-code', required: true });
  const msg = h('p', { class: 'login-msg', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'btn primary big' }, 'Verify');
  const form = h('form', { class: 'stack-form', onsubmit: async e => {
    e.preventDefault(); submit.disabled = true; msg.className = 'login-msg'; msg.textContent = 'Checking…';
    try { await mfaVerify(code.value); rerender(); }
    catch (err) { msg.className = 'login-msg bad'; msg.textContent = err.message; code.value = ''; code.focus(); }
    finally { submit.disabled = false; }
  } }, code, submit, msg);
  code.addEventListener('input', () => { if (code.value.replace(/\D/g, '').length === 6) form.requestSubmit(); });
  setTimeout(() => code.focus(), 50);
  return h('div', { class: 'login' },
    h('div', { class: 'login-card' },
      h('div', { class: 'login-brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 56, height: 56 }), h('h1', {}, 'Two-step check')),
      h('p', { class: 'muted' }, 'Open your authenticator app and type the 6-digit code for Everyday.'),
      form,
      h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => { await signOut(); location.reload(); } }, 'Cancel and sign out'),
      h('p', { class: 'hint center' }, 'Lost your phone? Use another authenticator you added, or contact the app owner to reset two-step.')));
}

function friendly(m = '') {
  if (/captcha/i.test(m)) return 'The "I\'m human" check failed or expired. Try again.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/already registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/rate limit/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  return m || 'Something went wrong. Try again.';
}
