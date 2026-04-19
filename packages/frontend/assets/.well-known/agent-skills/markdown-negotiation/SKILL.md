# Markdown Negotiation Support

Orquestra supports content negotiation for agents on HTML routes.

## Behavior

- Requests with `Accept: text/markdown` receive Markdown instead of HTML
- Responses use `Content-Type: text/markdown; charset=utf-8`
- Responses include `Vary: Accept`
- Responses include `x-markdown-tokens` with an estimated token count

HTML remains the default representation for browsers.