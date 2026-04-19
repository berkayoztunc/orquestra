# OAuth Discovery Support

Orquestra publishes authorization server metadata on the API host.

## Metadata endpoints

- `https://api.orquestra.dev/.well-known/openid-configuration`
- `https://api.orquestra.dev/.well-known/oauth-authorization-server`

## Published fields

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`
- `grant_types_supported`
- `response_types_supported`

These documents advertise the current browser-based authorization flow used for protected API access.