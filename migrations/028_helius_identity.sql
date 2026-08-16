-- Migration 028: Helius Wallet Identity enrichment for program_categories.
--
-- Adds columns for verified program identity data (Helius Wallet Identity
-- API — 3,000+ known Solana programs) alongside the existing AI-guessed
-- category/tags/aliases. `source` distinguishes which categorization a row
-- came from; the rest are populated only on the Helius path (services/
-- helius-identity.ts, services/ai-categorization.ts's identifyProgram()).

ALTER TABLE program_categories ADD COLUMN source TEXT DEFAULT 'ai';
ALTER TABLE program_categories ADD COLUMN website TEXT;
ALTER TABLE program_categories ADD COLUMN icon_url TEXT;
ALTER TABLE program_categories ADD COLUMN twitter TEXT;
ALTER TABLE program_categories ADD COLUMN discord TEXT;
