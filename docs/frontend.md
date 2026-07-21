# Frontend — How It Works, How to Add, How to Use

Developer-facing guide to `packages/frontend`. For what the dashboard actually does as a product, see
[Dashboard](dashboard.md) — this doc is about the code, not the features.

## How it works

React 18 + TypeScript SPA, built with Vite, styled with Tailwind. No SSR — one `index.html`, client-side
routing.

```text
src/
  App.tsx        route table — the one place every page gets wired in
  main.tsx       entry point
  pages/         one file per route (Home.tsx, Dashboard.tsx, Explorer.tsx, ...)
  components/    feature components — use stores/API, carry business logic
  ui/            generic primitives — no business logic (Button, Card, Input, Badge, ...)
  api/client.ts  the ONLY place that talks to the backend — one exported function per endpoint
  store/         zustand stores, one per domain (auth.ts, projects.ts, lists.ts, analytics.ts)
  lib/           small standalone hooks/utilities (e.g. useIsDark.ts)
  content/docs/  static markdown content rendered by the /docs/* pages
```

**Routing** (`App.tsx`) has two layout shells:

- `<Layout>` — the main app chrome (header/footer/nav) — Home, Dashboard, Explorer, ProjectDetail,
  Analytics, Lists, Updates, Sync, auth callback/error, 404.
- `<DocsShell>` — the docs-site chrome, for `/docs/*` routes (CLI, MCP, API, Packages, SignAndSend
  docs pages).

Pick whichever shell matches what you're building; a page rendered under the wrong shell will look
wrong (missing nav, wrong sidebar, etc).

**API layer** (`api/client.ts`) is a single axios instance:

- `baseURL` from `VITE_API_URL`, defaults to `https://api.orquestra.dev/api`.
- Request interceptor attaches `Authorization: Bearer <token>` from `localStorage.getItem('token')` to
  every request automatically.
- Response interceptor: on `401`, clears the stored token/user and redirects to `/`; on any other
  error, attaches `err.toastMessage` so callers can surface it via the toast system without re-parsing
  the axios error shape themselves.
- Every backend call is a small exported function here (`listProjects`, `getProject`, `listUpdates`,
  …) — pages/components never call `axios`/`fetch` directly.

**State** (`store/*.ts`) is [zustand](https://github.com/pmndrs/zustand), one store per domain
(`useAuthStore`, `useProjectsStore`, `useProgramListsStore`, …). A store owns loading/error state and
calls into `api/client.ts` — components read state and call store actions, they don't call the API
layer directly unless the data is genuinely page-local (see `pages/Lists.tsx` for an example that mixes
both: shared list data from the store, page-local UI state like `showNewListModal` via `useState`).

**Path aliases** (both `vite.config.ts` and `tsconfig.json`, keep them in sync if you ever change one):

- `@/*` → `src/*`
- `@shared/*` → `packages/shared/src/*`

**Auth**: GitHub OAuth. `getGitHubLoginUrl()` builds the redirect URL, the backend completes the OAuth
dance and redirects back to `/auth/callback` with a token, which gets stored in `localStorage` and
picked up by the axios interceptor from then on. `useAuthStore().initialize()` runs once on app mount
(in `App.tsx`) to restore session state from the stored token.

## How to use (local dev)

```bash
# from repo root — runs worker (8787) + frontend (5173) together
bun run dev

# frontend only
bun run dev:frontend
```

The dev server's proxy config (`vite.config.ts`) points `/api`, `/project/*/llms.txt`, and
`/auth/github` at `http://api.orquestra.dev` **by default** — not your local worker. To develop
against a local worker instead, set env vars before starting Vite (create `packages/frontend/.env.local`,
Vite loads `.env*` files automatically and it's already gitignored):

```bash
# packages/frontend/.env.local
VITE_API_URL=http://localhost:8787/api
VITE_WORKER_URL=http://localhost:8787
```

Other scripts (run from `packages/frontend`, or via the root's `bun --cwd packages/frontend run <script>`):

```bash
bun run build        # tsc --noEmit && vite build -> dist/
bun run preview       # serve the production build locally
bun run type-check     # tsc --noEmit only
bun run lint            # eslint src --ext .ts,.tsx
bun run lint:fix
```

Deploying: see [Deployment](deployment.md) (`bun run deploy:pages`, or `bun run deploy` for
everything).

## How to add things

### Add a page

1. Create `src/pages/MyPage.tsx`, default-export a component.
2. Add a `<Route>` in `App.tsx`, inside `<Layout>` or `<DocsShell>` depending on which chrome it needs.
3. If it should be reachable from the nav, add a link in `components/Header.tsx` (`NavLink to="..."`).

### Add a backend call

1. Add an exported function in `src/api/client.ts` that uses the shared `api` axios instance (or the
   auth-specific pattern at the top of that file for unauthenticated/`AUTH_BASE` calls). One function
   per endpoint, typed request params and return shape.
2. If the data needs to be shared/cached across components, wrap the call in a store action
   (`store/*.ts`) and read it from there. If it's genuinely page-local, call it directly from the page
   with local `useState`/`useEffect` (see `pages/Lists.tsx` for the mixed pattern).

### Add shared state

New file in `src/store/`, following the existing `create<StateShape>((set, get) => ({ ... }))`
zustand pattern (see `store/projects.ts` for the fullest example — loading flags, pagination, and
error state alongside the data itself).

### Add a component

- **`ui/`** — generic, no business logic, no store/API imports. Takes props, returns markup +
  Tailwind classes. (`Button`, `Card`, `Input`, `Badge`, …) Look at `ui/Button.tsx` for the
  variant/size-map pattern most primitives here follow.
- **`components/`** — feature-specific, can import stores and `api/client.ts`, can be business-logic
  heavy. (`IDLUpload`, `InstructionExplorer`, `PDAExplorer`, …)

### Styling

Tailwind utility classes directly in JSX. Use `cn(...)` (from `src/ui/cn.ts`, a thin `clsx` wrapper)
to merge/conditionally apply classes rather than manual template-string concatenation. Custom design
tokens (not stock Tailwind colors) are defined in `tailwind.config.*` as CSS-variable-backed colors —
`sand-{50..1600}` (the primary palette scale), `bg1`, `border-{low,medium,strong}`, etc. Use those
tokens instead of arbitrary hex values so light/dark theme switching (`lib/useIsDark.ts`,
`ui/ThemeToggle.tsx`) keeps working.

### Feedback / errors

Use `useToast()` (from `components/Toast.tsx`) to surface success/error messages — the axios
interceptor already attaches `err.toastMessage` to API errors, so a typical catch block is just
`showToast(err.toastMessage ?? 'Something went wrong', 'error')`.
