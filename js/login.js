// login.js — the first screen people see: sign in or create an account.
// Every account has its own private data (enforced by the database's
// Row Level Security), so anyone can make an account and only see their own stuff.
import { signIn, signUp, resetPassword } from './sync.js';
import { h } from './ui.js';

let mode = 'signin'; // signin | signup

export function renderLogin(rerender) {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', 'aria-label': 'Email', required: true, inputmode: 'email' });
  const pw = h('input', {
    type: 'password', placeholder: mode === 'signup' ? 'Choose a password (8+ characters)' : 'Password',
    autocomplete: mode === 'signup' ? 'new-password' : 'current-password', 'aria-label': 'Password', minlength: '8', required: true,
  });
  const msg = h('p', { class: 'login-msg', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'btn primary big' }, mode === 'signup' ? 'Create account' : 'Sign in');

  const form = h('form', {
    class: 'stack-form',
    onsubmit: async e => {
      e.preventDefault();
      submit.disabled = true;
      msg.className = 'login-msg';
      msg.textContent = mode === 'signup' ? 'Creating your account…' : 'Signing in…';
      try {
        if (mode === 'signup') {
          const res = await signUp(email.value.trim(), pw.value);
          if (!res.session) {
            msg.textContent = `Almost done! We sent a link to ${email.value.trim()}. Tap it to confirm your account.`;
          }
        } else {
          await signIn(email.value.trim(), pw.value);
        }
      } catch (err) {
        msg.className = 'login-msg bad';
        msg.textContent = friendly(err.message);
      } finally {
        submit.disabled = false;
      }
    },
  }, email, pw, submit, msg);

  const forgot = h('button', {
    type: 'button', class: 'btn ghost sm',
    onclick: async () => {
      if (!email.value.trim() || !email.checkValidity()) { msg.className = 'login-msg bad'; msg.textContent = 'Type your email above first.'; return; }
      try { await resetPassword(email.value.trim()); msg.className = 'login-msg'; msg.textContent = 'Check your email for a link to set a new password.'; }
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

function friendly(m = '') {
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/already registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/rate limit/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  return m || 'Something went wrong. Try again.';
}
