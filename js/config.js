// config.js — turn on sync between your devices.
//
// Leave both blank and the app still works; data just stays on each device.
// To sync, create a free Supabase project (README → "Turn on sync") and paste:
//   SUPABASE_URL  → Project Settings → API → Project URL
//   SUPABASE_KEY  → the "publishable" key (older projects call it the "anon" key)
//
// The publishable key is meant to be public. Your data is protected by the
// Row Level Security rules in supabase/schema.sql, which only let a signed-in
// user read and write their own rows. NEVER put the secret / service_role key here.

export const SUPABASE_URL = 'https://rzkcynppocaxgydmsyvu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_NxuyfrlVrcj1usadfAk3ow_hAeoObzI';

// Optional "are you a human?" check on sign-up / sign-in (Cloudflare Turnstile, free).
// Leave blank to skip. To turn it on: README → "Bot protection". The secret key goes in
// Supabase (Authentication → Attack Protection), never here.
export const TURNSTILE_SITE_KEY = '';
