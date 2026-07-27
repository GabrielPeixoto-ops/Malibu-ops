-- migration_v52: truck fuel logs
--
-- fleet_fuel_logs: one row per diesel fill-up for a truck. Lets the office
-- log litres + cost (and optionally the odometer reading) each time a truck
-- is filled up, so the Fleet page can show average $ spent and, once two or
-- more fill-ups have an odometer reading, an estimated L/100km consumption
-- figure per truck. This is a manual stopgap until (if) we get API access
-- from Quik/QuikTrak to pull km driven automatically.
create table if not exists fleet_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  fleet_id uuid not null references fleet(id) on delete cascade,
  date date not null,
  litres numeric not null,
  cost numeric not null,
  odometer_km numeric,
  filled_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists fleet_fuel_logs_fleet_id_idx on fleet_fuel_logs(fleet_id);
create index if not exists fleet_fuel_logs_date_idx on fleet_fuel_logs(date);
