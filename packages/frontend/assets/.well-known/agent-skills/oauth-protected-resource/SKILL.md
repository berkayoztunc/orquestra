# OAuth Protected Resource Metadata Support

Orquestra publishes protected resource metadata for its API.

## Metadata endpoint

- `https://api.orquestra.dev/.well-known/oauth-protected-resource`

## Published fields

- `resource`
- `authorization_servers`
- `scopes_supported`
- `bearer_methods_supported`
- `resource_documentation`

Protected endpoints also return `WWW-Authenticate` headers with a `resource_metadata` pointer.