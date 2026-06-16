CREATE TABLE IF NOT EXISTS fleet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  model text,
  registration text,
  size text,
  cargo_capacity_cbm int,
  actuals_cbm int,
  height_clearance text,
  internal_height text,
  tailgate text,
  default_driver text,
  selling_points text,
  notes text,
  tonnes numeric,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  fleet_id uuid REFERENCES fleet(id),
  created_at timestamptz DEFAULT now()
);

INSERT INTO fleet (name, model, registration, size, cargo_capacity_cbm, actuals_cbm, height_clearance, internal_height, tailgate, default_driver, selling_points, notes, tonnes) VALUES
('Truck 1', 'HINO 300 617',                 'CM39SK', 'large', 40, 33, '3.7M', '2.6M', 'RAMP', 'Kaio',      'SOLD AS 4.5T, 6T AND 8T', 'Biggest truck of the fleet. Solid and experienced driver. Very efficient on diesel.',                            8),
('Truck 2', 'MITSUBISHI FUSO CANTER 2013',  'DE26GK', 'large', 35, 29, '3.5M', '2.5M', 'RAMP', 'Carlos',    'SOLD AS 4.5T AND 6T',     'Second largest truck. Fast driver. Average fuel consumption.',                                                   6),
('Truck 3', 'ISUZU NPR 250 2006',           'AJ90YT', 'large', 30, 26, '3.2M', '2.3M', 'TGL',  'Not Fixed', 'SOLD AS 4.5T AND 6T',     'Mostly used as back-up or for subbie. Good engine, very little issues. Expensive on fuel.',                      6),
('Truck 4', 'MITSUBISHI FUSO CANTER 2010',  'DB51FF', 'small', 25, 22, '3.2M', '2.3M', 'TGL',  'Gabriel',   'SOLD AS 3T AND 4.5T',     'Good size for up to 2-bed house. Has overheating issue.',                                                       4.5),
('Truck 5', 'MITSUBISHI FUSO CANTER 2011',  'DJ73UN', 'small', 20, 18, '3.0M', '2.1M', 'TGL',  'Luan',      'SOLD AS 3T',              'Good for small moves or 2+ truck jobs. No engine issues.',                                                      3),
('Truck 6', 'HINO 300 616',                 'DK50UP', 'small', 20, 16, '3.0M', '2.0M', 'TGL',  'Juan',      'SOLD AS 3T',              'TMAAT BRANDED. Small jobs or last resort. Very efficient on fuel. No mechanical issues.',                        3)
ON CONFLICT DO NOTHING;
