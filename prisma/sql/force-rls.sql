-- Enable FORCE ROW LEVEL SECURITY on all tenant-owned tables
-- This makes RLS apply even to the table owner (neondb_owner)
-- REQUIRES the application to set app.tenant_id in every transaction
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'Organization', 'Brand', 'Product', 'Customer', 'Audience', 'Creative',
      'Campaign', 'AdSet', 'Ad', 'Interaction', 'Connector', 'RawRecord',
      'Event', 'Edge', 'Experiment', 'CausalEstimate', 'Recommendation',
      'Decision', 'Approval', 'Workflow', 'AgentRun',
      'AgentToolCall', 'AuditLog', 'Policy', 'CapitalLedgerEntry',
      'GrowthExperiment', 'Prospect', 'Outreach', 'ContentAsset', 'DiagnosticRun'
    ])
  LOOP
    EXECUTE format('ALTER TABLE "%s" FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;
