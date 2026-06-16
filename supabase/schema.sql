-- ============================================================
-- Malibu Ops Platform — Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- employees
-- ------------------------------------------------------------
create table if not exists employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  hourly_rate numeric(10,2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- subcontractors
-- ------------------------------------------------------------
create type billing_type_enum as enum ('percent', 'ratecard', 'formula');

create table if not exists subcontractors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  billing_type billing_type_enum not null,
  config       jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- customers
-- ------------------------------------------------------------
create table if not exists customers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  contact_info      text,
  default_addresses jsonb,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- jobs
-- ------------------------------------------------------------
create type job_status_enum as enum (
  'draft', 'scheduled', 'confirmed', 'in_progress',
  'completed', 'invoiced', 'paid', 'cancelled'
);

create table if not exists jobs (
  id                uuid primary key default gen_random_uuid(),
  job_number        text not null,
  date              date not null,
  subcontractor_id  uuid not null references subcontractors(id),
  customer_id       uuid references customers(id),
  pickup_address    text,
  delivery_address  text,
  status            job_status_enum not null default 'draft',
  cof               numeric(10,2),
  additional_hours  numeric(10,2),
  additional_rate   numeric(10,2),
  rate_card_key     text,
  formula_vars      jsonb,
  discount          numeric(10,2) not null default 0,
  notes             text,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- job_crew
-- ------------------------------------------------------------
create table if not exists job_crew (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  hours       numeric(10,2) not null default 0,
  cof_share   boolean not null default false,
  role        text
);

-- ------------------------------------------------------------
-- job_materials
-- ------------------------------------------------------------
create table if not exists job_materials (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  material_name text not null,
  quantity      numeric(10,2) not null default 1,
  cost_price    numeric(10,2) not null default 0,
  sale_price    numeric(10,2) not null default 0
);

-- ------------------------------------------------------------
-- Row Level Security (desabilitar para app interno sem auth por usuário)
-- Habilite RLS e adicione policies quando tiver auth configurado
-- ------------------------------------------------------------
alter table employees enable row level security;
alter table subcontractors enable row level security;
alter table customers enable row level security;
alter table jobs enable row level security;
alter table job_crew enable row level security;
alter table job_materials enable row level security;

-- Policy temporária: acesso total para usuários autenticados
create policy "authenticated full access" on employees for all to authenticated using (true) with check (true);
create policy "authenticated full access" on subcontractors for all to authenticated using (true) with check (true);
create policy "authenticated full access" on customers for all to authenticated using (true) with check (true);
create policy "authenticated full access" on jobs for all to authenticated using (true) with check (true);
create policy "authenticated full access" on job_crew for all to authenticated using (true) with check (true);
create policy "authenticated full access" on job_materials for all to authenticated using (true) with check (true);

-- Policy temporária para desenvolvimento: acesso total para anon (remover quando auth estiver configurado)
create policy "anon full access" on employees for all to anon using (true) with check (true);
create policy "anon full access" on subcontractors for all to anon using (true) with check (true);
create policy "anon full access" on customers for all to anon using (true) with check (true);
create policy "anon full access" on jobs for all to anon using (true) with check (true);
create policy "anon full access" on job_crew for all to anon using (true) with check (true);
create policy "anon full access" on job_materials for all to anon using (true) with check (true);

-- ------------------------------------------------------------
-- Seed data — Subcontractors
-- ------------------------------------------------------------
insert into subcontractors (name, billing_type, config) values
  ('TMAAT',                    'percent',  '{"percent": 0.57}'),
  ('Giraffe',                  'percent',  '{"percent": 0.67}'),
  ('Holloway',                 'ratecard', '{"gst": true, "rates": {"2men": 100, "3men": 145.45}}'),
  ('Rob',                      'ratecard', '{"gst": true, "rates": {"1man": 90, "2men": 130, "3men": 180}, "extra_note": "Large truck: $140 + GST"}'),
  ('Peter',                    'ratecard', '{"gst": true, "rates": {"1man": 80, "2men": 110, "3men": 160}}'),
  ('Office Movers',            'ratecard', '{"gst": true, "rates": {"1man": 80, "2men": 120, "3men": 170}}'),
  ('Mayfair Removals',         'ratecard', '{"gst": true, "rates": {"2men": 110, "3men": 160}, "extra_note": "Large truck: $140 + GST"}'),
  ('Property Clearance (1x)',  'formula',  '{"expression": "(firstHour + extraHours*hourlyRate) * 0.75 * gst", "defaults": {"firstHour": 250, "hourlyRate": 50}}'),
  ('Property Clearance (2x)',  'formula',  '{"expression": "(firstHour + extraHours*hourlyRate) * 0.75 * gst", "defaults": {"firstHour": 200, "hourlyRate": 50}}'),
  ('Private',                  'formula',  '{"expression": "additionalHours * additionalRate", "defaults": {}}');

-- ------------------------------------------------------------
-- Seed data — Employees
-- ------------------------------------------------------------
insert into employees (name, hourly_rate) values
  ('Juan',       40),
  ('Guilherme',  35),
  ('Carlos',     45),
  ('Diogo',      32),
  ('Luciana',    30),
  ('Kaio',       45),
  ('Lucas N',    35);
