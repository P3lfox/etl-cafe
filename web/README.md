# Web dashboard — React

**English** | [Español](README.es.md)

A browser dashboard over the same API Power BI uses: KPI tiles, monthly trend,
month-over-month growth and rankings by product, payment method and location, with a
date filter. It runs on any operating system (unlike Power BI Desktop, which is
Windows-only). Project overview: [../README.md](../README.md).

## Quick path

Requirements: Node.js 22+ and **one of the APIs running** (see the
[main README](../README.md#quick-start)).

```bash
cd python && uv run uvicorn api:app      # terminal 1: the API (or the Node / Go one)

cd web
npm install
npm run dev                              # terminal 2: http://localhost:5173
```

Expected values for the full year match Power BI: **80,041.50** revenue, **9,064**
transactions, **27,358** units and **8.83** average ticket.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Development server with hot reload |
| `npm test` | Tests for the pure logic (`src/lib/metrics.test.js`), no API or browser needed |
| `npm run lint` | Static checks with oxlint |
| `npm run build` | Optimized build in `dist/` |
| `npm run preview` | Serves `dist/` locally, with the same proxy to the API |

## Choosing which API it uses

The browser **only talks to the Vite server** (`/api/...`), and Vite forwards each request
to the API chosen with `API_TARGET` (Python by default):

```bash
npm run dev                                         # Python, port 8000
API_TARGET=http://127.0.0.1:3000 npm run dev        # Node
API_TARGET=http://127.0.0.1:8080 npm run dev        # Go
```

The page footer shows which API is answering. Since all three follow the
[contract](../README.md#api-contract), the dashboard looks identical with any of them.

**Why a proxy?** If the browser called `http://127.0.0.1:8000` directly from
`http://localhost:5173`, those would be different origins and the browser would block the
response because of **CORS**, unless all three APIs added CORS headers. With the proxy,
everything comes from the same origin for the browser, so no API had to change.

## Files

| File | Purpose |
|------|---------|
| `vite.config.js` | `/api` → `API_TARGET` proxy (for `dev` and `preview`) |
| `src/api.js` | `fetchSummary(range)`: calls `GET /api/summary` and translates errors |
| `src/lib/metrics.js` | Pure logic: month-over-month growth, share, ranking and formatting |
| `src/lib/metrics.test.js` | 9 tests with Vitest |
| `src/components/charts.jsx` | The charts (Recharts): monthly trend, growth and ranked bars |
| `src/components/ui.jsx` | Date filter, KPI tiles, card with Chart/Table view, table |
| `src/App.jsx` | State, data loading and page layout |
| `src/index.css` | Color roles (light and dark mode) and responsive layout |

## How it works

1. `App.jsx` stores the chosen date range and calls `GET /api/summary?date_from=...&date_to=...`.
2. `/summary` already returns the totals and the groupings (by product, payment method,
   location and month). What the API does not return is computed in `metrics.js`:
   - **month-over-month growth** = (month − previous month) ÷ previous month;
   - each group's **share** = its revenue ÷ total revenue;
   - **ranking** from highest to lowest, with `Unknown` always last.
3. While a new filter loads, the previous result stays on screen, dimmed (no flashing or
   layout jumps). If the API does not answer, a message is shown.

## Chart design decisions

The charts follow checkable visualization rules, not only taste:

| Decision | Why |
|----------|-----|
| **Monthly growth is a separate chart**, not a line over the revenue columns | A chart with **two y-axes** (like the Power BI combo) suggests correlations that depend on how the scales are aligned, not on the data |
| **Ranked bars instead of a pie** for payment method | Cash, Credit Card and Digital Wallet are very close (23.1% / 23.0% / 22.9%); a pie hides that difference |
| **`Unknown` in gray and always last** | It is missing data, not a real category; gray separates it from valid data |
| **Growth in blue (up) and red (down)** with a zero line | Signed data: two opposite colors and a neutral midpoint |
| **One color for the product bars** | It is a single series; coloring each bar differently adds no information |
| **Selective labels** (share at each bar's tip, value only on the last month) | A number on every point clutters the chart; the rest is in the tooltip and the table |
| **Table view on every chart** | Every value can be read without relying on color or a mouse (accessibility) |
| **Palette validated for color blindness and contrast**, in light and dark mode | Checked with a script, not by eye |

## Limitations

- It only uses `/summary`, so it does not include Power BI's weekday chart (the API does not
  group by weekday; it would have to be added to all three implementations).
- The filter's date range is fixed to 2023, because the dataset covers that year.
- The built bundle is about 620 KB (mostly Recharts); Vite warns about it when building.
  Acceptable for this project.
- `npm run build` produces static files, but they need the proxy to the API: publishing them
  would require a server that does the same (for example, the VPS in the roadmap).
