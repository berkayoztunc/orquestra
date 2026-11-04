-- 029: IDL provenance backfill (no-op by design).
--
-- `idl_versions.idl_source = 'manual'` marks an IDL uploaded by a user with no verified
-- on-chain IDL behind it. New uploads are labeled by the upload routes.
--
-- Existing rows were backfilled once, directly on production, by checking each candidate
-- program on mainnet (only programs with NO on-chain IDL were set to 'manual'). A purely
-- SQL heuristic (idl_hash IS NULL) would mislabel programs that do have an on-chain IDL, so
-- it is intentionally not repeated here and this migration changes no data.
SELECT 1;
