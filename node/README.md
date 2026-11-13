# Node.js — Express API

**English** | [Español](README.es.md)

The same read-only API as [`../python/api.py`](../python/api.py), written in
**Node.js + Express 5**, against the same MariaDB database. It follows the
[API contract](../README.md#api-contract) and is verified by the cross-language
contract test.

## Quick path

Requirements: Node.js 22+, the database loaded by the Python pipeline, and the
`.env` file in the repo root.

```bash
cd node
npm install
npm start          # http://127.0.0.1:3000
npm run dev        # same, restarting on file changes (like nodemon)
npm test           # unit tests with a fake repository, no database needed
```

`.env` is loaded with Node's built-in `--env-file=../.env` flag (no `dotenv` package).
Set `PORT` to change the port.

## Files

| File | Purpose |
|------|---------|
| `src/server.js` | Entry point: creates the pool and starts listening |
| `src/app.js` | `createApp(repository)`: routes, query validation, error middleware |
| `src/repository.js` | `SalesRepository` with the SQL, `createPool()`, `DatabaseError` |
| `test/app.test.js` | 13 tests with `node:test` + `fetch` against a fake repository |

## Design

- **Routes only handle HTTP**; all SQL lives in `SalesRepository`, so tests inject a fake.
- **Validation** is explicit (Express has no type-based validation like FastAPI):
  invalid `limit`, `offset` or dates throw a `ValidationError` → `422 {"detail": ...}`.
- **Errors:** Express 5 forwards errors thrown in `async` handlers to the error
  middleware: `ValidationError` → `422`, `DatabaseError` → `503`, anything else → `500`.
- **SQL** uses `?` placeholders, never string concatenation.

## Matching the Python JSON

| Gotcha | Fix |
|--------|-----|
| mysql2 returns `DECIMAL` as strings (`"4.00"`) | `decimalNumbers: true` |
| mysql2 turns `DATE` into JS `Date` objects, which can shift a day by timezone | `dateStrings: true` → `"2023-01-01"` |
| Express 5 turns repeated query keys (`?item=a&item=b`) into arrays | keep the last value, like FastAPI |
| Impossible dates such as `2023-02-30` | rejected with an ISO round-trip check |
