# Edge Functions

Both are deployed to the Supabase project (Dashboard → Edge Functions), with "Verify JWT" off because each one checks who's calling itself.

- **push**: `{action:'vapid'}` returns the public push key; `{action:'test'}` sends a test to the signed-in user's devices; `{action:'cron'}` (needs the `x-cron-secret` header) sends due reminders. Runs every 5 min via pg_cron.
- **canvas-feed**: signed-in users only. Downloads a Canvas calendar (.ics) link and returns its text.

The source is visible in the Supabase dashboard for each function. To change one, edit it there or ask Claude to redeploy it.
