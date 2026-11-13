# Go — net/http API

The same read-only API as [`../python/api.py`](../python/api.py), written in **Go**
with only the standard library router, against the same MariaDB database. It follows
the [API contract](../README.md#api-contract) and is verified by the cross-language
contract test.

## Quick path

Requirements: Go 1.22+ (developed with 1.27), the database loaded by the Python
pipeline, and the `.env` file in the repo root.

```bash
cd go
go run .              # http://127.0.0.1:8080
go test ./...         # unit tests with a fake repository, no database needed
go build -o api-go .  # optional: one self-contained binary (git-ignored)
```

`main.go` loads `../.env` with a small built-in loader (existing environment
variables win, as with python-dotenv). Set `PORT` to change the port.

## Files

| File | Purpose |
|------|---------|
| `main.go` | Entry point: `.env` loader, database config, HTTP server |
| `handlers.go` | `NewServer(repo)`: routes, query validation, JSON responses |
| `repository.go` | `Repository` interface, `SQLRepository` with the SQL, `DatabaseError` |
| `handlers_test.go` | 8 tests with `net/http/httptest` against a fake repository |

The only external dependency is the MySQL driver
[`github.com/go-sql-driver/mysql`](https://github.com/go-sql-driver/mysql).

## Design

- **Standard library routing:** since Go 1.22, `http.ServeMux` understands methods and
  path parameters (`"GET /sales/{transaction_id}"`), so no framework is needed.
- **Routes only handle HTTP**; `SQLRepository` holds the SQL behind the `Repository`
  interface, so tests inject a fake.
- **Errors:** validation → `422 {"detail": ...}`, `DatabaseError` → `503`, anything else → `500`.
- **SQL** uses `?` placeholders, never string concatenation.
- **`ReadHeaderTimeout`** on the server protects against slow-header (Slowloris) clients.
- **Compiled:** unlike Python and Node, `go build` produces a single native binary
  that runs without installing a runtime, which is handy for deploying to a server.

## Matching the Python JSON

| Gotcha | Fix |
|--------|-----|
| A `nil` slice encodes as `null`, not `[]` | slices start as `make([]T, 0)` |
| `DATE` columns | scanned into `string` (no `parseTime`) → `"2023-01-01"` |
| Impossible dates such as `2023-02-30` | `time.Parse(time.DateOnly, ...)` rejects them |
| `average_ticket` rounding | `math.Round(x*100) / 100` |
