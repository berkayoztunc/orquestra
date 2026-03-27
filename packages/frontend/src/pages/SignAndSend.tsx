import { useState } from 'react'
import { CheckIcon, CopyIcon, CodeIcon, BookOpenIcon, ZapIcon, SendIcon } from 'lucide-react'

type Language = 'typescript' | 'python' | 'rust'

const JS_CODE = `import {
  Connection,
  Transaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

async function signAndSendTransaction(base58Tx: string) {
  const { publicKey, signTransaction } = useWallet();
  if (!publicKey || !signTransaction) throw new Error("Wallet not connected");

  // 1. Decode the base58 transaction from the Orquestra API
  const txBytes = bs58.decode(base58Tx);
  const transaction = Transaction.from(txBytes);

  // 2. Set fee payer and fetch a fresh blockhash
  const connection = new Connection(
    clusterApiUrl("mainnet-beta"),
    "confirmed"
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

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

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  console.log("Transaction confirmed:", signature);
  return signature;
}

// --- Example: call the Orquestra API then send ---------------------

const API_BASE = "https://api.orquestra.build";

async function buildAndSend(
  programId: string,
  instruction: string,
  accounts: Record<string, string>,
  args: Record<string, unknown>,
  apiKey: string
) {
  // Call the Orquestra API to build the transaction
  const res = await fetch(
    \`\${API_BASE}/api/v1/programs/\${programId}/instructions/\${instruction}/build\`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ accounts, args, feePayer: "<YOUR_WALLET_PUBKEY>" }),
    }
  );

  const { transaction } = await res.json();
  return signAndSendTransaction(transaction);
}`

const PY_CODE = `import base58
import binascii
import requests
from solders.keypair import Keypair
from solders.transaction import Transaction
from solana.rpc.api import Client
from solana.rpc.types import TxOpts
from solana.rpc.commitment import Confirmed

API_BASE = "https://api.orquestra.build"


def build_transaction(
    program_id: str,
    instruction: str,
    accounts: dict,
    args: dict,
    fee_payer: str,
    api_key: str,
) -> str:
    """Call the Orquestra API and return the base58-encoded transaction."""
    url = f"{API_BASE}/api/v1/programs/{program_id}/instructions/{instruction}/build"
    resp = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
        json={"accounts": accounts, "args": args, "feePayer": fee_payer},
    )
    resp.raise_for_status()
    return resp.json()["transaction"]


def sign_and_send(base58_tx: str, signer: Keypair) -> str:
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
    # Load your keypair (never hardcode private keys in production!)
    import json, os

    keypair_path = os.path.expanduser("~/.config/solana/id.json")
    with open(keypair_path) as f:
        secret = json.load(f)
    signer = Keypair.from_bytes(bytes(secret))

    base58_tx = build_transaction(
        program_id="<PROGRAM_ID>",
        instruction="initialize",
        accounts={"authority": str(signer.pubkey()), "systemProgram": "11111111111111111111111111111111"},
        args={"amount": 1000000},
        fee_payer=str(signer.pubkey()),
        api_key="<YOUR_API_KEY>",
    )

    signature = sign_and_send(base58_tx, signer)
    print(f"Signature: {signature}")`

const RUST_CODE = `use anyhow::Result;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use serde_json::json;
use solana_client::{rpc_client::RpcClient, rpc_config::RpcSendTransactionConfig};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

const API_BASE: &str = "https://api.orquestra.build";

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
    program_id: &str,
    instruction: &str,
    accounts: serde_json::Value,
    args: serde_json::Value,
    fee_payer: &str,
    api_key: &str,
) -> Result<String> {
    let url = format!(
        "{API_BASE}/api/v1/programs/{program_id}/instructions/{instruction}/build"
    );
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
    let client = RpcClient::new_with_commitment(
        rpc_url.to_string(),
        CommitmentConfig::confirmed(),
    );

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
        RpcSendTransactionConfig {
            skip_preflight: false,
            ..Default::default()
        },
    )?;

    println!("Transaction confirmed: {signature}");
    Ok(signature.to_string())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load keypair from file (never hardcode private keys in production!)
    let keypair_path = shellexpand::tilde("~/.config/solana/id.json").to_string();
    let secret: Vec<u8> = serde_json::from_str(&std::fs::read_to_string(keypair_path)?)?;
    let signer = Keypair::from_bytes(&secret)?;

    let http = HttpClient::new();

    let base58_tx = build_transaction(
        &http,
        "<PROGRAM_ID>",
        "initialize",
        json!({ "authority": signer.pubkey().to_string(), "systemProgram": "11111111111111111111111111111111" }),
        json!({ "amount": 1_000_000u64 }),
        &signer.pubkey().to_string(),
        "<YOUR_API_KEY>",
    )
    .await?;

    let signature = sign_and_send(&base58_tx, &signer, "https://api.mainnet-beta.solana.com")?;
    println!("Signature: {signature}");
    Ok(())
}`

const LANG_META: Record<Language, { label: string; badge: string; deps: string[]; depLabel: string }> = {
  typescript: {
    label: 'TypeScript / JavaScript',
    badge: 'TS',
    deps: ['@solana/web3.js', '@solana/wallet-adapter-react', 'bs58'],
    depLabel: 'npm install',
  },
  python: {
    label: 'Python',
    badge: 'PY',
    deps: ['solana', 'solders', 'base58', 'requests'],
    depLabel: 'pip install',
  },
  rust: {
    label: 'Rust',
    badge: 'RS',
    deps: ['solana-client', 'solana-sdk', 'bs58', 'bincode', 'reqwest', 'tokio'],
    depLabel: 'Cargo.toml',
  },
}

const STEPS = [
  {
    icon: <CodeIcon className="w-5 h-5 text-primary" />,
    title: 'Build via API',
    desc: 'POST your accounts and args to the Orquestra endpoint — it returns a base58-encoded, unsigned transaction.',
  },
  {
    icon: <ZapIcon className="w-5 h-5 text-secondary" />,
    title: 'Decode & Sign',
    desc: 'Decode the base58 string into raw bytes, attach a fresh blockhash, then sign with your keypair or wallet.',
  },
  {
    icon: <SendIcon className="w-5 h-5 text-primary" />,
    title: 'Send & Confirm',
    desc: 'Submit the serialized signed transaction to a Solana RPC node and wait for confirmation.',
  },
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
        bg-white/5 border border-white/10 text-gray-400
        hover:bg-primary/10 hover:border-primary/30 hover:text-primary
        transition-all duration-200 select-none"
      title="Copy code"
    >
      {copied ? (
        <>
          <CheckIcon className="w-3.5 h-3.5" />
          Copied
        </>
      ) : (
        <>
          <CopyIcon className="w-3.5 h-3.5" />
          Copy
        </>
      )}
    </button>
  )
}

const CODE_MAP: Record<Language, string> = {
  typescript: JS_CODE,
  python: PY_CODE,
  rust: RUST_CODE,
}

export default function SignAndSend(): JSX.Element {
  const [lang, setLang] = useState<Language>('typescript')
  const meta = LANG_META[lang]
  const code = CODE_MAP[lang]

  return (
    <div className="animate-fade-in space-y-12">

      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="badge badge-primary text-xs">Docs</span>
          <span className="text-gray-600 text-xs">/</span>
          <span className="text-gray-400 text-xs font-mono">sign-and-send</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold">
          <span className="gradient-text">Sign &amp; Send</span>{' '}
          <span className="text-white">Transactions</span>
        </h1>

        <p className="text-gray-400 max-w-2xl leading-relaxed">
          The Orquestra API builds and serializes Solana transactions for you, returning them as a{' '}
          <code className="text-primary font-mono text-sm bg-primary/10 px-1.5 py-0.5 rounded">base58</code>{' '}
          string. Your client only needs to decode it, attach a fresh blockhash, sign, and broadcast.
          Below are copy-paste examples for every major ecosystem.
        </p>
      </div>

      {/* ── 3-step flow ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STEPS.map((step, i) => (
          <div key={i} className="card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-surface-elevated border border-white/5 flex items-center justify-center flex-shrink-0">
                {step.icon}
              </div>
              <span className="text-xs text-gray-600 font-mono">step {i + 1}</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm mb-1">{step.title}</p>
              <p className="text-gray-500 text-xs leading-relaxed">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── API endpoint reference ────────────────────────── */}
      <div className="card-static p-5 space-y-3">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="w-4 h-4 text-secondary" />
          <span className="text-sm font-semibold text-white">Build endpoint</span>
        </div>
        <div className="font-mono text-sm bg-surface-elevated border border-white/5 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
          <span className="text-secondary font-bold">POST</span>
          <span className="text-gray-300">
            /api/v1/programs/<span className="text-primary">&#123;programId&#125;</span>/instructions/<span className="text-primary">&#123;instruction&#125;</span>/build
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { label: 'X-API-Key', desc: 'Your Orquestra API key (header)' },
            { label: 'accounts', desc: 'Map of account name → base58 pubkey' },
            { label: 'args', desc: 'Instruction arguments as JSON values' },
          ].map((f) => (
            <div key={f.label} className="bg-surface-elevated rounded-lg p-3 border border-white/5">
              <p className="text-primary font-mono mb-0.5">{f.label}</p>
              <p className="text-gray-500">{f.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          The response JSON includes a{' '}
          <code className="text-primary font-mono bg-primary/10 px-1 rounded">transaction</code> field —
          a base58-encoded, unsigned Solana transaction message ready for signing.
        </p>
      </div>

      {/* ── Code examples ─────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Code examples</h2>

        {/* Language selector */}
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(LANG_META) as Language[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all duration-200 ${
                lang === l
                  ? 'bg-primary/10 border-primary/40 text-primary'
                  : 'bg-surface-elevated border-white/5 text-gray-400 hover:border-primary/20 hover:text-gray-200'
              }`}
            >
              <span
                className={`font-mono text-xs font-bold w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                  lang === l ? 'bg-primary/20 text-primary' : 'bg-white/5 text-gray-500'
                }`}
              >
                {LANG_META[l].badge}
              </span>
              {LANG_META[l].label}
            </button>
          ))}
        </div>

        {/* Dependencies pill */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-600">{meta.depLabel}</span>
          {meta.deps.map((d) => (
            <span key={d} className="font-mono bg-surface-elevated border border-white/5 text-gray-300 px-2 py-1 rounded-lg">
              {d}
            </span>
          ))}
        </div>

        {/* Code block */}
        <div className="rounded-2xl border border-white/5 overflow-hidden">
          {/* Code block header */}
          <div className="flex items-center justify-between px-4 py-3 bg-surface-elevated border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/40" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/40" />
                <div className="w-3 h-3 rounded-full bg-green-500/40" />
              </div>
              <span className="text-gray-500 text-xs font-mono ml-2">
                {lang === 'typescript' ? 'sign-and-send.ts' : lang === 'python' ? 'sign_and_send.py' : 'sign_and_send.rs'}
              </span>
            </div>
            <CopyButton text={code} />
          </div>

          {/* Code content */}
          <pre className="overflow-x-auto p-5 text-xs sm:text-sm leading-relaxed font-mono bg-surface text-gray-300 max-h-[600px] overflow-y-auto scrollbar-thin">
            <code>{code}</code>
          </pre>
        </div>
      </div>

      {/* ── Security note ─────────────────────────────────── */}
      <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5 space-y-2">
        <p className="text-yellow-400 font-semibold text-sm">Security reminders</p>
        <ul className="text-yellow-200/60 text-xs space-y-1.5 leading-relaxed list-disc list-inside">
          <li>Never hardcode private keys. Load them from environment variables or a secure keystore.</li>
          <li>Always fetch a fresh blockhash before signing — stale blockhashes cause transaction failures.</li>
          <li>
            Inspect the decoded transaction before signing to verify the program ID and accounts match
            what you expect.
          </li>
          <li>
            Keep your <code className="font-mono bg-yellow-500/10 px-1 rounded">X-API-Key</code> secret —
            treat it like a password and rotate it regularly.
          </li>
        </ul>
      </div>

      {/* ── Bottom links ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 pb-4">
        <a
          href="https://docs.solana.com/developing/clients/javascript-api"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-primary transition-colors underline underline-offset-4"
        >
          @solana/web3.js docs ↗
        </a>
        <a
          href="https://sola.rs/solana_sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-primary transition-colors underline underline-offset-4"
        >
          solana-sdk (Rust) docs ↗
        </a>
        <a
          href="https://kevinheavey.github.io/solders/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-primary transition-colors underline underline-offset-4"
        >
          solders (Python) docs ↗
        </a>
      </div>
    </div>
  )
}
