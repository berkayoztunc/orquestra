# Data Model

Orquestra stores relational data in Cloudflare D1 and cached IDL/docs data in KV.

## Main Tables

| Table | Purpose |
| --- | --- |
| `users` | GitHub-authenticated users |
| `projects` | Program projects, metadata, visibility, custom docs |
| `idl_versions` | Versioned IDL JSON and optional `CPI.md` |
| `api_keys` | Project-scoped API keys |
| `project_socials` | Website and social links |
| `known_addresses` | Owner-documented program addresses |
| `ai_analyses` | Generated AI summaries and tags |
| `program_categories` | Search categories, aliases, and tags |
| `program_lists` | User-created program lists with scope keys |
| `program_list_items` | Projects saved into lists |
| `custom_api_endpoints` | Owner-documented third-party API notes |
| `analytics` tables | API and MCP usage tracking |

## Project Visibility

Public projects are available through:

- REST read APIs
- Project pages
- Program search
- `llms.txt`
- MCP tools

Private projects are only available to their owner through authenticated routes. MCP does not expose private projects.

## IDL Storage

D1 is the source of truth for IDL versions. KV is used as a cache for:

- Latest IDL JSON
- Versioned IDL JSON
- Generated Markdown docs

## Docs Storage

Docs can be:

- Generated from the latest IDL
- Overridden by owner-provided custom Markdown
- Cached in KV for faster public access

Generated docs include instruction docs, account types, custom types, errors, events, PDA docs, examples, known addresses, and external API notes when available.

## Scope Keys

Each program list has a `scope_key` beginning with `sk_`. MCP reads this key from the `X-Scope-Key` header and restricts `search_programs` to that list.

Regenerating a scope key updates the list and invalidates the previous key.
