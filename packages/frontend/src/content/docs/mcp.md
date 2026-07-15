Connect Orquestra to any MCP-capable assistant and let your agent inspect Solana IDLs, derive PDAs, fetch live on-chain account data, and build unsigned transactions directly from prompts.

## Workflow

1. **Discover a program** — use `search_programs` to find public Solana projects by keyword or exact program ID.
2. **Inspect and prepare** — call `list_instructions`, `list_pda_accounts`, and `derive_pda` to gather exact call inputs.
3. **Build transactions** — use `build_instruction` to get a base58 unsigned transaction your app or wallet can sign.
4. **Query program data** — call `get_program_data` to search program-owned accounts with `accountType`, `dataSize`, `memcmp`, and fixed IDL field filters.

## Endpoint

```text
https://api.orquestra.dev/mcp
```

## Clients

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-streamable-http", "https://api.orquestra.dev/mcp"]
    }
  }
}
```

Save, then fully restart Claude Desktop to reload MCP servers.

**Claude Code** — fastest via CLI:

```bash
claude mcp add --transport http orquestra https://api.orquestra.dev/mcp
```

Or edit the config directly — `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

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

Run `/mcp` in Claude Code to confirm the orquestra server is connected. The streamable HTTP transport works with no local install.

**Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "orquestra": {
      "url": "https://api.orquestra.dev/mcp"
    }
  }
}
```

Save and reload window to make tools available in your agent panel.

**VS Code (GitHub Copilot)** — `.vscode/mcp.json` (project) or user-level MCP settings

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

Reload VS Code and check the Copilot MCP panel for Orquestra server status.

## Tools

These tools are read-oriented plus transaction building, live account fetching, and simulation. Signing and broadcasting stay on your client side.

| Tool | Description |
| --- | --- |
| `search_programs` | Search public projects in Orquestra by keyword or by exact program ID. |
| `list_instructions` | List all instructions, args, and account metas for a project. |
| `build_instruction` | Build and serialize a Solana instruction transaction into base58. |
| `list_pda_accounts` | Show PDA-derivable accounts and seed schemas from the IDL. |
| `derive_pda` | Derive a PDA with your provided seed values and return the bump. |
| `read_llms_txt` | Read full AI-focused markdown docs for a selected project. |
| `get_ai_analysis` | Get AI analysis summary, tags, and metadata for a project. |
| `fetch_pda_data` | Fetch a Solana account by address and decode its fields using the project IDL. Accepts an optional cluster param (mainnet-beta, devnet, testnet). |
| `get_program_data` | Query `getProgramAccounts` for a project's program ID. Supports discriminator filters, `dataSize`, raw `memcmp`, fixed-field IDL filters, decoded results, Helius V2 pagination, and optional raw base64. |
| `simulate_instruction` | Preflight an instruction against the RPC without signing. Returns success/failure, compute units, and a decoded Anchor error name when a custom program error is hit. Use before signing to catch mistakes early. |
| `simulate_transaction` | Preflight a full transaction against the RPC without signing, for cases involving multiple instructions. |

## Try this prompt

Once the server is connected, paste either of these into your assistant. The full pipeline (research → resolve → build → simulate → sign) runs inside one prompt.

- *Single tool call:* "Use orquestra to list every instruction on the Marinade program."
- *Full conductor pipeline:* "Stake 1 SOL with Marinade. Simulate first, then ask me before signing."

> MCP only exposes projects marked as public. Private projects remain inaccessible even if project IDs are known.

## Scope Keys

Scope Keys let you restrict `search_programs` to a curated collection of programs you've saved in [My Lists](/lists). Without a scope key, every public program is searchable — a scope key narrows results to only the programs in that list.

**How to use a scope key:**

1. Go to [My Lists](/lists), create a list, and add the programs you want to include.
2. Copy the scope key (`sk_…`) shown on the list.
3. Add it to your MCP client config as shown below.

**Claude Code / Cursor:**

```json
{
  "mcpServers": {
    "orquestra": {
      "type": "http",
      "url": "https://api.orquestra.dev/mcp",
      "headers": { "X-Scope-Key": "sk_your_scope_key_here" }
    }
  }
}
```

**Claude Desktop (via wrapper):**

```json
{
  "mcpServers": {
    "orquestra": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-streamable-http",
        "--header",
        "X-Scope-Key: sk_your_scope_key_here",
        "https://api.orquestra.dev/mcp"
      ]
    }
  }
}
```

You can regenerate a scope key at any time from My Lists — the old key stops working immediately. Regeneration does not affect the programs in the list.
