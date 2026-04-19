# API Catalog Support

Orquestra publishes an RFC 9727 API catalog at `/.well-known/api-catalog`.

## Format

- Content type: `application/linkset+json`
- The catalog contains a `linkset` array
- Each API entry provides an `anchor` and related `service-desc`, `service-doc`, and `status` links

The canonical API service description points to `https://api.orquestra.dev/openapi.json`.