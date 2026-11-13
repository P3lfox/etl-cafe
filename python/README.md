# Python — ETL + reference API

The Python side runs the **whole data pipeline** (cleaning and loading) and serves
the **reference API** that the Node and Go implementations are tested against.
Project overview: [../README.md](../README.md).

## Quick path

Requirements: [uv](https://docs.astral.sh/uv/), MariaDB/MySQL, and the `.env` file in
the repo root (see the main README).

```bash
cd python
uv sync                              # install dependencies
uv run python limpieza.py            # 1. clean  -> ../data/clean/
uv run python carga.py               # 2. load   -> MariaDB
uv run uvicorn api:app --reload      # 3. serve  -> http://127.0.0.1:8000/docs
uv run pytest                        # tests (no database needed)
```

Scripts resolve `data/`, `sql/` and `.env` relative to the repo root, so they work
from any working directory.

## Files

| File | Purpose |
|------|---------|
| `limpieza.py` | Step 1: cleaning (`clean()` is a pure function, `main()` does file I/O) |
| `carga.py` | Step 2: load the clean CSV into MariaDB |
| `db.py` | Shared connection settings, read from `../.env` |
| `api.py` | Step 3: read-only FastAPI (reference implementation) |
| `tests/test_limpieza.py` | Cleaning rules |
| `tests/test_carga.py` | Load helpers and schema parsing |
| `tests/test_api.py` | Routes, validation and error codes, with a fake repository |
| `tests/test_contract.py` | Cross-language contract test (needs running servers) |

## Cleaning — `limpieza.py`

**Principle: rebuild what can be derived exactly, never invent data**
(no mean/mode imputation).

| Rule | How |
|------|-----|
| Sentinels | `ERROR`, `UNKNOWN` and empty become real missing values |
| Impossible values | Quantity, price or total `<= 0` count as missing |
| Total / quantity / price | `total = quantity × price`, so any one is derived from the other two |
| Price ↔ item | Each item has a fixed menu price (Coffee 2.0, Tea 1.5, Cookie 1.0, Salad 5.0…), so one gives the other |
| Ambiguous prices | 3.0 is Juice **or** Cake and 4.0 is Sandwich **or** Smoothie: the item cannot be derived, so the row is dropped |
| Dates | Strict `YYYY-MM-DD`; invalid or missing dates are dropped (they cannot be derived) |
| Payment method / location | Missing becomes `Unknown` (dropping ~30% of rows would be worse) |
| Duplicates | Removed by `transaction_id` |

Results (from `../data/clean/cleaning_report.csv`):

| Metric | Rows |
|--------|-----:|
| Input | 10,000 |
| Rebuilt item | 471 |
| Rebuilt quantity | 431 |
| Rebuilt price | 500 |
| Rebuilt total | 453 |
| Dropped: invalid date | 460 |
| Dropped: unrecoverable | 476 |
| Dropped: duplicates | 0 |
| `Unknown` payment method | 2,870 |
| `Unknown` location | 3,592 |
| **Output** | **9,064** (0 empty cells) |

## Load — `carga.py`

- Creates the schema from `../sql/schema.sql` if it does not exist.
- Fills the lookup tables (`items`, `payment_methods`, `locations`) and upserts every sale.
- Runs in **one transaction**: on any error it rolls back, nothing is half-loaded.
- **Idempotent:** re-running uses `ON DUPLICATE KEY UPDATE`, so rows are updated, not duplicated.

Verified: 9,064 rows in the CSV = 9,064 in `sales`; revenue and units sums match; 0 orphan foreign keys.

## API — `api.py`

FastAPI turns type hints into validation (automatic `422`) and generates interactive
docs at `/docs` and the OpenAPI contract at `/openapi.json`. Endpoints and status
codes: [main README → API contract](../README.md#api-contract).

| Layer | Responsibility |
|-------|----------------|
| Pydantic models (`Sale`, `Group`, `Summary`) | Shape of the JSON responses |
| `SaleFilters` | Builds a **parameterized** `WHERE` clause (no SQL injection) |
| `SalesRepository` | All SQL lives here |
| `get_repository` | Dependency that opens and closes the connection; tests override it with a fake |
| Exception handler | Any database error → `503 {"detail": "Database unavailable"}` |

> Gotcha: with PyMySQL, a literal `%` in SQL must be written `%%` when parameters are
> passed (e.g. `DATE_FORMAT(..., '%%Y-%%m')`).
