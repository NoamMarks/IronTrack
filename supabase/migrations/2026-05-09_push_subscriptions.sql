-- =============================================================================
-- Push subscriptions
-- =============================================================================
--
-- Adds a JSONB column to `profiles` holding the trainee's Web Push
-- subscription record (PushSubscription.toJSON() output: endpoint URL +
-- keys.p256dh + keys.auth). The column is null until the user grants
-- Notification permission and the client calls `subscribeToPush`.
--
-- No new RLS policy is needed:
--   - Users already have UPDATE access to their own profile row, which
--     covers the subscribe / unsubscribe writes.
--   - Coaches already have SELECT access to tenant-scoped profile rows,
--     which covers the server-side push send (the api/send-notification
--     handler reads `push_subscription` for the recipient using a
--     service-role client anyway, so RLS does not gate that path).
--
-- Idempotent — re-runs in dev environments are safe.

alter table public.profiles
  add column if not exists push_subscription jsonb;
