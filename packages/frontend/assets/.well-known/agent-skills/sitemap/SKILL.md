# Sitemap Support

Orquestra publishes a dynamic sitemap at `/sitemap.xml`.

## What it includes

- Canonical site pages on `https://orquestra.dev`
- Public program pages derived from the live project registry
- `lastmod` values for dynamic program URLs

## Discovery

- `robots.txt` references the sitemap
- The sitemap is generated at request time so newly published public programs are discoverable without a frontend rebuild