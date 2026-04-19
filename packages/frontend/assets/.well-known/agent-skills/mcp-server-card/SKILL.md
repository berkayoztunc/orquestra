# MCP Server Card Support

Orquestra publishes an MCP Server Card at `/.well-known/mcp/server-card.json`.

## Included metadata

- `serverInfo` with name and version
- a Streamable HTTP transport endpoint at `https://api.orquestra.dev/mcp`
- tool capability names for the public MCP surface

This lets agents discover the MCP server without hard-coded documentation.