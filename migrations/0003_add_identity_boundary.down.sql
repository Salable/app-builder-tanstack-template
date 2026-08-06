-- Identity data is part of the authorization boundary and cannot be represented by
-- schema 0002. Keep the schema and rows intact when rehearsing rollback; reapplying
-- 0003 is deliberately idempotent and restores only the migration ledger entry.
SELECT 1;
