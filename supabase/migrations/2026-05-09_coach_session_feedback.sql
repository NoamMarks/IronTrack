-- =============================================================================
-- Coach session feedback
-- =============================================================================
--
-- Adds a nullable `coach_note` column to the `days` table so coaches can
-- leave a short text response to a trainee's post-workout reflection. The
-- note is displayed read-only in the trainee's Workout History modal.
--
-- No new RLS policy is required:
--   - Coaches (admin role) already hold UPDATE access to all `days` rows
--     inside their tenant via the existing days UPDATE policy.
--   - Trainees already hold SELECT access to their own `days` rows.
--   - The realtime publication for `days` (added in
--     2026-05-08_post_workout_reflections.sql) already covers this column.

alter table public.days
  add column if not exists coach_note text;
