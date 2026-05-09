-- =============================================================================
-- Block notes (coach context per training program)
-- =============================================================================
--
-- Adds a free-text column on `programs` so coaches can attach a short
-- explanation of the block — its goal, methodology, and any focus points
-- the trainee should know before logging the first session. Rendered
-- read-only above the trainee's Current Block tab.
--
-- No new RLS policy needed:
--   - Coaches already hold UPDATE on tenant-scoped programs via the
--     existing programs UPDATE policy.
--   - Trainees already hold SELECT on programs they own through
--     programs.client_id = auth.uid().
--
-- Idempotent — re-runs in dev are safe.

alter table public.programs
  add column if not exists coach_notes text;
