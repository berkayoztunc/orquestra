# Dashboard

The frontend dashboard is the user interface for managing Orquestra projects and exploring public programs.

## Pages

- Home
- Explorer
- Project detail
- Dashboard
- API documentation
- MCP documentation
- CLI documentation
- Lists
- Analytics
- Pricing
- Sign and send
- Auth callback and auth error pages

## Project Management

Authenticated users can:

- Upload IDLs
- Set name, description, program ID, and visibility
- Update project metadata
- Manage project API keys
- View usage and analytics
- Edit generated docs with custom Markdown
- Reset custom docs back to generated docs

## Program Explorer

Public projects expose:

- Project metadata
- Program ID
- Instructions
- Instruction arguments and account metas
- Account types
- Custom types
- Errors
- Events
- Generated docs
- Raw IDL
- AI analysis when available

## Transaction Builder UI

The instruction explorer and try-it panels help users build calls by showing:

- Required accounts
- Signer and writable flags
- Argument fields
- Default values where possible
- Request and response examples

The backend returns unsigned transactions. Signing is handled by the client, wallet, CLI, or signer MCP.

## PDA Explorer

The PDA explorer lists derivable accounts and seed schemas from the IDL. Users can enter seed values and derive:

- PDA address
- Bump
- Program ID used for derivation
- Seed details

## Account Data Viewer

For a known account address, Orquestra can fetch account data from the configured Solana RPC and decode fields with the project IDL.

Supported clusters:

- `mainnet-beta`
- `devnet`
- `testnet`

## Program Lists

Users can create lists of public programs. Each list has a generated scope key.

Scope keys can be passed to MCP with the `X-Scope-Key` header. When present, `search_programs` only returns programs from that list.

## Known Addresses

Project owners can document known addresses. These are useful for vaults, authorities, markets, pools, or other frequently used accounts.

Limits:

- Up to 50 known addresses per project
- Owner-only write access

## External API Notes

Project owners can document third-party APIs related to a program. Orquestra stores these notes and publishes them in project docs and `llms.txt`. Orquestra does not call those external APIs.

Limits:

- Up to 50 external API endpoints per project
- Owner-only write access
