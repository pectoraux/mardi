-- Check column names
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Campaign' ORDER BY ordinal_position;

-- Check policies
SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'Campaign';

-- Check RLS status
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Campaign';

-- Test directly
SET app.tenant_id = 'test';
SELECT current_setting('app.tenant_id', true) as val;
