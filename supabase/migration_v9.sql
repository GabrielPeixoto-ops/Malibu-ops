-- Migration v9 — Storage bucket + explicit role-based policies for job photos
-- Safe to re-run (ON CONFLICT + DROP IF EXISTS)

-- 1. Ensure bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Drop old generic policies from v6 (if they were created without role restrictions)
DROP POLICY IF EXISTS "job-photos select" ON storage.objects;
DROP POLICY IF EXISTS "job-photos insert" ON storage.objects;
DROP POLICY IF EXISTS "job-photos delete" ON storage.objects;

-- 3. Create explicit role-based policies
CREATE POLICY "job-photos anon select"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'job-photos');

CREATE POLICY "job-photos anon insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "job-photos anon delete"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'job-photos');

CREATE POLICY "job-photos auth select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos');

CREATE POLICY "job-photos auth insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos');

CREATE POLICY "job-photos auth delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-photos');
