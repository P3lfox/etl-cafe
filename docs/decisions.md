# Design decisions and limitations

**English** | [Español](decisions.es.md)

Why the project is built the way it is, which alternatives were discarded, and what it
does **not** do well. Project overview: [../README.md](../README.md).

## At a glance

| # | Decision | In one line |
|---|----------|-------------|
| D1 | [Use the dirty dataset as-is](#d1-use-the-dirty-dataset-as-is) | Real errors beat errors we invent |
| D2 | [Rebuild values, never impute](#d2-rebuild-values-never-impute) | Only derive what is exact; no mean/mode |
| D3 | [`Unknown` for payment method and location](#d3-unknown-for-payment-method-and-location) | Dropping ~40% of rows would be worse |
| D4 | [Drop rows without a valid date](#d4-drop-rows-without-a-valid-date) | A date cannot be derived from anything |
| D5 | [Normalized schema with constraints](#d5-normalized-schema-with-constraints) | Lookup tables + foreign keys + `CHECK` |
| D6 | [Idempotent load in one transaction](#d6-idempotent-load-in-one-transaction) | Safe to re-run, never half-loaded |
| D7 | [Shared `.env` and a dedicated database user](#d7-shared-env-and-a-dedicated-database-user) | One config, least privilege |
| D8 | [Read-only API](#d8-read-only-api) | Data enters only through the pipeline |
| D9 | [Repository layer and parameterized SQL](#d9-repository-layer-and-parameterized-sql) | Testable without a database, no SQL injection |
| D10 | [FastAPI as the reference API](#d10-fastapi-as-the-reference-api) | Validation and docs from type hints |
| D11 | [`limit` up to 10,000](#d11-limit-up-to-10000) | Power BI gets every row in one call |
| D12 | [Power BI Desktop + Cloudflare Quick Tunnel](#d12-power-bi-desktop--cloudflare-quick-tunnel) | Free bridge until a server exists |
| D13 | [Import mode, `ApiUrl` parameter, Calendar table](#d13-import-mode-apiurl-parameter-calendar-table) | Portable `.pbix`, one place to change the URL |
| D14 | [Polyglot API with a contract test](#d14-polyglot-api-with-a-contract-test) | The API is a contract, not a language |
| D15 | [Repository organized by language](#d15-repository-organized-by-language) | One folder and one README per language |

---

## Data

### D1. Use the dirty dataset as-is

- **Decision:** [Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)
  (Kaggle), kept as CSV, with no extra errors injected.
- **Why:** sales data fits a dashboard, and its errors were not designed by us, so the
  cleaning cannot be accused of solving problems it created itself.
- **Discarded:** a clean dataset (Tableau Sample Superstore) plus a script that injects
  errors — full control over the errors, but less credible; Dirty E-Commerce (Shein) —
  a product catalog, not sales; datos.gob.ar — monthly aggregates, not transactions.
- **Consequence:** the dataset only has *missing-value* errors (`ERROR`, `UNKNOWN`,
  empty). It has no duplicates, mixed date formats, stray whitespace or mixed case, so
  those cleaning rules exist but are never triggered on this data.

### D2. Rebuild values, never impute

- **Decision:** a missing value is filled only when it can be **derived exactly**:
  `total = quantity × price` gives any one of the three from the other two, and the fixed
  menu price gives the item from the price (and vice versa). Otherwise the row is dropped.
- **Why:** imputing with the mean or mode **invents data**. An invented price changes
  revenue, which is exactly what the dashboard measures.
- **Discarded:** mean/median/mode imputation (used by the reference project this one is
  based on).
- **Consequence:** 1,855 values were rebuilt (471 items, 431 quantities, 500 prices,
  453 totals), and 476 rows that could not be rebuilt were dropped.

### D3. `Unknown` for payment method and location

- **Decision:** missing payment method or location becomes the label `Unknown`; the row is kept.
- **Why:** these columns are missing in **31.7%** (payment) and **39.6%** (location) of
  the clean rows. Dropping them would lose the revenue of those sales, and `Unknown` does
  not pretend to know something we don't.
- **Discarded:** dropping the rows; filling with the most frequent value (would invent data, see D2).

### D4. Drop rows without a valid date

- **Decision:** rows with a missing or invalid date are dropped (460 rows).
- **Why:** no other column allows deriving a date, and a sale without a date cannot be
  placed in the monthly charts.
- **Discarded:** filling with the median date (the reference project's approach): it would
  pile hundreds of fake sales on a single day.

---

## Database

### D5. Normalized schema with constraints

- **Decision:** lookup tables `items`, `payment_methods` and `locations` hold each value
  once; `sales` references them by foreign key. `CHECK (> 0)` on quantity and amounts,
  index on `transaction_date`.
- **Why:** no repeated text, no typo can create a "new" product, and the database itself
  rejects impossible values even if a bug slips through the cleaning.
- **Discarded:** one flat table (the reference project's approach).
- **Consequence:** `sales.price_per_unit` is stored per sale in addition to
  `items.menu_price`, so a future price change does not rewrite past sales.

### D6. Idempotent load in one transaction

- **Decision:** `carga.py` upserts with `ON DUPLICATE KEY UPDATE` inside a single transaction.
- **Why:** re-running it never duplicates rows, and a failure halfway rolls everything back.

### D7. Shared `.env` and a dedicated database user

- **Decision:** connection settings live in one `.env` at the repo root, read by Python,
  Node and Go. The database user `etl_cafe` has privileges **only** on `cafe_sales`.
- **Why:** credentials stay out of the code and out of git, and moving to a remote server
  only changes the `.env`. Least privilege: a leaked password cannot touch other databases.

---

## API

### D8. Read-only API

- **Decision:** only `GET` endpoints.
- **Why:** data enters through the pipeline (`limpieza.py` → `carga.py`), never through
  the API. No `POST`/`PUT`/`DELETE` means nothing can be modified or deleted through it:
  a smaller attack surface, which also makes a public tunnel acceptable (D12).

### D9. Repository layer and parameterized SQL

- **Decision:** routes only handle HTTP; all SQL lives in a repository. Every query uses
  placeholders (`%s` / `?`), never string concatenation.
- **Why:** tests replace the repository with a fake, so they run without a database; and
  user input can never become SQL (an injection probe like `item=Tea' OR '1'='1` returns `[]`).

### D10. FastAPI as the reference API

- **Decision:** FastAPI (Python) is the reference implementation.
- **Why:** type hints give automatic validation (`422`), the response shape, interactive
  docs at `/docs` and the OpenAPI contract at `/openapi.json`.
- **Discarded:** Flask — closer to Express, but validation and docs need extensions.

### D11. `limit` up to 10,000

- **Decision:** `GET /sales` defaults to 100 rows and accepts up to 10,000.
- **Why:** the default protects casual calls; 10,000 covers the 9,064 rows so Power BI
  loads everything in one request without implementing pagination in Power Query.

---

## Dashboard

### D12. Power BI Desktop + Cloudflare Quick Tunnel

- **Decision:** Power BI Desktop on a Windows PC reaches the API through a free
  Cloudflare Quick Tunnel running on the Linux machine.
- **Why:** Power BI Desktop is Windows-only, and the Power BI web service / Fabric require
  a work or school account (personal and Microsoft 365 Family accounts are rejected). The
  tunnel needs no account, no open router ports and no money.
- **Discarded for now:** a VPS (~USD 5/month) — fixed URL, but costs money and needs server
  administration; Railway — managed, but paid after the trial. Both stay in the roadmap.

### D13. Import mode, `ApiUrl` parameter, Calendar table

- **Decision:** the query imports the data into the `.pbix`; the API base URL is a
  parameter; a `Calendar` date table drives time intelligence.
- **Why:** the `.pbix` opens with data on any PC even when the API is offline; a changing
  tunnel URL is updated in one place; `DATEADD` (month-over-month growth) needs a proper
  date table.

---

## Architecture

### D14. Polyglot API with a contract test

- **Decision:** the same API in Python, Node.js (Express) and Go, with a contract test that
  compares every implementation against the Python reference.
- **Why:** it proves that clients only depend on the **contract** (HTTP + JSON): Power BI
  shows an identical dashboard whichever implementation it calls.
- **Discarded:** Rust (steep learning curve for the time available); more languages
  (three already prove the point, each extra one only adds maintenance).
- **Consequence:** every API change must be made three times. In real systems, languages
  usually differ **per responsibility**, not to duplicate the same service. This is a
  *polyglot* architecture, not horizontal scaling (several copies of the same service
  behind a load balancer).

### D15. Repository organized by language

- **Decision:** `python/`, `node/`, `go/` and `powerbi/`, each with its own README; shared
  `data/`, `sql/` and `.env` at the root.
- **Why:** each teammate finds one language's code and instructions in one place; the root
  README stays a short overview.

---

## Limitations

What the project does **not** do, said plainly.

### Data

| Limitation | Impact |
|------------|--------|
| **936 rows dropped (9.4%)**: 460 without a valid date + 476 unrecoverable | Totals are those of the **valid** sales, not of every sale in the raw file |
| **`Unknown` is large**: 31.7% of payment methods, 39.6% of locations | The payment pie and any location analysis are dominated by `Unknown`; conclusions about how or where customers buy are weak |
| **Menu price inferred** as the most frequent price per item | Assumes prices did not change during 2023 |
| **Quantity rebuilt only when `total ÷ price` is a whole number** | Otherwise the row is dropped |
| **Single year (2023), single cafe, a training dataset** | Not representative of a real business; no year-over-year comparison is possible |
| **Dataset license not verified** | Check the Kaggle page before redistributing the data |

### Pipeline and API

| Limitation | Impact |
|------------|--------|
| **Full reload**: the whole file is cleaned and loaded each time | Fine for 10,000 rows; a large or growing source would need incremental loads |
| **No authentication or rate limiting** on the API | Anyone who has the URL can read the data (acceptable for public, read-only data) |
| **`limit` capped at 10,000** | If the data grows past that, Power BI would need pagination |
| **`422` bodies differ by language** (FastAPI has its own format) | The contract test compares only the status code for invalid parameters |
| **Rounding of `average_ticket` implemented three times** | Could differ in an edge case; the contract test only checks the chosen date ranges |
| **No CI** | Tests run only when someone runs them; the contract test needs three servers started by hand |

### Dashboard and hosting

| Limitation | Impact |
|------------|--------|
| **Quick Tunnel URL is temporary** and changes on every run | `ApiUrl` must be updated before each refresh |
| **The tunnel depends on the Linux machine** being on, with the API and tunnel running; no uptime guarantee | Not suitable for anything permanent |
| **The tunnel URL is public** | Anyone with the link reads the data (see D8) |
| **Power BI Desktop is Windows-only**, refresh is manual, nothing is published | Teammates need Windows; no scheduled refresh or web sharing |
| **Credentials in a plain-text `.env`** | Fine for local development; a server would use a secrets manager or environment configuration |

## Roadmap that addresses these limitations

- **VPS or Railway:** fixed URL, no dependency on a personal machine (tunnel limitations).
- **CI (e.g. GitHub Actions):** run the Python, Node and Go tests on every push, and the
  contract test against a database service container.
- **API key or IP restriction** if the data ever stops being public.
