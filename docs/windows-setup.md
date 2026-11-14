# Windows setup

**English** | [Español](windows-setup.es.md)

The rest of the documentation uses Linux commands. This guide explains how to reproduce the
whole project on **Windows 10 or 11**, which commands change, and the most common errors.
Project overview: [../README.md](../README.md).

> **The Windows advantage:** if the API and Power BI run **on the same PC**, the Cloudflare
> tunnel is not needed. In Power BI, `ApiUrl` can simply be `http://127.0.0.1:8000`.

> This guide was written from Linux and **has not been tested on a Windows PC**. The install
> commands were checked against each tool's official documentation; if a step fails, please
> note it here for the rest of the team.

## Quick path

1. [Install the tools](#1-install-the-tools) (once).
2. [Prepare MariaDB](#2-prepare-mariadb): user and database.
3. [Clone the repository and create the `.env`](#3-clone-the-repository-and-create-the-env).
4. [Run the pipeline](#4-run-the-pipeline): cleaning, load and API.
5. [Open a dashboard](#5-open-a-dashboard): Power BI or the web one.

All commands are for **PowerShell** (Start menu → "Terminal" or "PowerShell").

## 1. Install the tools

`winget` ships with up-to-date Windows 10 and Windows 11. In PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e          # Python and its dependencies (uv downloads Python 3.13 itself)
winget install --id MariaDB.Server -e        # the database
winget install --id OpenJS.NodeJS.LTS -e     # only for the Node API and the web dashboard
winget install --id GoLang.Go -e             # only for the Go API
winget install --id Cloudflare.cloudflared -e   # only if Power BI runs on ANOTHER PC
```

After installing, **close and reopen PowerShell** so it picks up the new programs.

| Tool | Required? | If `winget` fails |
|------|-----------|-------------------|
| Git | Yes | [git-scm.com](https://git-scm.com/) |
| uv | Yes | `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| MariaDB | Yes | `.msi` installer from [mariadb.org](https://mariadb.org/download/) |
| Node.js | Only for `node/` and `web/` | [nodejs.org](https://nodejs.org/) (LTS) |
| Go | Only for `go/` | [go.dev/dl](https://go.dev/dl/) |
| cloudflared | Only if Power BI runs on another PC | See Cloudflare's documentation |
| Power BI Desktop | For the Power BI dashboard | Microsoft Store |

## 2. Prepare MariaDB

**Difference from Linux:** Windows has no `sudo`, and `root` does not log in through the
system user. The MariaDB installer **asks for a `root` password** during installation and
leaves MariaDB running as a Windows service. Write that password down.

1. Open the MariaDB client as `root`:

   ```powershell
   mariadb -u root -p
   ```

   If PowerShell cannot find `mariadb`, use the **"MariaDB Client"** Start menu entry, or the
   full path (the version may differ):
   `& "C:\Program Files\MariaDB 12.3\bin\mariadb.exe" -u root -p`

2. Enter the `root` password and paste these three lines, replacing `YOUR_PASSWORD`:

   ```sql
   CREATE DATABASE IF NOT EXISTS cafe_sales CHARACTER SET utf8mb4;
   CREATE USER IF NOT EXISTS 'etl_cafe'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
   GRANT ALL PRIVILEGES ON cafe_sales.* TO 'etl_cafe'@'localhost';
   ```

3. Leave with `exit`.

If the `etl_cafe` user already existed with another password, `CREATE USER IF NOT EXISTS`
**does not change it**: use `ALTER USER 'etl_cafe'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';`.

## 3. Clone the repository and create the `.env`

```powershell
git clone https://github.com/P3lfox/etl-cafe.git
cd etl-cafe
```

Create the **`.env`** file in the repository root with **Notepad or VS Code**:

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=etl_cafe
DB_PASSWORD=YOUR_PASSWORD
DB_NAME=cafe_sales
```

`.env` pitfalls on Windows:

- The name must be exactly `.env`, **not** `.env.txt`. In Notepad, choose "All files" when
  saving. To check: `Get-ChildItem -Force .env`.
- **Do not create it with `echo ... > .env`** in Windows PowerShell 5.1: it saves the file as
  UTF-16, which Python, Node and Go do not read correctly.

## 4. Run the pipeline

**Each language runs from its own folder.** Running from the root gives
`Could not import module "api"`.

```powershell
cd python
uv sync                              # installs dependencies (and Python, if needed)
uv run python limpieza.py            # 1. cleaning -> ..\data\clean\
uv run python carga.py               # 2. load into MariaDB (should report 9064 rows)
uv run uvicorn api:app --reload      # 3. API -> http://127.0.0.1:8000/docs
uv run pytest                        # tests (no database needed)
```

The other APIs, each in its own PowerShell window:

```powershell
cd node; npm install; npm start      # http://127.0.0.1:3000
cd go; go run .                      # http://127.0.0.1:8080
```

The dataset is already included in `data\raw\`, so there is nothing to download.

## 5. Open a dashboard

### Power BI on the same PC (recommended)

With the API running, follow the [Power BI guide](../powerbi/README.md) and use
**`http://127.0.0.1:8000`** as `ApiUrl`. No tunnel needed (skip section 2 of that guide).

### Power BI on another PC

The tunnel is needed on the PC running the API:

```powershell
cloudflared tunnel --url http://localhost:8000
```

### Web dashboard

```powershell
cd web
npm install
npm run dev                          # http://localhost:5173
```

## Commands that differ from Linux

| To… | Linux (rest of the docs) | Windows PowerShell |
|-----|--------------------------|--------------------|
| Set a variable for one command | `API_TARGET=http://127.0.0.1:3000 npm run dev` | `$env:API_TARGET="http://127.0.0.1:3000"; npm run dev` |
| Remove that variable | (not needed) | `Remove-Item Env:API_TARGET` |
| Several variables (contract test) | `PY_API_URL=... NODE_API_URL=... uv run pytest ...` | `$env:PY_API_URL="http://127.0.0.1:8000"; $env:NODE_API_URL="http://127.0.0.1:3000"; $env:GO_API_URL="http://127.0.0.1:8080"; uv run pytest tests/test_contract.py` |
| Create the database and user | `sudo mariadb -e "..."` | `mariadb -u root -p` and paste the SQL (section 2) |
| Install cloudflared | `sudo pacman -S cloudflared` | `winget install --id Cloudflare.cloudflared -e` |
| See what uses port 8000 | `fuser -v 8000/tcp` | `Get-NetTCPConnection -LocalPort 8000 \| Select-Object OwningProcess` |
| Free port 8000 | `fuser -k 8000/tcp` | `Stop-Process -Id <OwningProcess>` |
| Download a file | `curl -L -o file URL` | `curl.exe -L -o file URL` (with `.exe`: in Windows PowerShell 5.1, `curl` is a different command) |
| Unzip a `.zip` | `unzip file.zip -d folder` | `Expand-Archive file.zip -DestinationPath folder -Force` |

In **cmd.exe** (the classic Command Prompt), set a variable with
`set API_TARGET=http://127.0.0.1:3000` and run `npm run dev` on a separate line.

## Common problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| `uv`, `node`, `go` or `mariadb` "is not recognized as a command" | PowerShell does not see newly installed programs | Close and reopen PowerShell; if it persists, restart the PC |
| `Could not import module "api"` | The command ran outside `python\` | `cd python` and run it again |
| `Access denied for user 'etl_cafe'` | The `.env` password does not match MariaDB's | `ALTER USER` (section 2) and check the `.env` |
| `KeyError: 'DB_USER'` or similar | The `.env` was not found | Check it is named `.env` (not `.env.txt`) and sits in the repository root |
| `Can't connect to MySQL server on '127.0.0.1'` | The MariaDB service is stopped | In PowerShell as administrator: `Start-Service MariaDB` |
| `address already in use` / `[Errno 10048]` | Another API already uses that port | Free it (table above) or use another one: `uv run uvicorn api:app --port 8001` |
| Windows asks for a firewall permission when the API starts | Normal the first time | Allow it on **private networks** only |
| Running scripts is disabled when installing uv | PowerShell execution policy | Use `winget install --id astral-sh.uv -e` |
| `git status` shows changes in `data\clean\` after cleaning | On Windows, pandas writes CSVs with `CRLF` line endings instead of `LF` | The data is the same; discard with `git restore data/clean` |
