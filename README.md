# bconnect Wi-Fi Integration Dashboard

A full-stack integration demo showing how bconnect could ingest data from
third-party Wi-Fi controllers, normalise it into a common data model, and turn it
into useful venue-level reporting.

The project is intentionally built as a small end-to-end system, not just a CRUD
API. A mock Wi-Fi controller produces venue, access point, and session data.
FastAPI validates and syncs that data into Postgres. React then shows the result
as a dashboard with KPIs, tables, charts, sync history, failure testing, and
AI-assisted venue insights.

## Quick Demo Path

```bash
git clone <repo-url>
cd wifi-controller-data-pipeline
docker compose up --build
```

Open http://localhost:5173

No Gemini API key is required. Docker Compose
runs Postgres, the FastAPI backend, and the Vite frontend locally.

After the app loads:

1. Click **Sync now** to ingest mock controller data.
2. Open **Sessions** and switch from List to Chart.
3. Click an access point bar to drill into that endpoint.
4. Open **AI Insights** and click **Generate**.
5. Open **Integration tests** and run the flaky/down controller checks.

## What This Build Does

Mock controller data shaped after a Meraki-style API returns stable venues and
access points, plus new randomised sessions on each call. FastAPI validates the
payload, retries transient controller failures, upserts venues/APs/sessions in a
single transaction, writes an append-only sync log, and exposes typed API
responses through Pydantic models. React displays the data in a simple dashboard:
collapsible cards, top-level KPIs, paginated sessions, session charts, AP
drill-down, paginated sync history, live integration-test feedback, and
structured AI insights per venue. Docker Compose runs the whole stack with local
Postgres so a reviewer can test it without external services.

## System Flow

```mermaid
flowchart LR
    User["Operator<br/>opens dashboard"] --> UI["React + Vite UI<br/>localhost:5173"]

    UI -->|"POST /api/sync<br/>mode: normal / flaky / down"| API["FastAPI backend<br/>Pydantic response models"]
    API -->|"fetch controller payload"| Controller["Mock Wi-Fi controller<br/>Meraki-style venues/APs/sessions"]
    Controller -->|"venues + APs + sessions"| API

    API -->|"validate + batch upsert<br/>single transaction"| DB[("Postgres<br/>venues, access_points,<br/>sessions, sync_logs")]
    API -->|"write status, counts,<br/>errors, raw payload"| DB

    UI -->|"GET /api/venues<br/>/sessions /sync-logs"| API
    API --> DB
    DB -->|"normalised data"| API
    API -->|"typed JSON responses"| UI

    UI -->|"POST /api/insights"| Insights["Insights endpoint<br/>aggregate 7-day venue stats"]
    Insights -->|"if key exists"| Gemini["Gemini Flash<br/>structured JSON insights"]
    Insights -->|"if no key"| Sample["Sample insight responses<br/>demo mode"]
    Gemini --> Insights
    Sample --> Insights
    Insights -->|"summary, peak_time,<br/>pattern, action"| UI
```

## Architecture

### Backend

FastAPI is used because it fits this assignment well: small endpoints, automatic
OpenAPI docs, dependency injection for database sessions, and built-in request
validation. The backend uses:

- `response_model=` on endpoints so OpenAPI docs show real response contracts.
- Pydantic v2 models in `backend/schemas.py` with `from_attributes=True`, so
  SQLAlchemy ORM rows can be returned directly and serialised safely.
- `Literal["normal", "flaky", "down"]` for sync mode validation.
- `Query(ge=, le=)` for pagination bounds.
- SQLAlchemy for the Postgres model and upsert logic.

The main endpoints are:

- `POST /sync?mode=normal|flaky|down` - sync mock controller data.
- `GET /health` - check database connectivity.
- `GET /venues` - list venues.
- `GET /access-points` - list access points.
- `GET /sessions?venue_id=&limit=&offset=` - paginated sessions.
- `GET /sync-logs?limit=&offset=` - paginated sync history.
- `POST /insights` - generate or return venue insights.

### Database

PostgreSQL stores four tables:

- `venues` - one row per controller network/site.
- `access_points` - one row per AP, linked to a venue.
- `sessions` - one row per client session, linked to an AP.
- `sync_logs` - append-only record of every sync attempt.

Indexes are added on the columns used in common joins and ordering:
`sessions.connected_at`, `sessions.access_point_id`, `access_points.venue_id`,
and `sync_logs.synced_at`.

Docker Compose runs a local Postgres 15 container. The backend creates tables and
indexes on startup with `Base.metadata.create_all()`, which is acceptable for a
take-home demo. In production I would replace this with proper migrations.

### Mock Controller

`backend/mock_controller.py` simulates a third-party Wi-Fi controller. It is
shaped around common real-world controller concepts:

- Stable venue/network IDs.
- Stable AP MAC addresses.
- Fresh sessions generated on every sync.
- Different session duration patterns for pub/cafe/hotel-style venues.
- Failure modes: `normal`, `flaky`, and `down`.

This gives the dashboard data that changes naturally over time and lets the
failure handling be tested from the UI.

### Frontend

The frontend is React + Vite with a small component split:

- `App.jsx` handles data loading and page composition.
- `CollapsibleCard.jsx` handles reusable card behaviour and localStorage state.
- `SessionCharts.jsx` handles session chart aggregation and AP drill-down.
- `api.js` centralises API calls.

The UI is intentionally simple: Vercel-inspired cards, concise KPIs, collapsible
sections, paginated tables, and charts only where they make the session data
easier to understand.

The browser calls `/api/*`; Vite proxies those requests to the backend. In Docker
the proxy target is `http://backend:8000`, and in local development it defaults
to `http://localhost:8000`.

## AI Feature

### What it does

The AI feature generates plain-English venue insights for operators. Each venue
gets:

- A short activity summary.
- The busiest day/time window.
- A notable usage pattern.
- A concrete recommended action.

The UI shows one venue at a time in a carousel so the output stays readable.

### What data it uses

The backend aggregates the last 7 days of session data by venue before sending
anything to the model. The prompt uses summary statistics only:

- Session count.
- Average duration.
- Busiest day.
- Busiest two-hour window.
- Percentage of very short sessions.
- Percentage of sessions longer than two hours.

Raw client MAC addresses are not sent to Gemini.

### Real AI, mock logic, or rule-based?

If `GEMINI_API_KEY` is set, `POST /insights` calls Gemini Flash and asks for a
strict JSON response. If no key is set, the endpoint returns realistic sample
insights with `"demo": true`. This lets you see the full UI without
creating an AI account or spending API credits(although the gemini api is free with some limits).

### Production considerations

For production I would add prompt/version tracking, cached insight runs, stricter
JSON-schema validation, background jobs for long-running insight generation, and
monitoring for model failures. I would also review privacy carefully: avoiding
sending device identifiers to the model
define retention rules for prompts/responses.
Cost-wise, I would not call the
model on every page load; insights should be generated on demand or scheduled,
cached, and invalidated when new sync data arrives.
I would also give the user control of the time period of data sent to the model to generate insights so they can more useful data based on what they see fit

## Key Engineering Decisions

### Idempotent sync via upserts

Venues use `network_id`, APs use `mac`, and sessions use
`(client_mac, connected_at)` as conflict keys. These are external identifiers
that map to real controller concepts. The sync can be run repeatedly without
duplicating venues or APs.

### Batched database writes

The sync groups rows by entity type and performs three batched
`INSERT ... ON CONFLICT` statements instead of one insert per record. This keeps
the demo responsive and reflects how I would approach a real integration where
network/database round trips matter.

### One transaction per sync

Venue, AP, and session writes happen inside a single transaction. If part of the
sync fails, the database rolls back rather than being left half-updated.

### Retry only transient controller failures

The sync retries `ConnectionError` and `TimeoutError` up to three times with
exponential backoff. It does not retry validation or programming errors, because
retrying those would hide the real problem.

### Append-only sync logs

Every sync writes a log row with status, counts, error message, timestamp, and
raw payload. This gives operators/debuggers a history of what happened and keeps
sync observability separate from venue/session data.

### Keep AI separate from sync

`POST /sync` is about freshness. `POST /insights` is about analysis. Keeping them
separate means a Gemini outage does not block ingestion, and insights can be
regenerated later from stored data.

## Running Locally

### Recommended: Docker Compose

Prerequisites:

- Docker Desktop, or Docker Engine with the daemon running.
- `docker compose version` should work.

Run:

```bash
git clone <repo-url>
cd wifi-controller-data-pipeline
docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- Backend docs: http://localhost:8000/docs

Optional live Gemini insights:

```bash
echo "GEMINI_API_KEY=your_key_here" > .env
docker compose up --build
```

The app still works without this key because sample insights are returned.

Notes:

- The Postgres container is not exposed on host port 5432, so it will not clash
  with a local Postgres install.
- If ports 8000 or 5173 are already in use, stop those local processes first:

```bash
kill $(lsof -t -i :8000) 2>/dev/null
kill $(lsof -t -i :5173) 2>/dev/null
```

### Local development without Docker

Start or install local Postgres, then create a repo-root `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/bconnect
GEMINI_API_KEY=
```

Run backend:

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Run frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## Smoke Test

After startup:

1. Open http://localhost:5173.
2. Confirm the health indicator says **Connected**.
3. Click **Sync now**.
4. Confirm Venues shows 3 venues.
5. Open Sessions, switch to Chart, and click an AP bar.
6. Open AI Insights and click Generate.
7. Open Integration tests and run Flaky controller.

You can also verify the API:

```bash
curl http://localhost:5173/api/health
curl -X POST http://localhost:5173/api/sync
curl http://localhost:5173/api/venues
```

## Tests

```bash
PYTHONPATH=. pytest backend/tests/test_sync.py -v
```

The tests cover:

- Idempotent venue upsert.
- Sessions growing across syncs.
- Failed controller sync logs.
- Health endpoint.
- FastAPI validation for invalid sync modes.
- Sample AI insights when no Gemini key is set.

Tests run against in-memory SQLite. The sync uses a small `_insert()` helper so
conflict handling works with both SQLite in tests and Postgres in the app.

## Assumptions

- The mock controller is intentionally shaped after Cisco Meraki-style concepts
  because Meraki-like controllers are a realistic integration target.
- Sessions are immutable once written. A reconnect is a new session.
- `create_all()` is acceptable for a demo; migrations would be used in production.
- The flaky controller mode uses random transient failures to demonstrate retry
  handling in the UI.
- Session timestamps are treated as UTC-naive demo timestamps; production would
  standardise timezone-aware UTC values.
- The chart view caps raw session fetches at 500 records for simplicity;
  production would use aggregated stats endpoints.

## What I Would Improve With More Time

- Add concurrency protection so two syncs cannot run at the same time.
- Add incremental sync support using the last successful `synced_at` timestamp.
- Add controller-side pagination/cursor handling, since real Wi-Fi APIs paginate.
- Move chart aggregation into a `/sessions/stats` endpoint for larger datasets.
- Add authentication/authorisation around sync and insights endpoints.


## Submission Notes

Submit:

- GitHub repository link: `<add repository URL here>`.
- Setup/run instructions: see **Running Locally**.
- Assumptions: see **Assumptions**.
- Improvements with more time: see **What I Would Improve With More Time**.
- AI tools note: see below.

## AI Tool Usage

I used Cursor/Claude as a pair-programming assistant to discuss data modelling,
pressure-test sync/idempotency decisions, iterate on the dashboard UI, and refine
the README. I treated it as a review and implementation assistant, not a source
of architectural authority: the final design decisions, trade-offs, and ability
to explain the code are mine.

## Final Summary

Mock controller (normal / flaky / down), shaped like a Meraki-style API, returns
stable venues/APs and fresh randomised sessions each call. FastAPI validates
fields, batch-upserts all three entity types in one transaction (venues on
`network_id`, APs on MAC, sessions on `client_mac` + `connected_at`), retries
transient failures with backoff, rolls back on failure, and writes a sync log
with the raw payload every time. React shows collapsible KPI cards, paginated
sessions with venue filter, session charts with AP drill-down, paginated sync
history, live integration-test feedback, and a per-venue AI insights carousel.
Gemini receives 7-day per-venue aggregations and returns structured JSON
insights; sample insights are used when no API key is set. Docker Compose runs
Postgres, the API, and the UI in one command, with Vite proxying `/api` to the
backend.
