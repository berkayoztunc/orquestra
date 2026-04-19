# Link Header Support

Orquestra returns RFC 8288 `Link` headers on its homepage and HTML document responses.

## Published relations

- `api-catalog` to `/.well-known/api-catalog`
- `service-desc` to `https://api.orquestra.dev/openapi.json`
- `service-doc` to `/docs/api`
- `describedby` to `/.well-known/mcp/server-card.json`

These links advertise the machine-readable API catalog, OpenAPI description, human docs, and MCP metadata.