# etl-cafe

End-to-end data pipeline: a **dirty** cafe sales dataset is cleaned with Python,
loaded into a normalized **MariaDB** database, served by a read-only **FastAPI**
REST API, and visualized in a **Power BI** dashboard.

```
dirty_cafe_sales.csv ──► limpieza.py ──► cafe_sales_clean.csv ──► carga.py ──► MariaDB ◄── api.py ──► Power BI
   (raw, with errors)     (clean)          (+ cleaning report)     (load)     (normalized)  (JSON)    (dashboard)
```

**Validated end to end:** the Power BI KPI cards match `/summary` and the clean CSV
exactly: **80,041.50** revenue, **9,064** transactions, **27,358** units sold,
**8.83** average ticket.

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/), MariaDB or MySQL running locally.

1. **Install dependencies**
   ```bash
   uv sync
   ```
2. **Create the database and a dedicated user** (MariaDB `root` usually needs `sudo`):
   ```bash
   sudo mariadb -e "CREATE DATABASE IF NOT EXISTS cafe_sales CHARACTER SET utf8mb4;
   CREATE USER IF NOT EXISTS 'etl_cafe'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
   GRANT ALL PRIVILEGES ON cafe_sales.* TO 'etl_cafe'@'localhost';"
   ```
3. **Create a `.env` file** in the repo root (it is git-ignored):
   ```
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=etl_cafe
   DB_PASSWORD=YOUR_PASSWORD
   DB_NAME=cafe_sales
   ```
4. **Run the pipeline** (always from the repo root):
   ```bash
   uv run python limpieza.py           # 1. clean  -> data/clean/
   uv run python carga.py              # 2. load   -> MariaDB
   uv run uvicorn api:app --reload     # 3. serve  -> http://127.0.0.1:8000
   ```
5. **Check it works:** open <http://127.0.0.1:8000/docs> and try `GET /summary`.

Run the tests with `uv run pytest` (no database needed).

## Project structure

| Path | Purpose |
|------|---------|
| `data/raw/dirty_cafe_sales.csv` | Raw dataset with errors |
| `limpieza.py` | Step 1: cleaning |
| `data/clean/cafe_sales_clean.csv` | Clean table (output of step 1) |
| `data/clean/cleaning_report.csv` | What was fixed or dropped, with counts |
| `sql/schema.sql` | Normalized database schema |
| `carga.py` | Step 2: load into MariaDB |
| `db.py` | Shared DB connection (reads `.env`) |
| `api.py` | Step 3: read-only REST API |
| `api-node/` | Phase 2: the same API in Node.js + Express |
| `tests/` | Tests for each step, plus the Python ↔ Node contract test |
| `etl-cafe.pbix` | Power BI dashboard |

## 1. Dataset

[Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)
(Kaggle), used as-is: 10,000 transactions, 8 columns
(`Transaction ID`, `Item`, `Quantity`, `Price Per Unit`, `Total Spent`,
`Payment Method`, `Location`, `Transaction Date`).

Errors come as `ERROR`, `UNKNOWN` or empty cells in every column.
`Payment Method` is 26% missing and `Location` 33% missing.

## 2. Cleaning — `limpieza.py`

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

Results (from `data/clean/cleaning_report.csv`):

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

## 3. Database — `sql/schema.sql` + `carga.py`

Normalized schema: lookup tables hold each value once and `sales` references them
by foreign key.

```
items (item_id PK, name, menu_price)              ┐
payment_methods (payment_method_id PK, name)      ├──< sales (transaction_id PK, transaction_date,
locations (location_id PK, name)                  ┘            item_id FK, quantity, price_per_unit,
                                                               total_spent, payment_method_id FK, location_id FK)
```

- `CHECK (> 0)` constraints on quantity and amounts, index on `transaction_date`.
- The load runs in **one transaction**: on any error it rolls back, nothing is half-loaded.
- **Idempotent:** re-running uses `ON DUPLICATE KEY UPDATE`, so rows are updated, not duplicated.
- Connection settings come from `.env`, so moving to a remote server only changes config.

## 4. API — `api.py`

Read-only by design: data enters through the pipeline, never through the API,
so there are no `POST`/`PUT`/`DELETE` endpoints (smaller attack surface).

| Endpoint | Returns |
|----------|---------|
| `GET /sales` | Sales list. Filters: `date_from`, `date_to`, `item`, `payment_method`, `location`, `limit` (1–10,000, default 100), `offset` |
| `GET /sales/{transaction_id}` | One sale, or `404` |
| `GET /summary` | KPIs + totals by item, payment method, location and month. Optional `date_from`, `date_to` |
| `GET /docs` | Interactive Swagger documentation |
| `GET /openapi.json` | API contract (OpenAPI), importable into Postman |

| Status | When |
|--------|------|
| `200` | OK |
| `404` | Sale not found |
| `422` | Invalid parameter (e.g. `limit=0`, `date_from=yesterday`, `date_from` after `date_to`) |
| `503` | Database unavailable |

All SQL is parameterized (an injection probe like `item=Tea' OR '1'='1` returns `[]`).
Routes only handle HTTP; all SQL lives in `SalesRepository`, which the tests replace
with a fake so they run without a database.

## 5. Power BI dashboard

Power BI Desktop is Windows-only, and it must reach the API from another machine.

### Expose the API (temporary): Cloudflare Quick Tunnel

Free and no account needed. The URL changes every run and only lives while the
tunnel is running. It is public, which is acceptable because the API is read-only.

```bash
uv run uvicorn api:app                          # terminal 1
cloudflared tunnel --url http://localhost:8000  # terminal 2 -> https://xxxx.trycloudflare.com
```

### Load the data (Power Query)

1. **Transform data → Manage parameters → New:** `ApiUrl` (text) = tunnel URL, no trailing `/`.
2. **New source → Blank query → Advanced editor**, name it `sales`:
   ```
   let
       Source = Json.Document(Web.Contents(ApiUrl, [RelativePath = "sales", Query = [limit = "10000"]])),
       Table = Table.FromRecords(Source),
       Typed = Table.TransformColumnTypes(Table, {
           {"transaction_id", type text}, {"transaction_date", type date},
           {"item", type text}, {"quantity", Int64.Type},
           {"price_per_unit", type number}, {"total_spent", type number},
           {"payment_method", type text}, {"location", type text}
       })
   in
       Typed
   ```
3. Authentication: **Anonymous**. Then **Close & Apply**.

When the tunnel URL changes: **Transform data → Edit parameters**, paste the new URL, **Refresh**.
The `.pbix` stores a copy of the data (Import mode), so it opens with data even when the API is offline.

### Model and measures

`Calendar` date table (**Modeling → New table**), related 1:* to `sales[transaction_date]`
and marked as date table; `Month` sorted by `Month Number`, `Weekday` by `Weekday Number`:

```
Calendar =
ADDCOLUMNS(
    CALENDAR(MIN(sales[transaction_date]), MAX(sales[transaction_date])),
    "Month Number", MONTH([Date]),
    "Month", FORMAT([Date], "MMM"),
    "Weekday Number", WEEKDAY([Date], 2),
    "Weekday", FORMAT([Date], "dddd")
)
```

```
Total Revenue = SUM(sales[total_spent])
Transactions = COUNTROWS(sales)
Units Sold = SUM(sales[quantity])
Average Ticket = DIVIDE([Total Revenue], [Transactions])
Revenue Previous Month = CALCULATE([Total Revenue], DATEADD('Calendar'[Date], -1, MONTH))
MoM Growth % = DIVIDE([Total Revenue] - [Revenue Previous Month], [Revenue Previous Month])
Revenue Share % = DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALL(sales[item])))
```

### Visuals

| Visual | Fields | Answers |
|--------|--------|---------|
| 4 cards | Total Revenue, Transactions, Units Sold, Average Ticket | Headline KPIs |
| Pie chart | `payment_method` × Total Revenue | How customers pay |
| Line chart | Month × Total Revenue | Trend over the year |
| Bar chart | `item` × Total Revenue | Best-selling products |
| Table | item, Transactions, Units Sold, Total Revenue | Detail per product |
| Column + line chart | Month × Total Revenue (columns) + MoM Growth % (line) | Month-over-month growth |
| Treemap | `item` × Total Revenue, tooltip Revenue Share % | Each product's share |
| Column chart | Weekday × Total Revenue | Busiest days of the week |

## 6. Phase 2: polyglot API — `api-node/`

The same API implemented in **Node.js + Express**, against the same database and
the same `.env`. Clients such as Power BI only see HTTP + JSON, so they cannot tell
which language serves them: the API is a **contract**, not a language.

```bash
cd api-node
npm install
npm start          # http://127.0.0.1:3000 (npm run dev restarts on file changes)
npm test           # unit tests with a fake repository, no database needed
```

| Layer | Python (`api.py`) | Node (`api-node/src/`) |
|-------|-------------------|------------------------|
| Routes + validation | FastAPI + type hints | Express 5 + explicit parsing (`app.js`) |
| SQL | `SalesRepository` | `SalesRepository` (`repository.js`), same queries |
| Driver | PyMySQL | mysql2 (`decimalNumbers`, `dateStrings` to match Python's JSON) |
| Port | 8000 | 3000 |

### Contract test

`tests/test_contract.py` sends the same requests to both APIs and asserts the
**same status code and the same JSON body** (for invalid-parameter `422`s only the
status is compared, because FastAPI uses its own error body format).

```bash
uv run uvicorn api:app --port 8000      # terminal 1
cd api-node && npm start                # terminal 2
PY_API_URL=http://127.0.0.1:8000 NODE_API_URL=http://127.0.0.1:3000 uv run pytest tests/test_contract.py
```

Without those variables the contract test is skipped, so `uv run pytest` works without servers.

> Note: this is a *polyglot* architecture, not horizontal scaling. Horizontal scaling
> means several copies of the **same** service behind a load balancer.

## Roadmap

- [ ] **Remote hosting:** VPS (~USD 5/month) running MariaDB + API, with only the API
      exposed and MariaDB on localhost; or Railway as a managed alternative. Gives
      Power BI a fixed URL instead of the temporary tunnel.
- [x] **Polyglot API:** Node/Express implementation with contract tests (see section 6).
