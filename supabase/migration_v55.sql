-- migration_v55: per-person hours_override + manual hours override for all sources
--
-- Bug reported by the owner: job_crew rows have their own start_time/end_time
-- that the office can edit individually, but whenever the JOB has a manual
-- hours override set (previously "Manual Hours Override (TMAAT)"), that
-- single value silently overrode EVERY crew/casual/extra-man's hours,
-- completely ignoring any per-person time they'd just typed. Editing an
-- individual's start/end time appeared to do nothing.
--
-- Fix: add a dedicated per-person hours_override column to job_crew,
-- job_casual_crew and job_extra_men. When set on a specific row it takes
-- priority for THAT person only, letting the office correct one person's
-- hours without affecting everyone else on the job. The job-level manual
-- override still applies as the default for everyone else, and is no longer
-- restricted to TMAAT-style subcontractors (round_up_hours=false) — it's now
-- available on private/contract/subcontract jobs alike, per owner's request.
ALTER TABLE job_crew ADD COLUMN IF NOT EXISTS hours_override numeric;
ALTER TABLE job_casual_crew ADD COLUMN IF NOT EXISTS hours_override numeric;
ALTER TABLE job_extra_men ADD COLUMN IF NOT EXISTS hours_override numeric;
