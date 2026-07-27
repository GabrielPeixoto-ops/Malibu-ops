-- migration_v51: per-extra-man minimum call-out hours
--
-- job_extra_men.minimum_hours: nullable decimal. Extra men are often brought
-- on as a one-off "sweetener" for a far or late job — the office promises
-- them a minimum number of hours' pay (e.g. 4h) to make the job worth their
-- while, even if they end up working less. When set, this value replaces the
-- standard 2h minimum call for that specific person on that specific job
-- (job_crew and everyone else keep the normal 2h minimum). Left NULL
-- (default), extra men behave exactly as before.
ALTER TABLE job_extra_men ADD COLUMN IF NOT EXISTS minimum_hours numeric;
