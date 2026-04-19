# Agent Skills Discovery Support

Orquestra publishes an Agent Skills discovery index at `/.well-known/agent-skills/index.json`.

## Format

- Includes the discovery `$schema`
- Includes a `skills` array
- Each skill entry points to a hosted `SKILL.md` artifact and includes a SHA-256 digest

The discovery index enumerates the agent-facing capabilities published on Orquestra.