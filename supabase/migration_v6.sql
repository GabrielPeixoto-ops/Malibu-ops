-- Migration v6 — run in Supabase SQL Editor

-- 1. Extra man employee FK on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extra_man_employee_id uuid REFERENCES employees(id);

-- 2. Supabase Storage bucket for job photos (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies (permissive — matches the existing RLS pattern in this app)
CREATE POLICY "job-photos select" ON storage.objects
  FOR SELECT USING (bucket_id = 'job-photos');

CREATE POLICY "job-photos insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "job-photos delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'job-photos');
