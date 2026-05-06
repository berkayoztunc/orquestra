# Worker Package

Cloudflare Worker backend for Orquestra. It serves the REST API, MCP server, auth routes, generated docs, and discovery metadata.

## Main Surfaces

- REST API under `/api`
- MCP endpoint at `/mcp`
- GitHub OAuth under `/auth`
- `llms.txt` docs under `/project/:projectId/llms.txt`
- OpenAPI and well-known discovery metadata
- Admin and ingest routes protected by `X-Ingest-Key`

## Development

```bash
bun --cwd packages/worker run dev
```

The worker runs on `http://localhost:8787`.

## Tests

```bash
bun --cwd packages/worker test
```

See [../../docs/api-reference.md](../../docs/api-reference.md) and [../../docs/mcp-tools.md](../../docs/mcp-tools.md) for details.
