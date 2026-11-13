# Python code walkthrough

**English** | [Español](CODE_WALKTHROUGH.es.md)

Step-by-step explanation of how `limpieza.py`, `carga.py` and `api.py` work, following the
data: the dirty CSV goes in, a clean table comes out, it is loaded into MariaDB and the API
serves it as JSON. For *how to run it*, see [README.md](README.md); for *why* it was
designed this way, see [../docs/decisions.md](../docs/decisions.md).

## Contents

1. [`limpieza.py` — cleaning](#1-limpiezapy--cleaning)
2. [`carga.py` — loading into MariaDB](#2-cargapy--loading-into-mariadb)
3. [`api.py` — the API](#3-apipy--the-api)
4. [Possible improvements](#4-possible-improvements)

---

## 1. `limpieza.py` — cleaning

### The big picture

```
main()  →  read the CSV  →  clean(raw)  →  save clean CSV + report
                              │
                              ├─ 1. normalize text and sentinels
                              ├─ 2. remove duplicates
                              ├─ 3. convert types (numbers, dates)
                              ├─ 4. drop invalid dates
                              ├─ 5. rebuild values  ← the core
                              ├─ 6. drop what cannot be recovered
                              ├─ 7. fill with "Unknown"
                              └─ 8. final types and order
```

**Key design decision:** `clean()` does not read or write files. It receives a DataFrame
and returns another DataFrame plus the report. That is why it can be tested with small
hand-built tables, without touching the disk. All file I/O lives in `main()` — the same
principle that separates business logic from the HTTP handler in Express.

### Step 0: read without pandas "helping"

```python
raw = pd.read_csv(RAW_FILE, dtype=str, keep_default_na=False)
```

- `dtype=str`: everything comes in as **text**. If pandas saw `"ERROR"` in a numeric column,
  it would convert it its own way and control would be lost.
- `keep_default_na=False`: by default pandas turns values such as `"NA"` or `""` into nulls
  automatically. This is disabled so that **the code** decides what counts as missing.

Read everything raw first, decide afterwards.

### Step 1: normalize text and sentinels

```python
SENTINELS = {"", "ERROR", "UNKNOWN"}

def normalize_text(df):
    df = df.apply(lambda s: s.str.strip())
    return df.mask(df.isna() | df.apply(lambda s: s.str.upper().isin(SENTINELS)))
```

- `s.str.strip()` removes leading and trailing spaces from every cell.
- `s.str.upper().isin(SENTINELS)` builds a `True`/`False` table telling whether each cell is
  `""`, `ERROR` or `UNKNOWN`. The `upper()` makes `error` or `Unknown` count too.
- `df.mask(condition)` replaces with **null** every cell where the condition is `True`.

From here on, a missing value is always a real null, whatever it looked like originally.

### Step 2: duplicates

```python
df = df.drop_duplicates(subset="transaction_id", keep="first")
report["dropped_duplicates"] = before - len(df)
```

If two rows share a transaction ID, the first one is kept. It removes 0 rows on this
dataset, but the rule stays in case future data has duplicates.

The pattern **count before, operate, count after** repeats across the file: the difference
goes into the report. That is how the cleaning report can say exactly what each step did.

### Step 3: convert types

```python
for col in NUMERIC_COLUMNS:
    df[col] = pd.to_numeric(df[col], errors="coerce")
    df.loc[df[col] <= 0, col] = None
df["transaction_date"] = pd.to_datetime(df["transaction_date"], format="%Y-%m-%d", errors="coerce")
```

- `errors="coerce"`: anything that cannot be converted becomes null instead of raising an
  error, so `"abc"` as a quantity becomes a missing value.
- `df.loc[df[col] <= 0, col] = None` means "in the rows where the column is ≤ 0, set null".
  A negative quantity or a zero price is **impossible**, so it is treated as missing.
- `format="%Y-%m-%d"` requires exactly `2023-01-31`. A date like `31/01/2023` is not
  guessed: it becomes null.

The line before, `df.astype(object).where(df.notna(), None)`, is a technical adjustment: it
turns pandas nulls into plain `None` before the type conversion.

### Step 4: invalid dates

```python
df = df[df["transaction_date"].notna()].copy()
```

The usual way to filter in pandas: `df[condition]` keeps **only the rows where the
condition is `True`**. A date cannot be derived from any other column, so those rows are
dropped (460).

### Step 5: rebuild values — the core

First the **menu** is built, derived from the data itself:

```python
def build_menu(df):
    known = df.dropna(subset=["item", "price_per_unit"])
    item_to_price = known.groupby("item")["price_per_unit"].agg(lambda s: s.mode().iloc[0])
    items_per_price = item_to_price.reset_index().groupby("price_per_unit")["item"]
    unique = items_per_price.nunique() == 1
    price_to_item = items_per_price.first()[unique]
    return item_to_price, price_to_item
```

1. `known` keeps only the rows that have both item **and** price.
2. `groupby("item")...mode()` gets each item's most frequent price: Coffee → 2.0, Tea → 1.5, etc.
3. Then it inverts the map: for each price, how many different items have it (`nunique`).
4. `price_to_item` keeps **only the prices that belong to a single item**. 3.0 (Juice or
   Cake) and 4.0 (Sandwich or Smoothie) are left out as ambiguous.

That last step is what prevents inventing data: if the price is 3.0, the code **does not
guess** whether it was a juice or a cake.

Then the rebuild:

```python
for _ in range(2):
    df["price_per_unit"] = df["price_per_unit"].fillna(df["item"].map(item_to_price))
    df["item"] = df["item"].fillna(df["price_per_unit"].map(price_to_item))
    df["price_per_unit"] = df["price_per_unit"].fillna(df["total_spent"] / df["quantity"])

    qty = df["total_spent"] / df["price_per_unit"]
    whole_qty = qty.where((qty - qty.round()).abs() < TOLERANCE).round()
    df["quantity"] = df["quantity"].fillna(whole_qty)

    df["total_spent"] = df["total_spent"].fillna(df["quantity"] * df["price_per_unit"])
```

Two key tools:

- **`fillna(x)` only fills the gaps.** An existing value is never touched, so real data is never overwritten.
- **`map(dictionary)` translates** each value through the dictionary: if the item is
  `"Tea"`, `map(item_to_price)` returns `1.5`.

Example with one row:

| Step | item | quantity | price | total |
|------|------|----------|-------|-------|
| Original | `ERROR` → null | 3 | 2.0 | null |
| Item from price (2.0 → Coffee, unique) | **Coffee** | 3 | 2.0 | null |
| total = 3 × 2.0 | Coffee | 3 | 2.0 | **6.0** |

- **Whole quantity:** `total ÷ price` is accepted only if it is a whole number, with a 0.01
  tolerance for rounding errors. If it gives 2.7 units, something is wrong and it is not filled.
- **Why the loop runs twice:** a value rebuilt in the first pass can enable another in the
  second. For example, the price obtained from the total on the third line only lets the
  item be derived on the next pass.

### Step 6: drop what cannot be recovered

```python
unrecoverable = df[REBUILDABLE_COLUMNS].isna().any(axis=1)
df = df[~unrecoverable].copy()

inconsistent = (df["quantity"] * df["price_per_unit"] - df["total_spent"]).abs() > TOLERANCE
df = df[~inconsistent].copy()
```

- `.isna().any(axis=1)` asks, row by row, whether **any** of the 4 columns is still empty.
  `axis=1` means "across each row".
- `~` is negation in pandas: `df[~unrecoverable]` keeps the rows that are **not** unrecoverable.
- The consistency check verifies `quantity × price = total`. It is the final safety net; 0
  rows on this dataset.

### Step 7: `Unknown`

```python
df[col] = df[col].fillna(UNKNOWN_LABEL)
```

For payment method and location, the missing value is **labeled** `Unknown` instead of
dropping the row (decision D3): dropping those rows would lose about 40% of the sales.

### Step 8: final types and output

`astype(...)` sets each column's type (quantity as integer, prices as decimal) and
`sort_values` orders by date. `main()` writes two files:

- `cafe_sales_clean.csv`: the clean table.
- `cleaning_report.csv`: the `report` dictionary, filled step by step, as a table.

### How it is tested

`tests/test_limpieza.py` builds small DataFrames by hand, one per rule, and checks the
result. For example, the ambiguous price:

```python
def test_ambiguous_price_cannot_rebuild_item_and_row_is_dropped():
    df, report = run(["TXN_9", "", "1", "3.0", "3.0", "Cash", "Takeaway", "2023-02-01"])
    assert "TXN_9" not in df["transaction_id"].values
    assert report["dropped_unrecoverable"] == 1
```

That is the payoff of `clean()` being a pure function: every cleaning rule has a test that proves it.

---

## 2. `carga.py` — loading into MariaDB

### The big picture

```
main()  →  read the clean CSV  →  connect()  →  load(df, conn)  →  print row counts
                                                    │
                                       one single TRANSACTION:
                                                    ├─ 1. create tables (schema.sql)
                                                    ├─ 2. lookup tables → name→id maps
                                                    ├─ 3. sales, using those ids as FKs
                                                    └─ 4. COMMIT  (or ROLLBACK if anything failed)
```

### Step 1: create the tables

```python
def apply_schema(cursor):
    lines = SCHEMA_FILE.read_text(encoding="utf-8").splitlines()
    script = "\n".join(ln for ln in lines if not ln.strip().startswith("--"))
    for statement in script.split(";"):
        sql = statement.strip()
        if sql:
            cursor.execute(sql)
```

The driver runs **one statement at a time**, so the file is split on `;`. Order matters:
comments (`--`) are removed first and **then** the file is split. A comment containing a `;`
used to cut the SQL in half; that bug was fixed and has its own test.

Since the schema uses `CREATE TABLE IF NOT EXISTS`, running it several times breaks nothing.

### Step 2: lookup tables and the "id map"

The `sales` table does not store `"Cash"` but Cash's **id**. So the names are loaded first,
and then the code finds out which id each one got:

```python
def upsert_lookup(cursor, table, id_column, names):
    cursor.executemany(f"INSERT IGNORE INTO {table} (name) VALUES (%s)", [(n,) for n in sorted(names)])
    cursor.execute(f"SELECT name, {id_column} FROM {table}")
    return dict(cursor.fetchall())
```

- `INSERT IGNORE` inserts and, if the name already exists (it is `UNIQUE`), skips it instead of failing.
- `executemany` sends all rows together instead of one `execute` per row.
- `dict(cursor.fetchall())` turns `[("Cash", 1), ("Credit Card", 2), ...]` into `{"Cash": 1, "Credit Card": 2, ...}`.

**Security note:** there is an f-string with `{table}` here, and it is not SQL injection.
`%s` placeholders only work for **values**, not table names; and `table` is written by the
programmer (`"payment_methods"`), never taken from a user. The **values** (`name`) do use
`%s`. The rule: **anything coming from outside always goes through placeholders**.

`items` works the same way but with `ON DUPLICATE KEY UPDATE`: if the item already exists,
its menu price is **updated** (each item's most frequent price, as in the cleaning).

### Step 3: the sales

```python
def build_sales_rows(df, item_ids, payment_ids, location_ids):
    return [
        (
            str(r.transaction_id),
            str(r.transaction_date),
            item_ids[r.item],
            int(r.quantity),
            float(r.price_per_unit),
            float(r.total_spent),
            payment_ids[r.payment_method],
            location_ids[r.location],
        )
        for r in df.itertuples(index=False)
    ]
```

- `itertuples` walks the DataFrame row by row; `r.item` reads each column.
- `item_ids[r.item]` does the translation: `"Coffee"` becomes the id it got.
- `int()` and `float()` turn pandas (numpy) numeric types, which the driver does not always
  understand, into plain Python numbers.

It is a **pure** function (data in, tuples out, no database), so it has its own test without MariaDB.

The sales are inserted with:

```sql
INSERT INTO sales (...) VALUES (%s, %s, ...)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), ...
```

If the `transaction_id` already exists, the row is **updated** instead of duplicated. That
is why the load is **idempotent**: running it ten times always leaves 9,064 rows.

### Step 4: the transaction

```python
def load(df, conn):
    try:
        with conn.cursor() as cursor:
            apply_schema(cursor)
            ...
            cursor.executemany(...)
            cursor.execute("SELECT COUNT(*) FROM sales")
            total = cursor.fetchone()[0]
        conn.commit()
        return total
    except Exception:
        conn.rollback()
        raise
```

A transaction is **all or nothing**, like a bank transfer: money cannot leave one account
without arriving in the other.

- If everything succeeds, `commit()` confirms the changes.
- If anything fails halfway, `rollback()` **undoes everything** since the start, and `raise`
  re-throws the error so it is visible. Half of the sales are never left loaded.

For this to work the connection is opened with `autocommit=False`; otherwise each `INSERT`
would be committed on its own. `main()` closes the connection in a `finally`, no matter what.

---

## 3. `api.py` — the API

### The layers

```
HTTP request ──► route (@app.get)        ← HTTP only: parameters, status codes
                    │
                    ├─ dependencies      ← validate filters, open/close the connection
                    │
                    ▼
               SalesRepository           ← all SQL lives here
                    │
                    ▼
                 MariaDB
                    │
response ◄──── Pydantic model            ← shapes and validates the output JSON
```

### Models: the shape of the response

```python
class Sale(BaseModel):
    transaction_id: str
    transaction_date: date
    item: str
    quantity: int
    price_per_unit: float
    ...
```

This is the **contract** written as code. When a route declares `-> Sale`, FastAPI takes
what the database returns, **validates** it against the model and turns it into JSON. If
the database returned something with a different shape, the error would show up here and
not in Power BI. These models are also what `/docs` and `/openapi.json` show.

### Filters: building the `WHERE` without injection

```python
def where(self):
    conditions = {
        "s.transaction_date >= %s": self.date_from,
        "s.transaction_date <= %s": self.date_to,
        "i.name = %s": self.item,
        ...
    }
    used = {sql: value for sql, value in conditions.items() if value is not None}
    clause = " WHERE " + " AND ".join(used) if used else ""
    return clause, tuple(used.values())
```

The trick is a dictionary of **SQL condition → value**, keeping only the conditions that
have a value. For `?item=Tea&date_from=2023-03-01` it returns:

```python
(" WHERE s.transaction_date >= %s AND i.name = %s",  ("2023-03-01", "Tea"))
```

The SQL only carries the `%s`, and the values travel **separately**. The driver escapes
them, so `Tea' OR '1'='1` is searched as a literal item name, not as SQL: it returns `[]`.

### The repository: all the SQL together

```python
class SalesRepository:
    def __init__(self, conn):
        self.conn = conn

    def list_sales(self, filters, limit, offset):
        where, params = filters.where()
        sql = f"{SALES_QUERY}{where} ORDER BY ... LIMIT %s OFFSET %s"
        return self._fetch(sql, (*params, limit, offset))
```

`SALES_QUERY` is the `SELECT` with the `JOIN`s that translate ids back into names — the
reverse of the load.

`summary()` runs one query for the totals and then **one per grouping** (item, payment
method, location and month), all with the same `WHERE`. The month's `%%Y-%%m` is there
because PyMySQL uses `%` for parameters, so a literal `%` is written twice.

### Dependencies: FastAPI's "middleware"

```python
def get_repository():
    conn = db.connect(cursorclass=DictCursor)
    try:
        yield SalesRepository(conn)
    finally:
        conn.close()
```

A function with `yield` works in **two phases**:

1. **Before the `yield`:** it opens the connection and **hands** the repository to the route.
2. **After:** once the route has responded, it resumes from the `yield` and the `finally`
   **closes the connection**, even if an error happened.

It is similar to an Express middleware with `next()`, but declarative. The route asks for it like this:

```python
Repository = Annotated[SalesRepository, Depends(get_repository)]

def list_sales(repo: Repository, ...):
```

`Depends(get_repository)` tells FastAPI to run `get_repository` before calling the route and
pass in whatever it returns. That is the key to the tests:
`app.dependency_overrides[get_repository] = lambda: FakeRepository()` **swaps the dependency
for a fake one**, and the route never notices.

`sale_filters` is a dependency too: it groups the 5 filters into a `SaleFilters` and checks
that `date_from <= date_to`, answering `422` otherwise.

### The routes

```python
@app.get("/sales/{transaction_id}")
def get_sale(transaction_id: str, repo: Repository) -> Sale:
    sale = repo.get_sale(transaction_id)
    if sale is None:
        raise HTTPException(status_code=404, detail=f"Sale {transaction_id} not found")
    return sale
```

Routes are short because they only deal with HTTP: they ask the repository for data and
choose the status code.

```python
limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100
```

This single line replaces the validation written by hand in Node and Go: integer, minimum
1 (`ge` = greater or equal), maximum 10,000 (`le` = less or equal), default 100. If it does
not hold, FastAPI answers `422` without running the route.

### The error handler

```python
@app.exception_handler(pymysql.MySQLError)
def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})
```

Any MariaDB error, in any route, ends up here and becomes a `503`. It **does not return the
real error message**, which could leak internal details (the user or database name) to
whoever calls the API.

### One request end to end

`GET /sales?item=Tea&limit=2`:

1. **FastAPI validates** the parameters: `limit=2` is an integer between 1 and 10,000.
2. **`sale_filters`** builds `SaleFilters(item="Tea")`; there are no dates to check.
3. **`get_repository`** opens the connection and yields the repository.
4. **The route** calls `repo.list_sales(filters, 2, 0)`.
5. **The repository** runs `SELECT ... WHERE i.name = %s ORDER BY ... LIMIT %s OFFSET %s` with `("Tea", 2, 0)`.
6. **Pydantic** validates the 2 rows against `Sale` and turns them into JSON.
7. **`200` is returned**, and `get_repository` resumes from the `yield` and closes the connection.

Node and Go follow **exactly** the same steps; what FastAPI solves with types and
dependencies is written by hand there (validation in `app.js` / `handlers.go`, and the
connection through a pool).

---

## 4. Possible improvements

Parts of the code that work but could be written better:

| Where | What | Improvement |
|-------|------|-------------|
| `limpieza.py`, `clean()` | `df.astype(object).where(df.notna(), None)` is hard to read | Convert each column directly from pandas `string` dtypes |
| `api.py`, `summary()` | Reuses the `JOIN`s by cutting the text of `SALES_QUERY` with `split("FROM")`, which is fragile | Define the `SELECT` and the `FROM ... JOIN` as two separate constants, as in `go/repository.go` |
| `api.py`, `summary()` | Runs 5 queries per request | Fine for 9,064 rows; with more data, combine the groupings into one query with `UNION ALL` or use pre-aggregated tables |
