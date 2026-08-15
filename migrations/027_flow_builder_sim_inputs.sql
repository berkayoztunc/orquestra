-- Migration 027: persist the inputs a draft flow was simulated with.
--
-- The authoring agent discovers REAL on-chain addresses (via find_real_account)
-- and simulates with them — a `pool` input has to be an actual pool account, not
-- the default placeholder wallet, or the account simply does not decode.
--
-- Without storing those values, every later re-simulation re-tested a different
-- and meaningless scenario: the workflow's post-authoring verification and the
-- Telegram approve-path re-check both fell back to placeholder inputs and failed
-- on the placeholder rather than on the flow. Carrying the exact inputs forward
-- makes those re-runs reproduce what the agent actually proved.

ALTER TABLE flow_builder_drafts ADD COLUMN simulation_inputs_json TEXT;
