# bconnect Wi-Fi Integration Dashboard

A full-stack integration dashboard simulating how bconnect ingests data from
third-party Wi-Fi controllers, normalises it into a unified data model, and
surfaces AI-generated insights for venue operators.

---

## What this is

bconnect's core product connects to Wi-Fi controllers (Cisco Meraki, Unifi, etc.)
across multiple venues, pulls session data, and makes it useful. This project
simulates that pipeline end-to-end — from a mock controller API through to a
React dashboard with AI-powered insights.

**The one-line version:**
Mock controller (normal / flaky / down modes, shaped after Meraki's API) feeds a
FastAPI pipeline that validates fields, upserts venues/APs/sessions in a single
batched transaction (3 SQL statements, ~1.4s), retries transient failures with
exponential backoff, and writes every sync result to an append-only log with the
raw payload. React dashboard renders live charts (device breakdown, AP drill-down,
peak hours), paginated session and sync-history tables, and structured Gemini
insights per venue — all in collapsible cards with localStorage-persisted state.
Six pytest integration tests cover idempotency, retry, failure modes, health, and
API validation. Docker Compose runs the full stack (Postgres + API + UI) in one command.

---

## Architecture

**Backend:** FastAPI with Pydantic response models (`backend/schemas.py`) on every
endpoint — typed contracts in OpenAPI docs, response validation at serialisation,
and ORM objects returned directly where possible. Query params use FastAPI's
`Query(ge=, le=)` validators; sync `mode` is typed as `Literal["normal", "flaky", "down"]`
so invalid values return 422 automatically.

**Database:** PostgreSQL — four tables: venues, access_points, sessions, sync_logs.
Docker Compose runs a local Postgres 15 container for reviewers (no external accounts).
Supabase remains an option for non-Docker local dev (see `.env.example`). Tables and
indexes are created on startup via `Base.metadata.create_all()`.

**Mock controller:** A single Python function shaped after Cisco Meraki's network
API structure (`network_id` for sites, MAC for devices). Venues and access points
are stable across syncs. Sessions are randomly generated each call with realistic
duration distributions per venue type, so data accumulates naturally and the AI
insights improve over time. The controller also accepts a `mode` parameter
(`normal` / `flaky` / `down`) to simulate real-world failure scenarios for testing.

**Frontend:** React with Vite — lean component split (`App.jsx`, `CollapsibleCard.jsx`,
`SessionCharts.jsx`), no state management library, Vercel-inspired design system.
Card collapse state is persisted to `localStorage` so the dashboard remembers your
layout across refreshes.

**AI:** Gemini Flash — session data is aggregated into per-venue statistics
(count, avg duration, peak day/hour, % short/long sessions) and sent as a
structured prompt requesting JSON output. Gemini returns four fields per venue:
`summary`, `peak_time`, `pattern`, `action`. If no `GEMINI_API_KEY` is set,
the endpoint returns realistic sample insights so reviewers can explore the UI
without signing up for an API key.

---

## Key decisions

### Upsert over check-then-insert
All three entity types use `ON CONFLICT DO UPDATE` (venues, access_points) or
`ON CONFLICT DO NOTHING` (sessions). This makes every sync idempotent — you can
run it 100 times and the database stays clean. A check-then-insert pattern has a
race condition window; upsert is atomic at the database level.

### External IDs as conflict keys
Venues use `network_id` (the controller's identifier), not name. Names change.
Access points use MAC address — globally unique in real hardware. Sessions use
`(client_mac, connected_at)` — the same device can connect many times, but never
twice at the same millisecond.

### Batch upserts, not per-row inserts
The first version of the sync inserted each record individually — ~70 round trips
for a typical payload, taking ~13 seconds. The current version groups all rows for
each entity type into a single `INSERT ... ON CONFLICT` statement, reducing it to
3 database calls regardless of payload size. Sync now completes in ~1.4 seconds on
warm connections. The batching is implemented using SQLAlchemy's `insert()` with
`.on_conflict_do_update()` / `.on_conflict_do_nothing()`, which generates the
correct dialect-specific SQL for both PostgreSQL (production) and SQLite (tests).

### Transaction wrapping the full upsert loop
All three upserts run in a single transaction. A partial sync (venues written,
sessions failed) would leave the database in an inconsistent state. Rollback on
any failure ensures the database is never half-written.

### Retry with exponential backoff
The sync function retries up to 3 times on transient errors (`ConnectionError`,
`TimeoutError`) — the errors a real Wi-Fi controller would throw during a restart
or network hiccup. Backoff is 1s after the first failure, 2s after the second.
Non-transient errors (validation failures, unexpected exceptions) are not retried
since retrying them won't help. The response includes an `attempts` count and
`error_message` so the frontend can surface meaningful feedback without an extra
API call.

### sync_logs as a separate append-only table
A sync is a system-level event, not a property of any one venue. The log captures
success/failure, record counts, error messages, and the raw controller payload.
Raw payload storage means bugs in field mapping can be fixed and historical data
re-processed without re-fetching from the controller. The table is append-only
by design — logs are never updated after the fact.

### AI insights as a separate endpoint
`POST /insights` is decoupled from `POST /sync`. Sync is about data freshness.
Insights are about analysis. Keeping them separate means Gemini being unavailable
never affects the sync pipeline, and insights can be regenerated without
triggering a new sync. The endpoint aggregates session data server-side before
calling Gemini, so the prompt stays small regardless of how many sessions are
in the database.

### Structured Gemini output
The first iteration of the insights endpoint returned a raw text blob from Gemini.
The current version requests a JSON array and parses it with `json.loads`, falling
back gracefully on decode error. This gives the frontend structured fields to
render — each venue's insight displays as a card with labelled sections rather
than a wall of text, making it actually usable for a venue operator.

### Validation at the boundary
Each record from the controller is validated for required fields before touching
the database. Missing fields cause that record to be skipped with a log warning,
not a crash. In production, a provider changing their API response format should
degrade gracefully, not take down the pipeline.

### Pydantic response models
Each endpoint declares a `response_model` — FastAPI validates outgoing data,
generates accurate OpenAPI schemas at `/docs`, and lets handlers return SQLAlchemy
ORM objects directly (`from_attributes=True`). Input validation uses native FastAPI
features: `Literal` for enum-like params, `Query(ge=, le=)` for pagination bounds.

### Query indexes
Indexes on `sessions.connected_at`, `sessions.access_point_id`, `access_points.venue_id`,
and `sync_logs.synced_at` — the columns used in every `ORDER BY` and `JOIN`. Cheap
to add, meaningful once session volume grows beyond a demo dataset.

---

## Frontend decisions

### Collapsible cards with localStorage persistence
Every section of the dashboard is collapsible. The integration tests panel is
collapsed by default since it's a developer tool, not something a venue operator
needs on every visit. Card state is persisted to `localStorage` so your layout
is remembered across refreshes. This keeps the dashboard usable at a glance
without scrolling past sections you don't care about.

### Session charts with AP drill-down
The sessions card has a List / Chart toggle. Chart mode fetches all sessions (up
to 500) once and computes three views client-side: device type breakdown, sessions
by access point, and peak hours by time of day. Clicking an access point bar
drills into that AP's data — device breakdown and peak hours filtered to just
that endpoint. All bars use the same accent blue to keep the visual language
consistent with the rest of the interface.

### AI insights carousel
Rather than rendering all venue insights at once (which becomes overwhelming with
more than two venues), the insights panel shows one venue at a time with ← →
navigation. The venue name and position are shown in the nav so context is never
lost. The insight card itself is kept to four fields: summary, peak time, usage
pattern, and a recommended action — enough to be useful, not enough to be noise.

### Paginated sync history
`GET /sync-logs` accepts `limit` and `offset` parameters (defaulting to 10 rows)
and returns `{ total, logs }` — the same shape as the sessions endpoint. The
frontend uses the same Prev/Next pagination pattern in both places, keeping the
interaction model consistent.

---

## Testing

Six pytest integration tests run against an in-memory SQLite database:

| Test | What it verifies |
|------|-----------------|
| `test_sync_twice_no_duplicate_venues` | Upsert idempotency — syncing twice still returns exactly 3 venues |
| `test_sessions_grow_each_sync` | Sessions accumulate — second sync adds new rows rather than overwriting |
| `test_controller_down_writes_failed_log` | Failed syncs write a `failed` log with an error message |
| `test_health_returns_ok` | Health endpoint reaches the database and returns `ok` |
| `test_invalid_sync_mode_rejected` | Unknown mode parameters return HTTP 422 (FastAPI `Literal` validation) |
| `test_insights_returns_sample_without_api_key` | Insights work without Gemini — sample data returned when no API key |

The tests use an `on_conflict_do_nothing` / `on_conflict_do_update` helper
(`_insert`) that generates dialect-correct SQL for both SQLite and PostgreSQL,
since SQLAlchemy's generic `insert()` doesn't include conflict handling.

Run with:
```bash
PYTHONPATH=. pytest backend/tests/test_sync.py -v
```

---

## What I would add with more time

**Concurrency protection** — nothing prevents two syncs running simultaneously.
I'd add a check against `sync_logs` for an `in_progress` status, or a DB-level
advisory lock, before starting a new sync.

**Incremental syncs** — currently fetches everything on every sync. In production
against a real Meraki deployment with thousands of sessions, I'd pass a `since`
parameter using the `synced_at` timestamp from the last successful sync log row.

**Pagination on the controller side** — real Wi-Fi APIs paginate (typically 100
records per page). I'd implement cursor-based pagination, following `next_page`
tokens until exhausted before the upsert loop begins.

**Scheduled syncs** — rather than manual trigger, use APScheduler or a cron job
to sync on a configurable interval (e.g. every 15 minutes).

**Chart data endpoint** — the current chart view fetches up to 500 raw sessions
and aggregates client-side. With large datasets I'd add a `/sessions/stats`
endpoint that returns pre-aggregated counts by device type, AP, and hour, making
the charts fast regardless of session volume.

---

## Running locally

### With Docker (recommended — no external accounts needed)

```bash
git clone <repo>
cd wifi-controller-data-pipeline

# Requires Docker Desktop or docker service running:
#   sudo systemctl start docker   (Linux)
#   docker ps                     (should not error)

# Optional: add your Gemini key for live AI insights (sample insights work without it)
echo "GEMINI_API_KEY=your_key_here" > .env

docker compose up --build
```

> Use `docker compose` (v2) or `docker-compose` (v1) — both work.

- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs

Docker Compose starts a local Postgres container, waits for it to be healthy,
starts the backend (which auto-creates all tables on first boot), then starts
the frontend. No Supabase account or external database needed. Postgres is not
exposed on the host (only inside the Docker network), so it won't clash with a
local Postgres install on port 5432.

**If ports 8000 or 5173 are already in use** (e.g. you have uvicorn or `npm run dev` running):
stop those processes first, or run `kill $(lsof -t -i :8000)` / `kill $(lsof -t -i :5173)`.

The frontend calls `/api/*` on the same origin; Vite proxies those requests to the backend.
You do not need to open port 8000 in the browser — only http://localhost:5173.

**Quick smoke test after `docker compose up`:**
1. Open http://localhost:5173 — health dot should show "Connected"
2. Click **Sync now** — venues and sessions populate
3. Open **Sessions** → switch to **Chart** — bars and drill-down work
4. Open **AI Insights** → **Generate** — sample insights appear (or live Gemini if key set)
5. Expand **Integration tests** → run **Flaky controller** — retry status shows live
6. Run `PYTHONPATH=. pytest backend/tests/test_sync.py -v` on the host (optional)

### Without Docker

1. Start a local Postgres instance (or use Supabase — see `.env.example`)

2. Create `.env` at the repo root (copy from `.env.example`):
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/bconnect
   GEMINI_API_KEY=your_gemini_api_key   # optional
   ```

3. ```bash
   # Backend
   pip install -r backend/requirements.txt
   uvicorn backend.main:app --reload --port 8000

   # Frontend (separate terminal)
   cd frontend && npm install && npm run dev
   ```

Tables are created automatically on first startup via `Base.metadata.create_all()`.

---

## AI tool usage

I used Claude as a pair programmer throughout — to think through the data model,
discuss the trade-offs between upsert strategies, pressure-test decisions like why
`sync_logs` is a separate table, and to help build and iterate on the dashboard UI
quickly. All architectural decisions in this README reflect my own understanding —
I can explain any of them in the follow-up review.

---

## Assumptions

- The mock controller is intentionally shaped after Cisco Meraki's API structure
  (`network_id` for sites, MAC for devices) since that is a common controller
  bconnect would integrate with.
- Sessions are treated as immutable once written. A re-connection by the same
  device is a new session, not an update to an existing one.
- Docker uses local Postgres so reviewers need no Supabase account. Supabase is
  still supported for non-Docker development via `DATABASE_URL` in `.env`.
- The `flaky` mode uses a 70% failure rate per attempt. With 3 retries this gives
  roughly a 97% chance of eventual success, which exercises the retry path without
  making tests non-deterministic in a way that's hard to reason about.
