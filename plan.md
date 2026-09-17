# Testeria — Product Plan & Roadmap

> Companion to `context.md` (architecture, conventions, gotchas). This file tracks WHERE the
> product is going and in what order. Update the Status column as work lands.
> Last updated: 2026-09-17 · v0.1 shipped at commit `68c80ca`

## Product thesis (fixed — don't drift)

For lazy fullstack devs: **compose E2E flows fast → run them → watch the web under test → get
video proof.** A feature with a small scope but a long manual ritual (login → create dummy data →
click through) should be testable in minutes without touching a browser by hand.

### Non-negotiables

1. **Honest runner** — never fake/simulate results. Unreachable target = FAIL with a clear message.
   (The old mock simulator was deleted on purpose. Do not reintroduce it.)
2. **No AI required** — the tool is 100% useful with zero tokens. AI, if ever added, is optional sugar.
3. **Minimal UI** — few screens; a UI that confuses the user is a bug. Flow-based E2E is the model:
   tests are NOT per-endpoint units; they call endpoints/UI from a shared list and chain variables.
4. **Local-first** — SQLite + local files (`data/`), no external services, no accounts.

## Current state (v0.1 — done)

| Area | Status |
|---|---|
| Express + SQLite persistence (projects, endpoints, flows, runs) | ✅ done |
| OpenAPI 3 / Swagger 2 import (JSON/YAML, `$ref`, sample bodies) | ✅ done |
| Flow editor: API + UI steps, variable extraction (`{{var}}`), assertions | ✅ done |
| Error branches: trigger step/status/contains → recovery → retry/continue/abort | ✅ done |
| Playwright UI steps + optional video recording (`data/videos/*.webm`) + player | ✅ done |
| Runs history (newest first, expandable results) | ✅ done |
| Light/dark minimal 5-tab UI (Endpoints · Flows · Run · History · Settings) | ✅ done |
| UX fixes: flow picker on Run tab, delete flow, no keystroke-eating JSON inputs, StrictMode-safe autorun | ✅ done |
| Verified live: jsonplaceholder API flow, example.com UI flow + `.webm`, error-branch regression | ✅ done |

## Roadmap

Order reflects user value vs effort. Pick from the top unless the user says otherwise.

### Phase 1 — Flow power (next up, highest value/effort ratio)

| # | Task | Why | Status |
|---|---|---|---|
| 1.1 | **Extract text/attr from UI steps into variables** — extend `Extraction` (`from: 'page'`) with selector-based `textContent`/`attribute` so a flow can grab e.g. an order ID shown on the page and feed later API/UI steps | Core promise "small feature, long flow" often needs values that only exist in the UI | ☐ todo |
| 1.2 | **Duplicate flow & duplicate step** — one-click copy for iterating variants (happy path → negative case) | Fast authoring is the product | ☐ todo |
| 1.3 | **Run single step / from-step** — re-run a failing step without replaying the whole flow | Debugging long flows is painful otherwise | ☐ todo |
| 1.4 | **cURL / request paste → API step** — paste a cURL command, parse into method/path/headers/body | Laziest possible API-step authoring | ☐ todo |
| 1.5 | **Flow-level variables & seed data** — predefine `{{email}}`, `{{password}}` etc. per flow instead of hardcoding in steps | Reuse + less editing when values rotate | ☐ todo |

### Phase 2 — Evidence & reporting

| # | Task | Why | Status |
|---|---|---|---|
| 2.1 | **Export run report** — HTML report (steps, screenshots, video link) and/or JUnit XML for CI | Video proof is the flagship; make it shareable | ☐ todo |
| 2.2 | **History filter per flow** + status filter | Grows useful as runs accumulate | ☐ todo |
| 2.3 | **Failure screenshots gallery in Run view** — already captured on UI failure; surface them better | See what broke without opening the video | ☐ todo |
| 2.4 | **Video trim/size notes** — cap recording length, show file size | Long flows → big files | ☐ todo |

### Phase 3 — Flow recorder (user said "later", design first)

| # | Task | Why | Status |
|---|---|---|---|
| 3.1 | **Record browser session → steps**: Playwright-injected recorder page; clicks/fills map to `UiAction[]`, network calls map to API steps | Laziest authoring of UI flows; matches the original "flow recorder" ask | ☐ design → build |
| 3.2 | Recorder polish: selector strategy (data-testid → role → css), wait auto-insertion | Recorded steps must not be brittle | ☐ todo |

### Phase 4 — Case generation (rule-based, no AI)

| # | Task | Why | Status |
|---|---|---|---|
| 4.1 | **Per-endpoint case generator**: from an endpoint + schema, emit happy/negative/boundary steps as drafts into a flow | Original app had this; user liked it but wants flows, so generate *into* a flow context | ☐ todo |
| 4.2 | OpenAPI import improvements: request examples, securitySchemes → header presets | Better defaults for generated steps | ☐ todo |

### Phase 5 — Scale & ops (only when needed)

| # | Task | Why | Status |
|---|---|---|---|
| 5.1 | Multiple browsers (firefox/webkit) + viewport presets | Cross-browser proof | ☐ todo |
| 5.2 | Scheduled/batch runs (run all flows in a project) | Regression mode | ☐ todo |
| 5.3 | Secrets handling (mask values in reports/videos) | Tokens appear in flows today | ☐ todo |
| 5.4 | Hosting note: full product needs a Node runtime (Playwright + SQLite). Freebuff prod serves static SPA — see context.md. Options: separate worker service, or self-host | Decide before promising a hosted version | ☐ decision pending |

## Explicitly out of scope (for now)

- **AI/LLM anything** — optional enhancement only after Phases 1–3 feel complete. Never a dependency.
- Multi-user auth/workspaces — single local user is the product.
- Rewriting to Convex/Next/other stacks — the Express+SQLite+Playwright shape fits the problem.

## Definition of done (per task)

1. `npx tsc -b --noEmit` clean.
2. Manual verification through the real API/UI (no mocks) — e.g. curl the run endpoint and check
   the stored RunRecord, or click through the preview.
3. Honest-runner invariant preserved: introduced failure paths fail loudly.
4. UI stays minimal: no new tabs for small features; extend existing views.
5. Update this file's Status column + `context.md` if architecture changed.
