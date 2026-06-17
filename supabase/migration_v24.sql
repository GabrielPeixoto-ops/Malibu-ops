-- migration_v24: extra men with individual start/finish times

CREATE TABLE IF NOT EXISTS job_extra_men (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),
  start_time text,
  finish_time text,
  created_at timestamptz DEFAULT now()
);
