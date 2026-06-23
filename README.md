# wifi-controller-data-pipeline

Wi-Fi controller data pipeline with a FastAPI backend and React dashboard. Syncs mock venue/session data into Postgres, serves it via REST, and generates Gemini-powered insights.

## Performance

Sync and read paths were optimised to minimise round-trips to the remote database:

- **Batch upserts** — `_batch_execute()` in `backend/sync.py` collapses ~70 per-row INSERTs into 3 batch statements (venues, access points, sessions).
- **Single-query pagination** — `GET /sessions` uses a window function to return rows and total count in one query instead of two.

| Endpoint | Before | After |
|----------|--------|-------|
| `POST /sync` | ~13s | ~1.4s |
| `GET /sessions` | ~600ms | ~320ms |
| `GET /venues` | ~450ms | ~320ms |

Remaining latency on GET endpoints is network round-trip time to Supabase. Mock controller reads are in-memory and near-instant.
