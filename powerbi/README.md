# Power BI dashboard — step-by-step guide

**English** | [Español](README.es.md)

How to build the cafe sales dashboard (`etl-cafe.pbix`) from scratch: connect Power BI
to the API, model the data, write the DAX measures, build the visuals, and check that
the numbers are right. Project overview: [../README.md](../README.md).

Menu names are given in English with the **Spanish UI label** in parentheses, e.g.
**Transform data** (*Transformar datos*).

**Finish line:** the four KPI cards show exactly what `GET /summary` returns:

| Card | Expected value |
|------|---------------:|
| Total Revenue | **80,041.50** |
| Transactions | **9,064** |
| Units Sold | **27,358** |
| Average Ticket | **8.83** |

## Quick path

1. [Install Power BI Desktop](#1-requirements) on a Windows 10/11 PC.
2. [Start an API and a tunnel](#2-expose-the-api) on the Linux machine and copy the URL.
3. [Load the data](#3-load-the-data-power-query) with an `ApiUrl` parameter and one query.
4. [Add the Calendar table and the relationship](#4-model-calendar-table-and-relationship).
5. [Write the measures](#5-dax-measures).
6. [Build the visuals](#6-visuals).
7. [Check the numbers](#7-check-the-numbers), then [save the `.pbix`](#8-save-and-share).

## 1. Requirements

| Item | Detail |
|------|--------|
| **Power BI Desktop** | Free. **Windows 10 or later only** (no Linux, no macOS, Windows 7 unsupported since January 2021). Install it from the Microsoft Store or microsoft.com. |
| **Microsoft account** | **Not needed.** When Desktop asks you to sign in, close that window and continue. Signing in is only required to *publish* to the web. |
| **Power BI web / Fabric** | Not used. They require a **work or school** account; personal accounts (Gmail, Outlook, Microsoft 365 Family) are rejected. |
| **The API reachable from the Windows PC** | See the next step. |

## 2. Expose the API

Power BI runs on Windows, but the API runs on Linux. `127.0.0.1` would point to the
Windows PC itself, so the API needs a URL the Windows PC can reach. A **Cloudflare
Quick Tunnel** gives one for free, with no account:

```
Windows PC (Power BI) ──► https://random-words.trycloudflare.com ──► Cloudflare ──► tunnel ──► Linux: localhost:8000 (API)
```

On the Linux machine, with the database already loaded (see [../python/README.md](../python/README.md)):

```bash
sudo pacman -S cloudflared                         # once (Arch/CachyOS; other distros: see Cloudflare docs)

cd python && uv run uvicorn api:app                # terminal 1: the API
cloudflared tunnel --url http://localhost:8000     # terminal 2: the tunnel
```

Among the tunnel logs there is a box with a URL like `https://random-words.trycloudflare.com`.
Check it from your phone **on mobile data** (not Wi-Fi): `https://<your-url>/summary` must show JSON.

Any implementation works, because they share the [API contract](../README.md#api-contract):

| API | Start it | Tunnel to |
|-----|----------|-----------|
| Python | `cd python && uv run uvicorn api:app` | `http://localhost:8000` |
| Node | `cd node && npm start` | `http://localhost:3000` |
| Go | `cd go && go run .` | `http://localhost:8080` |

> **Keep both terminals open** while Power BI loads or refreshes data.
> The URL **changes every time** the tunnel restarts, and it is **public** (anyone with
> it can read the data), which is acceptable because the API is read-only.
> Do not use the tunnel's `--allowed-mail` option: Power BI cannot type the emailed PIN.

## 3. Load the data (Power Query)

The tunnel URL changes, so it goes in a **parameter**: one place to update instead of
editing the query each time.

### 3.1 Create the `ApiUrl` parameter

1. **Home → Transform data** (*Inicio → Transformar datos*). The Power Query editor opens.
2. **Manage parameters → New parameter** (*Administrar parámetros → Nuevo parámetro*):
   - Name: `ApiUrl`
   - Type: **Text** (*Texto*)
   - Current value: `https://your-url.trycloudflare.com` — **no trailing `/`**
3. **OK** (*Aceptar*).

### 3.2 Create the `sales` query

1. **New source → Blank query** (*Nuevo origen → Consulta en blanco*).
2. **Advanced editor** (*Editor avanzado*), delete everything and paste:

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

3. Rename the query to **`sales`** (right click → **Rename** / *Cambiar nombre*).
4. If asked how to connect, choose **Anonymous** (*Anónimo*) → **Connect** (*Conectar*).
5. **Close & Apply** (*Cerrar y aplicar*).

What each line does:

| Step | Meaning |
|------|---------|
| `Web.Contents(ApiUrl, [RelativePath = "sales", Query = [limit = "10000"]])` | Calls `GET <ApiUrl>/sales?limit=10000` |
| `Json.Document(...)` | Parses the response: a list of JSON records |
| `Table.FromRecords(Source)` | Turns the list into a table, one column per field |
| `Table.TransformColumnTypes(...)` | Gives each column its type (date, whole number, decimal, text) |

> **Why `limit = "10000"`?** The API returns 100 rows by default. With 10,000 it returns
> all 9,064 rows in one call. Without it, the totals would be wrong.

## 4. Model: Calendar table and relationship

Comparing a month with the previous one needs a **date table**: one row per day,
related to the sales. It is the standard practice in any Power BI model.

### 4.1 Create the table

**Modeling → New table** (*Modelado → Nueva tabla*):

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

It creates one row per day from the first to the last sale (2023-01-01 to 2023-12-31),
with the month and weekday as number and as text.

### 4.2 Relate it to `sales`

1. Open the **Model view** (*Vista de modelo*): in the left vertical bar, the icon of
   **three small boxes joined by lines** (hover to see the names).
2. Drag `Date` from the `Calendar` box and drop it on `transaction_date` in the `sales` box.
3. Confirm:
   - Cardinality: **One to many (1:\*)** or **Many to one (\*:1)** — same thing seen from each side.
   - Cross filter direction: **Single** (*Única*).
4. A line appears between the tables, with **1** on the `Calendar` side and **\*** on the
   `sales` side. If Power BI already created it, nothing to do.

### 4.3 Mark it as date table

Right click the `Calendar` table → **Mark as date table** (*Marcar como tabla de fechas*) → column `Date`.

### 4.4 Sort month and weekday names

`Month` is text, and text sorts alphabetically (Apr, Aug, Dec…). Tell Power BI to sort it by its number:

1. **Table view** (*Vista de tabla*): the grid icon in the left bar.
2. In the **Data** pane (*Datos*) on the right, open `Calendar` and click the **`Month`** column.
3. **Column tools → Sort by column** (*Herramientas de columnas → Ordenar por columna*) → **`Month Number`**.
4. Repeat for **`Weekday`** → **`Weekday Number`**.

## 5. DAX measures

A **measure** is a formula that is recalculated for whatever is being shown (a card, a
month, a product). Create each one with **Home → New measure** (*Inicio → Nueva medida*)
while the `sales` table is selected:

```
Total Revenue = SUM(sales[total_spent])
Transactions = COUNTROWS(sales)
Units Sold = SUM(sales[quantity])
Average Ticket = DIVIDE([Total Revenue], [Transactions])
Revenue Previous Month = CALCULATE([Total Revenue], DATEADD('Calendar'[Date], -1, MONTH))
MoM Growth % = DIVIDE([Total Revenue] - [Revenue Previous Month], [Revenue Previous Month])
Revenue Share % = DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALL(sales[item])))
```

| Measure | What it calculates |
|---------|--------------------|
| `Total Revenue` | Sum of `total_spent` |
| `Transactions` | Number of rows (each row is one sale) |
| `Units Sold` | Sum of `quantity` |
| `Average Ticket` | Revenue ÷ transactions. `DIVIDE` returns blank instead of a divide-by-zero error |
| `Revenue Previous Month` | Revenue, but with the dates shifted one month back (needs the Calendar table) |
| `MoM Growth %` | (this month − previous month) ÷ previous month. January is blank: it has no previous month |
| `Revenue Share %` | This product's revenue ÷ revenue of **all** products |

**The key DAX idea — `CALCULATE`:** when a visual draws "Coffee", every measure is
**filtered** to Coffee. In `Revenue Share %` the numerator is Coffee's revenue, while
`CALCULATE([Total Revenue], ALL(sales[item]))` **removes the item filter**, giving the
total revenue. The result is Coffee's percentage. `CALCULATE` means "compute this, but
change the filters"; `DATEADD` and `ALL` are two ways of changing them.

### Percentage format

Select the measure (calculator icon) in the **Data** pane → **Measure tools**
(*Herramientas de medición*) → **Format** group → **%** button, and set **1** decimal.
Do it for `MoM Growth %` and `Revenue Share %`. The format only changes how the value
is shown (`0.053` → `5.3%`), not the value itself.

## 6. Visuals

In the **Report view** (*Vista de informe*), pick each visual in the **Visualizations**
pane (*Visualizaciones*) and drag the fields into its wells. Hover an icon to see its name.

| # | Visual (Spanish UI name) | Fields | Question it answers |
|---|--------------------------|--------|---------------------|
| 1–4 | **Card** (*Tarjeta*) × 4 | one measure each: Total Revenue, Transactions, Units Sold, Average Ticket | Headline KPIs |
| 5 | **Pie chart** (*Gráfico circular*) | Legend: `payment_method` · Values: `Total Revenue` | How do customers pay? |
| 6 | **Line chart** (*Gráfico de líneas*) | X-axis: `Calendar[Month]` · Y-axis: `Total Revenue` | Trend over the year |
| 7 | **Clustered bar chart** (*Gráfico de barras agrupadas*) | Y-axis: `item` · X-axis: `Total Revenue` | Best-selling products |
| 8 | **Table** (*Tabla*) | `item`, `Transactions`, `Units Sold`, `Total Revenue` | Detail per product |
| 9 | **Line and clustered column chart** (*Gráfico de columnas agrupadas y de líneas*) | X-axis: `Calendar[Month]` · Columns: `Total Revenue` · Line: `MoM Growth %` | Month-over-month growth |
| 10 | **Treemap** (*Gráfico de rectángulos*) | Category: `item` · Values: `Total Revenue` · Tooltips: `Revenue Share %` | Each product's share |
| 11 | **Clustered column chart** (*Gráfico de columnas agrupadas*) | X-axis: `Calendar[Weekday]` · Y-axis: `Total Revenue` | Busiest days of the week |

**Bars vs columns:** in Power BI, *bars* are **horizontal** and *columns* are **vertical**.
With 8 products, horizontal bars read better because the names fit.

**Which chart for which question:**

- **Lines for time:** months follow each other, and a line shows the **trend**.
- **Bars or columns to compare categories:** Coffee, Tea and Cake have no order; a line
  joining them would suggest a continuity that does not exist.
- **Pie or treemap for parts of a whole:** they show each slice's share of 100%.

## 7. Check the numbers

The four cards must match `GET <ApiUrl>/summary` and the expected values at the top of
this guide. If they match, the whole pipeline is validated end to end: the dirty CSV
went through cleaning, the database and the API, and reached Power BI without losing a cent.

## 8. Save and share

**File → Save as → Browse this device** (*Archivo → Guardar como → Examinar este
dispositivo*), type **Power BI file (\*.pbix)**. The `.pbix` contains the visuals, the
measures, the query **and a copy of the data** (Import mode).

| Format | Contains | Use it for |
|--------|----------|------------|
| `.pbix` (Save as) | Report + model + **data** | Sharing: opens with data on any PC, even with the API offline |
| `.pbit` (Export → template) | Report + model, **no data** | Asks for `ApiUrl` on open and downloads everything again |
| PDF (Export) | A static picture of the report | Printing or attaching |

## 9. Refresh with a new URL

The copy of the data stays in the `.pbix`; only **Refresh** needs a live API. Whenever
the tunnel URL changes (new run, another PC, another API):

1. Start the API and the tunnel again and copy the new URL.
2. **Transform data → Edit parameters** (*Transformar datos → Editar parámetros*) → paste it into `ApiUrl`.
3. **Refresh** (*Actualizar*).

The query, measures and visuals stay untouched.

**Demo idea:** run three tunnels at once (ports 8000, 3000 and 8080), switch `ApiUrl`
between the Python, Node and Go URLs and refresh: the dashboard stays identical,
because Power BI only sees the API contract, not the language behind it.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DataSource.Error` / could not connect | API or tunnel not running, or the URL changed | Start both, check `<url>/summary` in a browser, update `ApiUrl` |
| URL works in the browser but not in Power BI | `ApiUrl` ends with `/`, or has a typo | Remove the trailing `/`; copy the URL exactly |
| Keeps asking for credentials | A wrong authentication method was saved | **File → Options and settings → Data source settings** (*Configuración de origen de datos*) → clear permissions → choose **Anonymous** |
| Cards show 100 transactions | The query has no `limit = "10000"` | Use the query from section 3.2 |
| Errors in `transaction_date` | Regional date parsing | The API sends ISO dates (`2023-01-01`); in Power Query use **Change type → Using locale** (*Usar configuración regional*) → Date, English (United States) |
| DAX formula error on the commas | Regional DAX separators (`;` instead of `,`) | Replace `,` with `;` in the formula, or enable standard DAX separators in **Options → Regional settings** |
| Months sorted Apr, Aug, Dec… | `Month` is sorted as text | Section 4.4: sort by `Month Number` |
| `MoM Growth %` empty for January | No previous month to compare | Expected behavior |
| `MoM Growth %` empty for every month | Calendar not related or not marked as date table | Sections 4.2 and 4.3 |
| Relationship shows many-to-many | `Calendar[Date]` and `transaction_date` have different types | Make both **Date** type, then recreate the relationship |
| `MoM Growth %` shows 0.05 instead of 5% | Missing percentage format | Section 5, *Percentage format* |
