# Testeria — Project Context

> Handoff doc for AI agents / new sessions. Read this before touching code.
> Last updated: 2026-09-17

## What this is

Testeria is a local QA tool for a fullstack developer who hates manually logging into web apps,
creating dummy data, and testing small features with long flows. The core loop:

**Build endpoint list → compose E2E flows (API + UI steps, with error branches) → Run (optionally
recorded) → watch video proof → inspect history.**

- **AI is intentionally absent.** The tool must be 100% functional with no AI tokens. (The old
  Gemini-based version was deleted. The README's "Test Agent AI with cache tool calling" line is legacy.)
- **The runner is honest.** No mock/simulator. If the target server is unreachable, the test FAILS
  with a clear message. This is a core product value — never re-introduce canned responses.
- **UI direction: clean, minimal, light default + dynamic dark mode.** The user explicitly wants
  FEW screens — a confusing UI is considered a bug.

## Stack

- Backend: **Express + SQLite (`better-sqlite3`)**, TypeScript, run via **tsx** (`node_modules/.bin/tsx server.ts`)
- Frontend: **React 18 + Vite 6 + Tailwind CSS 4** (via `@tailwindcss/vite`), `lucide-react` icons
- UI testing: **Playwright** (chromium installed, system deps installed via `playwright install-deps`)
- Package manager: **Bun** for installs, but **the server must run under Node** (see Gotchas)

## Repository layout

```
server.ts                  # Express app: REST API + Vite middleware (dev) / static dist (prod)
server/
  storage.ts               # SQLite store (data/testeria.db): projects, endpoints, flows, runs; videos in data/videos/
  openapiImporter.ts       # Rule-based OpenAPI 3 / Swagger 2 importer (JSON/YAML, $ref resolve, {id}→:id, sample bodies)
  runnerService.ts         # The engine: API steps (fetch) + UI steps (Playwright), error branches, video recording
src/
  types.ts                 # ALL shared domain types — single source of truth
  api.ts                   # Tiny fetch wrapper over the REST API
  App.tsx                  # Shell: project switcher, nav tabs, state owner
  index.css                # Tailwind 4 entry, light/dark tokens, scrollbars
  components/
    ui.tsx                 # Shared primitives: Button, Field, Modal, JsonField, LazyInput, StatusPill, EmptyState
    ThemeToggle.tsx        # Light/dark toggle (localStorage)
    EndpointsView.tsx      # Endpoint list, manual CRUD, OpenAPI/Swagger import dialog
    FlowEditorView.tsx     # Flow CRUD + step editor (API/UI) + error-branch editor with trigger-step selector
    RunView.tsx            # Flow picker, run (record checkbox), step results, video player + download
    RunsHistoryView.tsx    # Past runs (newest first), expandable step details, open in Run view
    SettingsView.tsx       # Per-project baseUrl (API) + uiBaseUrl (web under test)
```

## Data model (src/types.ts)

- **Project**: `name`, `baseUrl` (API), `uiBaseUrl?` (web under test)
- **Endpoint**: `method`, `path` (`:param` style), `querySchema?`, `bodySchema?` (sample body), `headers?`
- **Flow**: ordered `FlowStep[]` + `ErrorBranch[]`
- **FlowStep**: `type: 'api' | 'ui'`
  - api: uses `endpointId` OR raw `method`+`path`; `headers`, `body`; `{{var}}` templating
    (path/headers/body) resolved from a shared run context
  - ui: `actions: UiAction[]` — goto / click / fill / press / wait / assertText / screenshot
  - both: `extract?: Extraction[]` (from `status|body|text|page` → context var),
    `expect?: Expectation` (`status[]`, `bodyContains[]`, `selector` visible/hidden)
- **ErrorBranch**: matches a failed step by `triggerStepId?` (undefined = any step) + `whenStatus?`
  + `whenContains?`; runs its own `steps[]` (same FlowStep shape), then `then: 'retry' | 'continue' | 'abort'`
- **RunRecord**: step results (nested `branchResults`, `retried` flag), `videoPath?` when recorded

UI-step extraction currently supports only `from: 'page'` with `path: 'url'` (element-text
extraction is future work).

## REST API (all under /api)

- `GET /health`
- Projects: `GET/POST /projects`, `GET/PUT/DELETE /projects/:id`
- Endpoints: `GET/POST /projects/:id/endpoints`, `PUT/DELETE /endpoints/:id`
- `POST /projects/:id/import-endpoints` `{ rawContent }` — **replaces** the project's endpoint list
- Flows: `GET/POST /projects/:id/flows`, `GET/PUT/DELETE /flows/:id`
- `POST /flows/:id/run` `{ record?: boolean }` → `RunRecord` (synchronous long request; UI steps take seconds)
- Runs: `GET /projects/:id/runs?limit=`, `GET /runs/:id`
- `GET /videos/:file` — streams recorded `.webm` from `data/videos/`

## Runner semantics (server/runnerService.ts)

1. Steps run sequentially, sharing a mutable variable context (extracted values; `{{var}}` templating).
2. API step: real `fetch` against `project.baseUrl` (15s timeout). Unreachable target = failed step.
3. UI step: real Playwright chromium against `project.uiBaseUrl` (8s per action). Screenshot
   (data URL) captured on failure and on explicit `screenshot` actions.
4. On step failure: matching error branch (triggerStepId / whenStatus / whenContains) runs its
   steps, then retry / continue / abort. Branch results nest under the failed step; retried steps
   get `retried: true`.
5. `record: true` → Playwright context records video (only when the flow has UI steps) →
   `data/videos/<runId>.webm`, served via `/api/videos/`.
6. Every run is stored in SQLite regardless of pass/fail.

## Frontend conventions

- One working screen, 5 tabs: **Endpoints · Flows · Run · History · Settings**. No router —
  `activeView` state in `App.tsx`; all app state lives there, views take props + callbacks.
- Tailwind 4 utilities, zinc palette; light is default, `.dark` class on root (`ThemeToggle`,
  persisted in localStorage `testeria-theme`).
- JSON textareas use **`JsonField`** (src/components/ui.tsx): keeps raw keystrokes while editing,
  validates on blur, only commits parsed JSON — controlled inputs that revert while typing "eat
  keystrokes" (real user complaint that got fixed). Same pattern for `LazyInput` (number lists).
- `RunView` triggers runs from `useEffect` with a ref guard per nonce (React StrictMode
  double-render safety) — never run effects from the render body.

## Platform / environment notes (Freebuff workspace)

- Preview commands registered with the platform:
  - install: `bun install`
  - dev/preview: `node_modules/.bin/tsx server.ts` on port **3000** (binds 0.0.0.0; honors `PORT` env)
  - build: `vite build`
- `.env` / `.env.local` are auto-loaded into terminal + preview processes. **No external service
  keys are required** — the app is fully local.
- Do NOT start/stop preview servers manually (no `bun run dev` / `vite` / `kill`); use
  `freebuff-preview start|restart|status|logs`.
- The preview process runs in a separate namespace from the agent shell: `curl localhost:3000`
  from the shell may fail even when the preview is healthy. Verify via the preview URL, or spin a
  temporary in-shell server (start → curl → kill in ONE command) for API tests.

## Gotchas (learned the hard way)

- **`better-sqlite3` crashes under the Bun runtime** (NAPI fatal). Always run the server with
  Node (`tsx server.ts`), never `bun server.ts`.
- **js-yaml v5 is ESM-only**: `import * as yaml from 'js-yaml'` + `yaml.load(...)` — a default
  import breaks at runtime.
- Typecheck is `npx tsc -b --noEmit` (aka `npm run lint`). No test framework configured;
  verification so far = manual API runs via curl + typecheck.
- Deployed files lose the executable bit → invoke scripts as `sh ./scripts/foo.sh`, never `./scripts/foo.sh`.
- `core` (6.7 GB core dump from the old Bun crash) sits untracked in the repo root; it is
  gitignored and safe to delete.
- `tsconfig.tsbuildinfo` is a build artifact (gitignored too).

## Verified state (as of last session)

- `tsc -b --noEmit` clean.
- API flow tested live against jsonplaceholder: import → 2-step flow with variable extraction → passed.
- UI flow tested live against example.com with `record: true`: Playwright step passed, `.webm`
  video written to `data/videos/` and served.
- Error-branch regression: step failing 404 → matching branch (trigger step + status) → recovery
  ran → `continue`. Verified.
- UX fixes verified: Run tab has a flow picker; delete-flow button exists; EmptyState has a create
  action; JSON inputs no longer eat keystrokes; a run fires exactly once per action.

## Roadmap ideas (discussed, not built)

- Extract element text from UI steps into variables (`from: 'page'`, selector-based) — e.g. grab
  an order ID off a page.
- Flow recorder (capture real clicks in a browser → steps) — user said "later".
- History filter per flow.
- Rule-based per-endpoint test-case generation (the original app had it; current version dropped
  it for simplicity).

## User preferences

- Conversation language: Indonesian (code/docs in English are fine).
- Minimal, efficient UI — few screens, no confusing extras.
- Hates fake/mock results; honesty of the runner is a selling point.
- Wants decisions surfaced before big architectural changes.
