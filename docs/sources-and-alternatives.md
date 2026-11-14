# Data sources and alternatives

**English** | [Español](sources-and-alternatives.es.md)

Where to get datasets for a project like this one, and which other options exist for each
piece we chose (tunnel, hosting and dashboard tool), with their pros and cons. The *why*
behind each choice is in [decisions.md](decisions.md). Project overview: [../README.md](../README.md).

> Prices and free plans change often. The data in this document was gathered in November
> 2026; **always confirm on the official page** before deciding.

## 1. Data sources

### The dataset we used

**[Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)**
(Kaggle): 10,000 cafe sales with errors designed for cleaning practice.

Download it from the browser (requires a Kaggle login) or straight from the terminal,
without an account:

```bash
mkdir -p data/raw
curl -L -o /tmp/cafe.zip \
  "https://www.kaggle.com/api/v1/datasets/download/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training"
unzip -o /tmp/cafe.zip -d data/raw      # leaves data/raw/dirty_cafe_sales.csv
```

> Its license has not been verified yet: check it on the Kaggle page before redistributing the data.

### Other sources

| Source | What it offers | Pros | Cons |
|--------|----------------|------|------|
| [Kaggle — search "dirty data"](https://www.kaggle.com/datasets?search=dirty+data) | Datasets built for cleaning practice | Real, ready-made errors | Check each one's license and quality |
| [Dirty E-Commerce Data (Shein)](https://baselight.app/u/kaggle/dataset/oleksiimartusiuk_e_commerce_data_shein) | 80,000+ products with missing values and inconsistent formats | Very dirty, great for practice | A catalog, not sales: weak dashboard KPIs |
| [Tableau Sample Superstore](https://public.tableau.com/app/learn/sample-data) | Sales with categories, regions, customers and profit (CSV and XLSX) | Great for normalizing into several tables; official download | It is **clean**: errors would have to be injected with a script |
| [datos.gob.ar — "ventas" tag](https://datos.gob.ar/dataset?tags=ventas) | Official series (supermarkets, wholesalers, shopping centers) | Public Argentine data | Monthly totals, not transactions: little to clean |
| [Kaggle Learn — Data Cleaning](https://www.kaggle.com/learn/data-cleaning) | Short course with practice datasets | Teaches the techniques | Not a dataset for the project itself |

For Superstore, use **only the official Tableau page**: many sites claiming to offer that
download are spam.

### How to choose a dataset

- **A domain with clear KPIs:** sales, orders or bookings give revenue, quantities and trends over time.
- **Transactions, not totals:** one row per sale gives material to clean, normalize and group.
- **Reasonable size:** thousands to tens of thousands of rows process quickly and stay realistic.
- **Real, documented errors:** knowing what kind of dirt it has helps plan the cleaning.
- **A license that allows using and sharing it** in a repository.

### If the data comes as Excel (`.xlsx`)

`limpieza.py` reads CSV, but pandas reads Excel almost the same way. Install `openpyxl`
(`uv add openpyxl`) and change the read to:

```python
raw = pd.read_excel("data/raw/file.xlsx", sheet_name=0, dtype=str, keep_default_na=False)
```

`dtype=str` and `keep_default_na=False` play the same role as with the CSV: read
everything as text and decide in code what counts as missing. Note that Excel can store
dates as real dates rather than text, so check how they arrive before applying the
`%Y-%m-%d` format.

## 2. Getting the API to Power BI

Power BI Desktop runs on Windows and the API on Linux, so the API needs an address the
Windows PC can reach.

| Option | Cost | Pros | Cons |
|--------|------|------|------|
| **Cloudflare Quick Tunnel** (the one we used) | Free, no account | One command; no router ports to open; HTTPS | Temporary URL that changes every run; public; depends on the Linux machine being on; no uptime guarantee |
| **Same local network** (`uvicorn api:app --host 0.0.0.0` and the Linux machine's local IP) | Free | No external services; nothing public on the internet | Only works with both PCs on the same network; may need the port opened in the Linux firewall |
| **Windows virtual machine** on the same Linux PC | Free (except the Windows license) | Everything on one machine | Uses a lot of memory and CPU |
| **Cloudflare Tunnel with an account and own domain** | Account is free; the domain is paid | Fixed URL | Needs a domain and more setup (not tested) |
| **ngrok** or other tunnel services | Free plans with an account | Similar to Cloudflare | Not tested; check the current free-plan limits |
| **Publish the API on a server** (section 3) | From ~USD 5/month | Fixed URL, no dependency on a personal PC | Costs money and must be administered |

## 3. Remote hosting (roadmap)

| Option | Approximate cost | Pros | Cons |
|--------|------------------|------|------|
| **VPS** (DigitalOcean, Hetzner, Vultr) with MariaDB + an API | ~USD 4–6/month | Fixed URL; teaches SSH, Linux and firewalls; the database stays on localhost and only the API is exposed | Updates, backups and security are on you |
| **Railway** | USD 5 trial for 30 days; then the Hobby plan, USD 5/month usage-based | One-click MySQL and it also hosts the API; almost no administration | Less infrastructure learning; cost depends on usage |
| **Aiven** (database only) | The free MySQL plan no longer accepts new services; the Developer plan is USD 5/month | Managed database | The API would still need hosting elsewhere |
| **TiDB Cloud** (MySQL-compatible) | Has a free plan (limits not verified) | No server to manage | Database only; compatibility to check |
| **PlanetScale** | Removed its free plan | — | Discarded |

For students, the **GitHub Student Developer Pack** has historically included
DigitalOcean credits; whether it still does was not verified.

## 4. Dashboard tools

| Tool | Runs on | Cost | Pros | Cons |
|------|---------|------|------|------|
| **Power BI Desktop** (the one we used) | Windows 10+ only | Free | Industry standard; DAX; in high demand | No Linux or macOS; without publishing, refresh is manual |
| **Power BI web / Microsoft Fabric** | Browser | License depending on use | Publish and share online | Requires a **work or school** account; personal accounts (including Microsoft 365 Family) are rejected |
| **Own web dashboard** ([`web/`](../web/README.md), React) | Any browser | Free | Any OS; full design control; uses the same API | Has to be coded and maintained |
| **Metabase** | Linux, Windows, macOS (installed as a server) | Free open-source edition | Connects straight to MariaDB; dashboards without coding | Another service to install; it reads the database, not the API |
| **Apache Superset** | Linux (installed as a server) | Open source, free | Very complete; SQL-based | Heavier install; steeper learning curve |

Metabase and Superset are listed as well-known alternatives; they were not installed or
tested in this project.
