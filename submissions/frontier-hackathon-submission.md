# Orquestra - Frontier Hackathon Submission

## Brief description

Orquestra is the hosted interface layer for Solana programs. Upload an Anchor or Codama IDL and it generates REST endpoints, AI-readable docs, and MCP tools that let humans, servers, and agents inspect instructions, derive PDAs, decode accounts, simulate calls, and build unsigned transactions. It turns a deployed program into something any backend or AI agent can integrate.

Characters: 376 / 500

## What are you building, and who is it for?

Orquestra turns a Solana program IDL into a hosted integration layer. A team uploads an Anchor or Codama IDL and gets a public project page, generated docs, REST endpoints, and MCP tools for the program. From that interface, developers and agents can search programs, inspect instructions, understand account schemas, derive PDAs from seed metadata, query and decode program accounts, simulate calls, and build unsigned transactions from JSON inputs.

It is for Solana protocol teams that want their programs easier to integrate, backend and fintech developers who prefer REST over custom Anchor SDK work, and AI agents that need structured tools before they can safely act on-chain. Orquestra deliberately does not custody funds or sign transactions. It builds, explains, and simulates; wallets or signer MCPs handle final user approval.

Characters: 838 / 1000

## Why did you decide to build this, and why build it now?

I built Orquestra because Solana programs are too hard to integrate after the contract is already live. The IDL contains the interface, but every new integrator still has to read scattered docs, learn account derivation, serialize arguments, decode errors, and rebuild the same glue code. That slows down protocols, backend teams, and AI agents that should be able to use public programs safely.

Now is the right time because Solana has more production programs, Codama is strengthening IDL standards, and AI coding agents are becoming a real developer interface through MCP. Frontier has no tracks or bounties, so the strongest submission is a startup-scale product with clear infrastructure leverage. Orquestra is that layer: upload an IDL once and make the program understandable, callable, and safer to automate for humans, servers, and agents.

Characters: 849 / 1000

## Short positive explanation for optional fields

Orquestra is already more than a concept: the repo includes the dashboard, Cloudflare Worker API, generated program routes, MCP server, agent skill contracts, tests, and deployment docs. Frontier is the right venue because the product helps every Solana program become easier to discover, document, and automate.

Characters: 312

## Judge-Facing Links

Website: `https://orquestra.dev`

Production API: `https://api.orquestra.dev`

MCP endpoint: `https://api.orquestra.dev/mcp`

GitHub: `https://github.com/berkayoztunc/orquestra`

## Roast Stress Test Summary

Internal verdict: the product is strong infrastructure, but the submission dies if it sounds like another IDL explorer. The form copy must make the hosted interface layer, AI/MCP angle, and safety boundary obvious immediately.

Top fixes applied:

- Reframed Orquestra as the "hosted interface layer" instead of only a feature list.
- Named the exact users: protocol teams, backend and fintech developers, and AI agents.
- Added the safety boundary: Orquestra builds, explains, and simulates; wallets or signer MCPs approve and sign.
- Tied timing to Solana production programs, Codama IDL standards, MCP, and Frontier's no-track startup focus.
- Avoided unverifiable traction or revenue claims.
