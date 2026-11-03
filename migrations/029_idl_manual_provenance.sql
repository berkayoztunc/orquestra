-- Migration 029: label manually uploaded IDLs as 'manual' (no on-chain IDL behind them).
--
-- `idl_versions.idl_source` was added in 015 with DEFAULT 'anchor', and the user upload / update
-- routes never set it — so every manual upload was recorded as if it had been read from chain.
-- New uploads are now resolved against the chain and stored as 'manual' when no on-chain IDL exists
-- (routes/idl.ts, services/onchain-idl-check.ts). This backfills rows written before that change.
--
-- Heuristic (the old routes left no explicit marker):
--   * the project is owned by a real user ('system' owns on-chain auto-imported projects), and
--   * the version has no idl_hash — the chain-sync and CLI-ingest writers always set it, the
--     manual upload / PUT routes never did.
-- Idempotent: re-running changes nothing further.

UPDATE idl_versions
   SET idl_source = 'manual'
 WHERE idl_hash IS NULL
   AND (idl_source IS NULL OR idl_source = 'anchor')
   AND project_id IN (SELECT id FROM projects WHERE user_id <> 'system');
