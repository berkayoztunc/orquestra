The Orquestra API builds and serializes Solana transactions for you, returning them as a `base58` string. Your client only needs to decode it, attach a fresh blockhash, sign, and broadcast. Below are copy-paste examples for every major ecosystem.

## Flow

1. **Build via API** — POST your accounts and args to the Orquestra endpoint, it returns a base58-encoded, unsigned transaction.
2. **Decode & sign** — decode the base58 string into raw bytes, attach a fresh blockhash, then sign with your keypair or wallet.
3. **Send & confirm** — submit the serialized signed transaction to a Solana RPC node and wait for confirmation.

## Build endpoint

```text
POST /api/{projectId}/instructions/{instructionName}/build
```

| Field | Description |
| --- | --- |
| `X-API-Key` | Your Orquestra API key (header) |
| `accounts` | Map of account name → base58 pubkey |
| `args` | Instruction arguments as JSON values |

The response JSON includes a `transaction` field — a base58-encoded, unsigned Solana transaction message ready for signing.

## Language examples

**TypeScript / JavaScript** — `npm install @solana/web3.js @solana/wallet-adapter-react bs58`

```typescript
import { Connection, Transaction, clusterApiUrl } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

async function signAndSendTransaction(base58Tx: string) {
  const { publicKey, signTransaction } = useWallet();
  if (!publicKey || !signTransaction) throw new Error("Wallet not connected");

  // 1. Decode the base58 transaction from the Orquestra API
  const txBytes = bs58.decode(base58Tx);
  const transaction = Transaction.from(txBytes);

  // 2. Set fee payer and fetch a fresh blockhash
  const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  transaction.feePayer = publicKey;
  transaction.recentBlockhash = blockhash;

  // 3. Sign with the user's wallet
  const signedTx = await signTransaction(transaction);

  // 4. Send and confirm
  const rawTx = signedTx.serialize();
  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  console.log("Transaction confirmed:", signature);
  return signature;
}

// --- Example: call the Orquestra API then send ---------------------

const API_BASE = "https://api.orquestra.dev";

async function buildAndSend(
  projectId: string,
  instructionName: string,
  accounts: Record<string, string>,
  args: Record<string, unknown>,
  apiKey: string
) {
  const res = await fetch(
    `${API_BASE}/api/${projectId}/instructions/${instructionName}/build`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ accounts, args, feePayer: "<YOUR_WALLET_PUBKEY>" }),
    }
  );

  const { transaction } = await res.json();
  return signAndSendTransaction(transaction);
}
```

**Python** — `pip install solana solders base58 requests`

```python
import base58
import requests
from solders.keypair import Keypair
from solders.transaction import Transaction
from solana.rpc.api import Client
from solana.rpc.types import TxOpts
from solana.rpc.commitment import Confirmed

API_BASE = "https://api.orquestra.dev"


def build_transaction(project_id, instruction_name, accounts, args, fee_payer, api_key):
    """Call the Orquestra API and return the base58-encoded transaction."""
    url = f"{API_BASE}/api/{project_id}/instructions/{instruction_name}/build"
    resp = requests.post(
        url,
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        json={"accounts": accounts, "args": args, "feePayer": fee_payer},
    )
    resp.raise_for_status()
    return resp.json()["transaction"]


def sign_and_send(base58_tx, signer):
    """Decode a base58 transaction, sign it, and send it to Solana."""
    client = Client("https://api.mainnet-beta.solana.com")

    # 1. Decode the base58 transaction from the Orquestra API
    tx_bytes = base58.b58decode(base58_tx)
    transaction = Transaction.from_bytes(tx_bytes)

    # 2. Fetch a fresh blockhash
    blockhash_resp = client.get_latest_blockhash(Confirmed)
    recent_blockhash = blockhash_resp.value.blockhash

    # 3. Sign — solders handles setting the blockhash on sign
    transaction.sign([signer], recent_blockhash)

    # 4. Send and confirm
    result = client.send_raw_transaction(
        bytes(transaction),
        opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed),
    )
    client.confirm_transaction(result.value, Confirmed)

    print(f"Transaction confirmed: {result.value}")
    return str(result.value)


if __name__ == "__main__":
    import json, os

    keypair_path = os.path.expanduser("~/.config/solana/id.json")
    with open(keypair_path) as f:
        secret = json.load(f)
    signer = Keypair.from_bytes(bytes(secret))

    base58_tx = build_transaction(
        project_id="<PROJECT_ID>",
        instruction_name="initialize",
        accounts={"authority": str(signer.pubkey()), "systemProgram": "11111111111111111111111111111111"},
        args={"amount": 1000000},
        fee_payer=str(signer.pubkey()),
        api_key="<YOUR_API_KEY>",
    )

    signature = sign_and_send(base58_tx, signer)
    print(f"Signature: {signature}")
```

**Rust** — `solana-client`, `solana-sdk`, `bs58`, `bincode`, `reqwest`, `tokio`

```rust
use anyhow::Result;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use solana_client::{rpc_client::RpcClient, rpc_config::RpcSendTransactionConfig};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

const API_BASE: &str = "https://api.orquestra.dev";

#[derive(Deserialize)]
struct BuildResponse {
    transaction: String, // base58-encoded transaction
}

#[derive(Serialize)]
struct BuildRequest<'a> {
    accounts: serde_json::Value,
    args: serde_json::Value,
    #[serde(rename = "feePayer")]
    fee_payer: &'a str,
}

/// Call the Orquestra API to build a transaction.
async fn build_transaction(
    http: &HttpClient,
    project_id: &str,
    instruction_name: &str,
    accounts: serde_json::Value,
    args: serde_json::Value,
    fee_payer: &str,
    api_key: &str,
) -> Result<String> {
    let url = format!("{API_BASE}/api/{project_id}/instructions/{instruction_name}/build");
    let body = BuildRequest { accounts, args, fee_payer };

    let resp = http
        .post(&url)
        .header("X-API-Key", api_key)
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json::<BuildResponse>()
        .await?;

    Ok(resp.transaction)
}

/// Decode a base58 transaction, sign it, and send it to Solana.
fn sign_and_send(base58_tx: &str, signer: &Keypair, rpc_url: &str) -> Result<String> {
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());

    // 1. Decode the base58 transaction from the Orquestra API
    let tx_bytes = bs58::decode(base58_tx).into_vec()?;
    let mut transaction: Transaction = bincode::deserialize(&tx_bytes)?;

    // 2. Fetch a fresh blockhash
    let recent_blockhash = client.get_latest_blockhash()?;

    // 3. Sign the transaction
    transaction.sign(&[signer], recent_blockhash);

    // 4. Send and confirm
    let signature = client.send_and_confirm_transaction_with_spinner_and_config(
        &transaction,
        CommitmentConfig::confirmed(),
        RpcSendTransactionConfig { skip_preflight: false, ..Default::default() },
    )?;

    println!("Transaction confirmed: {signature}");
    Ok(signature.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    let keypair_path = shellexpand::tilde("~/.config/solana/id.json").to_string();
    let secret: Vec<u8> = serde_json::from_str(&std::fs::read_to_string(keypair_path)?)?;
    let signer = Keypair::from_bytes(&secret)?;

    let http = HttpClient::new();

    let base58_tx = build_transaction(
        &http,
        "<PROJECT_ID>",
        "initialize",
        serde_json::json!({ "authority": signer.pubkey().to_string(), "systemProgram": "11111111111111111111111111111111" }),
        serde_json::json!({ "amount": 1_000_000u64 }),
        &signer.pubkey().to_string(),
        "<YOUR_API_KEY>",
    )
    .await?;

    let signature = sign_and_send(&base58_tx, &signer, "https://api.mainnet-beta.solana.com")?;
    println!("Signature: {signature}");
    Ok(())
}
```

## Security reminders

- Never hardcode private keys. Load them from environment variables or a secure keystore.
- Always fetch a fresh blockhash before signing — stale blockhashes cause transaction failures.
- Inspect the decoded transaction before signing to verify the program ID and accounts match what you expect.
- Keep your `X-API-Key` secret — treat it like a password and rotate it regularly.

## References

- [@solana/web3.js docs ↗](https://docs.solana.com/developing/clients/javascript-api)
- [solana-sdk (Rust) docs ↗](https://sola.rs/solana_sdk)
- [solders (Python) docs ↗](https://kevinheavey.github.io/solders/)
