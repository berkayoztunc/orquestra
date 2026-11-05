My Program Lists let you save a hand-picked set of Solana programs and give your AI agent a **scope key** so it only discovers those programs. Instead of searching the whole registry, your agent works inside a small, trusted catalog that you control.

## What are program lists

A program list is a named collection of programs from the Orquestra registry. You manage your lists on the [My Lists](/lists) page (sign in with GitHub first).

- You can have any number of lists, for example "DeFi swaps", "My staking stack" or "Production only".
- Your first list is created as the **default** list. The **Save** button on any program page adds that program to it.
- Every list has its own **scope key**: a secret-looking token that starts with `sk_`.

A list on its own is just a bookmark folder. It becomes powerful when you pair its scope key with the MCP server.

## Why use them

The public registry holds thousands of programs, and most agent tasks only need a few. A scoped list gives you:

- **Focused search.** `search_programs` returns only the programs in your list, so the agent stops wandering across unrelated protocols.
- **Safer agents.** An agent that can only discover the programs you picked is much less likely to pick a look-alike or an unknown program by mistake. You decide the allowed set up front.
- **Better answers, fewer tokens.** Smaller result sets mean less noise for the model to read and fewer wrong turns.
- **One setup per project.** Keep a different list and scope key per app, team or environment, and switch by changing one header.
- **Easy revocation.** Regenerate a key and the old one stops working immediately.

## Create a list

1. Open [My Lists](/lists) and choose **New List**.
2. Enter a name (up to 100 characters) and an optional description.
3. Orquestra generates the scope key automatically. The first list you create becomes your default list.

You can rename a list or change its description at any time. Deleting a list removes the list and its entries, and its scope key stops working. The programs themselves are not affected.

## Add programs

There are two ways to fill a list:

- **From a program page:** press **Save**. With one list, the program goes into your default list. With several lists, pick which one in the **Add to list** menu.
- **From the API:** see the REST API section below.

Rules to know:

- Adding the same program twice to a list returns a `409` error ("Program is already in this list").
- Only **public** programs are ever returned to an agent, even if a private project was added to a list.
- You can remove a program from a list at any time. The change applies to the next search.

## Use the scope key with MCP

Copy the scope key (`sk_…`) from the list on [My Lists](/lists), then send it as the `X-Scope-Key` header in your MCP client config.

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

Now ask your agent something like: "Use orquestra to list the programs available to me." It will see only the programs in your list.

Behavior with a scope key:

| Call | Result |
| --- | --- |
| `search_programs` with a text `query` | Matches are limited to programs in your list. |
| `search_programs` with an exact `programId` | Returns the program only if it is in your list. |
| `search_programs` with no query | Returns everything in your list, sorted by weekly active users. |
| Invalid or regenerated key | Error: "Invalid scope key. Please check your X-Scope-Key header." |
| No `X-Scope-Key` header | Normal behavior: all public programs are searchable. |

## What a scope key does and does not do

A scope key is a **discovery filter**, not a permission system.

- It narrows what `search_programs` returns. That is its whole job.
- It does **not** block other tools. If an agent already knows a project ID, tools such as `list_instructions` or `build_instruction` still accept it. Keep your agent instructions explicit about which programs to use.
- It does **not** grant access to private projects or to anything that is not already public.
- It does **not** sign or send anything. Signing always stays on your side, in your signer.

Treat the key like any other configuration secret: keep it out of public repositories and screenshots. If it leaks, regenerate it.

## Regenerate or revoke a key

On [My Lists](/lists), choose **Regenerate** on a list. The new key is shown right away and the **old key stops working immediately**. Update every MCP client that used it. Regenerating does not change which programs are in the list.

To revoke access completely, delete the list.

## REST API

All list endpoints require authentication (`Authorization: Bearer <token>`) and only touch your own lists.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/lists` | List your lists with item counts and scope keys. |
| `POST` | `/api/lists` | Create a list. Body: `{ "name": "...", "description": "..." }`. |
| `PUT` | `/api/lists/{listId}` | Rename a list or change its description. |
| `DELETE` | `/api/lists/{listId}` | Delete a list and its entries. |
| `GET` | `/api/lists/{listId}/items` | List the programs in a list. |
| `POST` | `/api/lists/{listId}/items` | Add a program. Body: `{ "projectId": "..." }`. |
| `POST` | `/api/lists/default/items` | Add a program to your default list (created on demand). |
| `DELETE` | `/api/lists/{listId}/items/{projectId}` | Remove a program from a list. |
| `POST` | `/api/lists/{listId}/scope-key` | Regenerate the scope key. Returns `{ "scope_key": "sk_..." }`. |

```bash
# Create a list, then add a program to it
curl -X POST https://api.orquestra.dev/api/lists \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "DeFi swaps"}'

curl -X POST https://api.orquestra.dev/api/lists/{listId}/items \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"projectId": "PROJECT_ID"}'
```

## Troubleshooting

- **"Invalid scope key"**: the key was regenerated, the list was deleted, or the header has a typo. Copy the current key from My Lists.
- **Search returns nothing**: the list is empty, or the program is not in it. Add it, or remove the header to search everything.
- **A program is missing even though it is in the list**: only public programs are returned to agents.
- **The agent still uses a program outside the list**: the scope key only filters search. Tell the agent which programs it may use.
