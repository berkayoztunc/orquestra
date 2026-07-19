# Published Packages

Orquestra publishes companion npm packages for signing Solana transactions, separate from the core hosted MCP server at `https://api.orquestra.dev/mcp`.

## `@orquestradev/signer-mcp`

[npmjs.com/package/@orquestradev/signer-mcp](https://www.npmjs.com/package/@orquestradev/signer-mcp)

MCP server for signing Solana transactions and messages using any backend supported by [`@solana/keychain`](https://github.com/solana-foundation/solana-keychain). This is what powers the `orquestra-signer` agent skill — see [Agent Skills](./agent-skills.md).

**Install:**

```bash
npm i @orquestradev/signer-mcp
```

**MCP client config:**

```json
{
  "mcpServers": {
    "solana-signer": {
      "command": "npx",
      "args": ["-y", "@orquestradev/signer-mcp"],
      "env": {
        "KEYCHAIN_BACKEND": "memory",
        "KEYCHAIN_PRIVATE_KEY": "<your-base58-private-key>",
        "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
      }
    }
  }
}
```

`SOLANA_RPC_URL` sets the default RPC endpoint used by `sign_and_send_transaction`; it can be overridden per-call via `rpcUrl` in the tool arguments.

**Supported backends:**

| `KEYCHAIN_BACKEND` | Required env vars | Optional package |
| --- | --- | --- |
| `memory` | `KEYCHAIN_PRIVATE_KEY` | _(bundled)_ |
| `privy` | `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_ID` | `@solana/keychain-privy` |
| `turnkey` | `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`, `TURNKEY_SIGN_WITH` | `@solana/keychain-turnkey` |
| `aws-kms` | `AWS_KMS_KEY_ID`, `AWS_REGION` | `@solana/keychain-aws-kms` |
| `gcp-kms` | `GCP_PROJECT_ID`, `GCP_LOCATION_ID`, `GCP_KEY_RING_ID`, `GCP_CRYPTO_KEY_ID`, `GCP_CRYPTO_KEY_VERSION_ID` | `@solana/keychain-gcp-kms` |
| `fireblocks` | Fireblocks API credentials | `@solana/keychain-fireblocks` |
| `dfns` | Dfns API credentials | `@solana/keychain-dfns` |
| `crossmint` | `CROSSMINT_API_KEY`, `CROSSMINT_WALLET_LOCATOR` | `@solana/keychain-crossmint` |
| `openfort` | `OPENFORT_SECRET_KEY`, `OPENFORT_ACCOUNT_ADDRESS` | `@solana/keychain-openfort` |
| `para` | `PARA_API_KEY`, `PARA_WALLET_ID`, `PARA_USER_SHARE` | `@solana/keychain-para` |

Non-memory backends require their optional package to be installed alongside this package, e.g.:

```bash
npm install @orquestradev/signer-mcp @solana/keychain-privy
```

## `@orquestradev/n8n-nodes-solana-signer`

[npmjs.com/package/@orquestradev/n8n-nodes-solana-signer](https://www.npmjs.com/package/@orquestradev/n8n-nodes-solana-signer)

n8n community node exposing Solana signing as workflow operations, using the same [`@solana/keychain`](https://github.com/solana-foundation/solana-keychain) backends as `signer-mcp`.

**Operations:**

- **Get Wallet Address** — return the public key for a configured signer
- **Sign Message** — sign arbitrary UTF-8 messages
- **Sign Transaction** — sign a base64-encoded Solana transaction (wire format)
- **Send Transaction** — sign + broadcast to any Solana RPC endpoint, return tx signature

**Install (self-hosted n8n):**

```bash
cd ~/.n8n/custom
npm install @orquestradev/n8n-nodes-solana-signer
# Restart n8n
```

**Supported backends:**

| Backend | Use case |
| --- | --- |
| Memory (Local Keypair) | Dev/automation, base58 or JSON-array private key |
| HashiCorp Vault | Enterprise secrets management |
| AWS KMS | AWS-managed key signing |
| GCP KMS | Google Cloud-managed key signing |
| Privy | Privy embedded wallet |
| Turnkey | Turnkey MPC wallet |
| Fireblocks | Fireblocks institutional custody |
| Coinbase CDP | Coinbase Developer Platform wallet |
| Dfns | Dfns MPC wallet |
| Crossmint | Crossmint wallet |
| Openfort | Openfort backend wallet |
| Para MPC | Para MPC wallet |
| Utila | Utila wallet |

Each backend uses its own credential type — create credentials in n8n under **Credentials → New**.
