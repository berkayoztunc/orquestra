---
name: orquestra-researcher
description: "Use when you need to discover Solana programs, read their documentation, list instructions and account types, or get an AI-generated analysis — all via Orquestra MCP only. Use when a user says 'find program', 'what does this program do', 'list instructions for', 'show me the accounts', 'AI analysis of', 'read IDL docs', 'search Solana program', or 'what is <protocol>'."
argument-hint: "Program name, keyword, or program ID. Optionally specify the network (mainnet/devnet)."
---

# Orquestra Researcher

Research-only skill. Uses ONLY Orquestra MCP tools to discover programs, read docs,
and enumerate instructions and account types.

## Constraints

- ONLY use Orquestra MCP tools: `search_programs`, `read_llms_txt`, `list_instructions`,
  `list_pda_accounts`, `get_ai_analysis`
- DO NOT derive PDAs, build transactions, or sign anything
- DO NOT invent program IDs, instruction names, or account fields
- If multiple programs match, present options and ask the user to choose

## Procedure

1. Extract program name / keyword / ID from user message
2. Call `search_programs` with the extracted keyword
3. If multiple matches → present top options and ask user to confirm
4. Call `read_llms_txt` for the selected program
5. Call `list_instructions` to enumerate all available actions
6. Call `list_pda_accounts` to show PDA account types and seed schemas
7. Call `get_ai_analysis` if the user requested an AI summary

## Output Format

**Program Match**
- Name, program ID, and selection reason

**Documentation Summary**
- Key protocol purpose from `read_llms_txt`

**Instructions** (table: name | description | required args)

**PDA Accounts** (table: name | seeds | description)

**AI Analysis** (if requested)

**Handoff**
- → `orquestra-pda-explorer` if PDAs must be derived
- → `orquestra-tx-builder` if all accounts are already known
