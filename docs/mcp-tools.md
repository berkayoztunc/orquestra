# MCP Tools

Orquestra exposes a stateless Streamable HTTP MCP server at:

```text
https://api.orquestra.dev/mcp
```

Local development endpoint:

```text
http://localhost:8787/mcp
```

Only public projects are available through MCP. Private projects are not exposed.

## Client Configuration

Claude Code:

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

Claude Desktop with Streamable HTTP wrapper:

```json
{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "https://api.orquestra.dev/mcp"
      ]
    }
  }
}
```

Cursor:

```json
{
  "mcpServers": {
    "orquestra": {
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

VS Code:

```json
{
  "servers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

## Scope Keys

Pass `X-Scope-Key` to limit `search_programs` to one saved program list.

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp",
      "headers": {
        "X-Scope-Key": "sk_your_scope_key_here"
      }
    }
  }
}
```

Scope keys are generated from the dashboard's Lists page. Regenerating a scope key invalidates the old key.

## Tool List

### `search_programs`

Search public projects by text query or exact Solana program ID.

Inputs:

- `query` - optional text search
- `programId` - optional exact base58 program ID
- `limit` - 1 to 20, default 10

Returns matching project IDs, names, program IDs, descriptions, and authors.

### `list_instructions`

List all instructions for a project.

Inputs:

- `projectId`

Returns instruction names, docs, argument schemas, account metas, signer flags, writable flags, and optional flags.

Use this before `build_instruction`.

### `build_instruction`

Build an unsigned Solana transaction for a project instruction.

Inputs:

- `projectId`
- `instruction`
- `accounts`
- `args`
- `feePayer`
- `recentBlockhash` - optional
- `network` - optional `mainnet-beta`, `devnet`, or `testnet`
- `rpcUrl` - optional RPC URL override
- `simulate` - optional boolean
- `encoding` - optional `base58` or `base64`

Returns:

- Serialized transaction
- Encoding
- Network and RPC host
- Blockhash metadata
- Estimated fee
- Risk level and risk reasons
- Accounts used
- Optional simulation result and decoded Anchor error

Signing is not performed by Orquestra MCP.

### `simulate_instruction`

Preflight an instruction without signing.

Inputs:

- `projectId`
- `instruction`
- `accounts`
- `args`
- `feePayer`
- `network`
- `rpcUrl`

Returns:

- Success or failure
- Compute units when available
- RPC logs
- Raw error
- Decoded Anchor error when available
- Build risk metadata

Use this before asking a user to sign a transaction.

### `list_pda_accounts`

List PDA-derivable accounts and seed schemas.

Inputs:

- `projectId`

Returns account names, instructions, seed names, seed kinds, seed types, descriptions, and custom PDA programs when present.

### `derive_pda`

Derive a PDA from IDL seed metadata.

Inputs:

- `projectId`
- `instruction`
- `account`
- `seedValues`

Returns:

- PDA address
- Bump
- Program ID used for derivation
- Seeds used

For Codama IDLs, `account` is the PDA name and `instruction` is not used by the derivation logic.

### `read_llms_txt`

Fetch the full AI-ready Markdown docs for a public project.

Inputs:

- `projectId`

Returns generated or custom docs with overview, instructions, accounts, types, errors, events, PDA docs, known addresses, external API notes, and examples.

### `get_ai_analysis`

Fetch AI-generated analysis for a project.

Inputs:

- `projectId`

Returns summary, tags, instruction count, account count, error count, event count, model name, and generation timestamp when available.

### `fetch_pda_data`

Fetch a Solana account and decode it with the project IDL.

Inputs:

- `projectId`
- `address`
- `cluster` - optional `mainnet-beta`, `devnet`, or `testnet`

Returns:

- Account type when detected
- Owner
- SOL balance
- Cluster and slot
- Decoded fields when the account discriminator matches
- Raw base64 preview when the account type is unknown

### `get_program_data`

Query program-owned accounts with Solana `getProgramAccounts`.

Inputs:

- `projectId`
- `accountType` - optional IDL account type name
- `network` - optional `mainnet-beta`, `devnet`, or `testnet`
- `rpcUrl` - optional RPC URL override
- `dataSize` - optional exact account data length
- `memcmp` - optional raw byte-offset filters
- `fieldFilters` - optional fixed-offset IDL field filters; requires `accountType`
- `limit` - 1 to 100, default 25
- `paginationKey` - optional Helius V2 cursor for the next page
- `changedSinceSlot` - optional Helius V2 incremental update slot
- `includeRaw` - optional boolean

Returns:

- Program ID, cluster, slot, filters applied, and count
- RPC method used and next `paginationKey` when available
- Account address, owner, lamports, executable flag, and rent epoch
- Detected account type
- Decoded fields when the IDL matches
- Raw base64 only when requested, unknown, or parse-failed

Use `accountType` to auto-apply discriminator filters. Use `dataSize` for exact layout size, raw `memcmp` for advanced byte offsets, and `fieldFilters` only for fixed-offset fields. Helius RPC URLs use `getProgramAccountsV2` automatically and can be paged with `paginationKey`. Dynamic account fields may require manual `dataSize` or raw offsets.

## Recommended Agent Flow

1. `search_programs`
2. `read_llms_txt` or `get_ai_analysis`
3. `list_instructions`
4. `list_pda_accounts`
5. `derive_pda`
6. `fetch_pda_data` or `get_program_data`
7. `simulate_instruction`
8. `build_instruction`
9. Sign with a separate wallet or signer MCP after explicit user approval
