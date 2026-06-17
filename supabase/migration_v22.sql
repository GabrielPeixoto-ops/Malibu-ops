-- migration_v22: scheduled finish time for bookings

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_finish_time time;
