-- 009_analytics.sql
-- Zero-latency daily rollup analytics.
--
-- Written via ctx.waitUntil() (after response is sent) so there is zero
-- latency impact on the API or MCP paths.
--
-- event_type : 0 = HTTP API,  1 = MCP tool call
-- tool_id    : -1 for HTTP API;  0–7 for MCP tools (see services/analytics.ts)
-- project_id : empty string when no project is identified
-- date       : YYYYMMDD integer — fast GROUP BY without string parsing
-- count      : incremented via UPSERT (INSERT ... ON CONFLICT DO UPDATE)

CREATE TABLE IF NOT EXISTS analytics (
  date        INTEGER NOT NULL,
  event_type  INTEGER NOT NULL,
  project_id  TEXT    NOT NULL DEFAULT '',
  tool_id     INTEGER NOT NULL DEFAULT -1,
  count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, event_type, project_id, tool_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_date ON analytics (event_type, date);
CREATE INDEX IF NOT EXISTS idx_analytics_project    ON analytics (project_id);
