# Instalación en Windows

[English](windows-setup.md) | **Español**

El resto de la documentación usa comandos de Linux. Esta guía explica cómo replicar todo el
proyecto en **Windows 10 u 11**, qué comandos cambian y cuáles son los errores más comunes.
Vista general del proyecto: [../README.es.md](../README.es.md).

> **La ventaja de Windows:** si la API y Power BI corren **en la misma PC**, no hace falta el
> túnel de Cloudflare. En Power BI, `ApiUrl` puede ser directamente `http://127.0.0.1:8000`.

> Esta guía se escribió desde Linux y **no se probó en una PC con Windows**. Los comandos de
> instalación se verificaron en la documentación oficial de cada herramienta; si algún paso
> falla, conviene anotarlo acá para el resto del equipo.

## Camino rápido

1. [Instalar las herramientas](#1-instalar-las-herramientas) (una sola vez).
2. [Preparar MariaDB](#2-preparar-mariadb): usuario y base de datos.
3. [Clonar el repositorio y crear el `.env`](#3-clonar-el-repositorio-y-crear-el-env).
4. [Correr el pipeline](#4-correr-el-pipeline): limpieza, carga y API.
5. [Abrir un dashboard](#5-abrir-un-dashboard): Power BI o el web.

Todos los comandos son para **PowerShell** (menú Inicio → "Terminal" o "PowerShell").

## 1. Instalar las herramientas

`winget` viene incluido en Windows 10 (actualizado) y Windows 11. En PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id astral-sh.uv -e          # Python y sus dependencias (uv descarga Python 3.13 solo)
winget install --id MariaDB.Server -e        # la base de datos
winget install --id OpenJS.NodeJS.LTS -e     # solo para la API de Node y el dashboard web
winget install --id GoLang.Go -e             # solo para la API de Go
winget install --id Cloudflare.cloudflared -e   # solo si Power BI corre en OTRA PC
```

Después de instalar, **cerrar y volver a abrir PowerShell** para que reconozca los programas nuevos.

| Herramienta | ¿Es obligatoria? | Si `winget` falla |
|-------------|------------------|-------------------|
| Git | Sí | [git-scm.com](https://git-scm.com/) |
| uv | Sí | `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| MariaDB | Sí | Instalador `.msi` de [mariadb.org](https://mariadb.org/download/) |
| Node.js | Solo para `node/` y `web/` | [nodejs.org](https://nodejs.org/) (versión LTS) |
| Go | Solo para `go/` | [go.dev/dl](https://go.dev/dl/) |
| cloudflared | Solo si Power BI corre en otra PC | Ver la documentación de Cloudflare |
| Power BI Desktop | Para el dashboard de Power BI | Microsoft Store |

## 2. Preparar MariaDB

**Diferencia con Linux:** en Windows no existe `sudo`, y `root` no entra con el usuario del
sistema. El instalador de MariaDB **pide una contraseña para `root`** durante la instalación
y deja MariaDB funcionando como un servicio de Windows. Hay que anotar esa contraseña.

1. Abrir el cliente de MariaDB como `root`:

   ```powershell
   mariadb -u root -p
   ```

   Si PowerShell no encuentra `mariadb`, usar el acceso **"MariaDB Client"** del menú Inicio,
   o la ruta completa (la versión puede cambiar):
   `& "C:\Program Files\MariaDB 12.3\bin\mariadb.exe" -u root -p`

2. Ingresar la contraseña de `root` y pegar estas tres líneas, cambiando `TU_PASSWORD`:

   ```sql
   CREATE DATABASE IF NOT EXISTS cafe_sales CHARACTER SET utf8mb4;
   CREATE USER IF NOT EXISTS 'etl_cafe'@'localhost' IDENTIFIED BY 'TU_PASSWORD';
   GRANT ALL PRIVILEGES ON cafe_sales.* TO 'etl_cafe'@'localhost';
   ```

3. Salir con `exit`.

Si el usuario `etl_cafe` ya existía con otra contraseña, `CREATE USER IF NOT EXISTS` **no la
cambia**: usar `ALTER USER 'etl_cafe'@'localhost' IDENTIFIED BY 'TU_PASSWORD';`.

## 3. Clonar el repositorio y crear el `.env`

```powershell
git clone https://github.com/P3lfox/etl-cafe.git
cd etl-cafe
```

Crear el archivo **`.env`** en la raíz del repositorio con **el Bloc de notas o VS Code**:

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=etl_cafe
DB_PASSWORD=TU_PASSWORD
DB_NAME=cafe_sales
```

Cuidados con el `.env` en Windows:

- El nombre tiene que ser exactamente `.env`, **no** `.env.txt`. En el Bloc de notas, elegir
  "Todos los archivos" al guardar. Para comprobarlo: `Get-ChildItem -Force .env`.
- **No crearlo con `echo ... > .env`** en Windows PowerShell 5.1: guarda el archivo en
  UTF-16, y Python, Node y Go no lo leen bien.

## 4. Correr el pipeline

**Cada lenguaje se corre desde su carpeta.** Si se ejecuta desde la raíz, aparece
`Could not import module "api"`.

```powershell
cd python
uv sync                              # instala las dependencias (y Python, si hace falta)
uv run python limpieza.py            # 1. limpieza -> ..\data\clean\
uv run python carga.py               # 2. carga en MariaDB (debe decir 9064 filas)
uv run uvicorn api:app --reload      # 3. API -> http://127.0.0.1:8000/docs
uv run pytest                        # tests (no necesitan la base)
```

Las otras APIs, cada una en su propia ventana de PowerShell:

```powershell
cd node; npm install; npm start      # http://127.0.0.1:3000
cd go; go run .                      # http://127.0.0.1:8080
```

El dataset ya viene incluido en `data\raw\`, así que no hace falta descargarlo.

## 5. Abrir un dashboard

### Power BI en la misma PC (recomendado)

Con la API corriendo, seguir la [guía de Power BI](../powerbi/README.es.md) y usar como
`ApiUrl` **`http://127.0.0.1:8000`**. No hace falta el túnel (se saltea la sección 2 de esa guía).

### Power BI en otra PC

Hace falta el túnel en la PC donde corre la API:

```powershell
cloudflared tunnel --url http://localhost:8000
```

### Dashboard web

```powershell
cd web
npm install
npm run dev                          # http://localhost:5173
```

## Comandos que cambian respecto de Linux

| Para… | Linux (resto de la documentación) | Windows PowerShell |
|-------|-----------------------------------|--------------------|
| Definir una variable para un comando | `API_TARGET=http://127.0.0.1:3000 npm run dev` | `$env:API_TARGET="http://127.0.0.1:3000"; npm run dev` |
| Quitar esa variable | (no hace falta) | `Remove-Item Env:API_TARGET` |
| Varias variables (test de contrato) | `PY_API_URL=... NODE_API_URL=... uv run pytest ...` | `$env:PY_API_URL="http://127.0.0.1:8000"; $env:NODE_API_URL="http://127.0.0.1:3000"; $env:GO_API_URL="http://127.0.0.1:8080"; uv run pytest tests/test_contract.py` |
| Crear la base y el usuario | `sudo mariadb -e "..."` | `mariadb -u root -p` y pegar el SQL (sección 2) |
| Instalar cloudflared | `sudo pacman -S cloudflared` | `winget install --id Cloudflare.cloudflared -e` |
| Ver qué ocupa el puerto 8000 | `fuser -v 8000/tcp` | `Get-NetTCPConnection -LocalPort 8000 \| Select-Object OwningProcess` |
| Liberar el puerto 8000 | `fuser -k 8000/tcp` | `Stop-Process -Id <OwningProcess>` |
| Descargar un archivo | `curl -L -o archivo URL` | `curl.exe -L -o archivo URL` (con `.exe`: en Windows PowerShell 5.1, `curl` es otro comando) |
| Descomprimir un `.zip` | `unzip archivo.zip -d carpeta` | `Expand-Archive archivo.zip -DestinationPath carpeta -Force` |

En **cmd.exe** (el "Símbolo del sistema" clásico), una variable se define con
`set API_TARGET=http://127.0.0.1:3000` y después se ejecuta `npm run dev` en una línea aparte.

## Problemas comunes

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `uv`, `node`, `go` o `mariadb` "no se reconoce como comando" | PowerShell no ve los programas recién instalados | Cerrar y abrir PowerShell; si sigue, reiniciar la PC |
| `Could not import module "api"` | El comando se ejecutó fuera de `python\` | `cd python` y volver a ejecutarlo |
| `Access denied for user 'etl_cafe'` | La contraseña del `.env` no coincide con la de MariaDB | `ALTER USER` (sección 2) y revisar el `.env` |
| `KeyError: 'DB_USER'` o similar | No se encontró el `.env` | Verificar que se llame `.env` (no `.env.txt`) y que esté en la raíz del repositorio |
| `Can't connect to MySQL server on '127.0.0.1'` | El servicio de MariaDB está detenido | En PowerShell como administrador: `Start-Service MariaDB` |
| `address already in use` / `[Errno 10048]` | Otra API ya usa ese puerto | Liberarlo (tabla anterior) o usar otro: `uv run uvicorn api:app --port 8001` |
| Windows pide permiso de firewall al levantar la API | Normal la primera vez | Permitir solo en **redes privadas** |
| La ejecución de scripts está deshabilitada al instalar uv | Política de ejecución de PowerShell | Usar `winget install --id astral-sh.uv -e` |
| `git status` muestra cambios en `data\clean\` después de correr la limpieza | En Windows, pandas guarda los CSV con fin de línea `CRLF` en lugar de `LF` | Los datos son los mismos; descartar con `git restore data/clean` |
