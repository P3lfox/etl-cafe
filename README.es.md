# etl-cafe

[English](README.md) | **Español**

Pipeline de datos de punta a punta: un dataset **sucio** de ventas de una cafetería se
limpia, se carga en una base de datos **MariaDB** normalizada, se expone mediante una
**API REST** de solo lectura y se visualiza en un dashboard de **Power BI**. La API está
implementada en **tres lenguajes** (Python, Node.js y Go) y está comprobado que las tres
devuelven respuestas idénticas.

```
dirty_cafe_sales.csv ──► limpieza.py ──► cafe_sales_clean.csv ──► carga.py ──► MariaDB ◄── API ──► Power BI
   (crudo, con errores)    (limpieza)       (+ reporte de limpieza)  (carga)    (normalizada) (JSON)   (dashboard)
                                                                                              ├─ Python (FastAPI) :8000
                                                                                              ├─ Node (Express)   :3000
                                                                                              └─ Go (net/http)    :8080
```

**Validado de punta a punta:** las tarjetas de KPI de Power BI coinciden exactamente con
`/summary` y con el CSV limpio: **80.041,50** de facturación, **9.064** transacciones,
**27.358** unidades vendidas y **8,83** de ticket promedio.

## Estructura del repositorio

| Ruta | Contenido | Documentación |
|------|-----------|---------------|
| `python/` | Limpieza, carga en la base, FastAPI (API de referencia) y todos los tests de Python | [python/README.es.md](python/README.es.md), [recorrido por el código](python/CODE_WALKTHROUGH.es.md) |
| `node/` | La misma API en Node.js + Express | [node/README.es.md](node/README.es.md) |
| `go/` | La misma API en Go | [go/README.es.md](go/README.es.md) |
| `data/raw/` | Dataset crudo con errores | — |
| `data/clean/` | Tabla limpia + reporte de limpieza (generados por `python/limpieza.py`) | — |
| `sql/schema.sql` | Esquema normalizado de la base de datos | más abajo |
| `docs/` | Decisiones de diseño, limitaciones conocidas, fuentes de datos y alternativas, instalación en Windows | [docs/decisions.es.md](docs/decisions.es.md), [docs/sources-and-alternatives.es.md](docs/sources-and-alternatives.es.md), [docs/windows-setup.es.md](docs/windows-setup.es.md) |
| `powerbi/` | Dashboard de Power BI (`etl-cafe.pbix`) + guía paso a paso | [powerbi/README.es.md](powerbi/README.es.md) |
| `web/` | Dashboard web en React (funciona en cualquier sistema operativo) | [web/README.es.md](web/README.es.md) |
| `.env` | Credenciales de la base, compartidas por todos los lenguajes (ignorado por git) | más abajo |

## Inicio rápido

> **¿En Windows?** Los comandos de abajo son para Linux; en su lugar, seguir
> [docs/windows-setup.es.md](docs/windows-setup.es.md).

1. **Crear la base de datos y un usuario dedicado** (en MariaDB, `root` suele requerir `sudo`):
   ```bash
   sudo mariadb -e "CREATE DATABASE IF NOT EXISTS cafe_sales CHARACTER SET utf8mb4;
   CREATE USER IF NOT EXISTS 'etl_cafe'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD';
   GRANT ALL PRIVILEGES ON cafe_sales.* TO 'etl_cafe'@'localhost';"
   ```
2. **Crear el archivo `.env` en la raíz del repositorio.** Todos los lenguajes leen este mismo archivo:
   ```
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=etl_cafe
   DB_PASSWORD=YOUR_PASSWORD
   DB_NAME=cafe_sales
   ```
3. **Limpiar y cargar los datos** (con Python; ver [python/README.es.md](python/README.es.md)):
   ```bash
   cd python
   uv sync
   uv run python limpieza.py
   uv run python carga.py
   ```
4. **Levantar cualquiera de las APIs** y abrirla en el navegador:

   | Lenguaje | Comando | URL |
   |----------|---------|-----|
   | Python | `cd python && uv run uvicorn api:app --reload` | <http://127.0.0.1:8000/docs> |
   | Node | `cd node && npm install && npm start` | <http://127.0.0.1:3000/summary> |
   | Go | `cd go && go run .` | <http://127.0.0.1:8080/summary> |

5. **Abrir un dashboard:** el web con `cd web && npm install && npm run dev`
   (<http://localhost:5173>, ver [web/README.es.md](web/README.es.md)), o Power BI en Windows
   (ver [powerbi/README.es.md](powerbi/README.es.md)).

## Dataset

[Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)
(Kaggle), usado tal cual: 10.000 transacciones y 8 columnas. Los errores aparecen como
`ERROR`, `UNKNOWN` o celdas vacías en todas las columnas. Después de la limpieza quedan
**9.064** filas sin ninguna celda vacía; los valores se reconstruyen de forma
determinística, nunca se inventan. Reglas y números en
[python/README.es.md](python/README.es.md#limpieza--limpiezapy).

## Base de datos

`sql/schema.sql` define un esquema normalizado: las tablas de referencia guardan cada
valor una sola vez y `sales` las referencia mediante claves foráneas.

```
items (item_id PK, name, menu_price)              ┐
payment_methods (payment_method_id PK, name)      ├──< sales (transaction_id PK, transaction_date,
locations (location_id PK, name)                  ┘            item_id FK, quantity, price_per_unit,
                                                               total_spent, payment_method_id FK, location_id FK)
```

Tiene restricciones `CHECK (> 0)` sobre cantidades y montos, y un índice sobre `transaction_date`.

## Contrato de la API

Todas las implementaciones exponen los mismos endpoints de solo lectura. Los datos entran
únicamente por el pipeline, así que no hay endpoints `POST`/`PUT`/`DELETE` (menor
superficie de ataque).

| Endpoint | Devuelve |
|----------|----------|
| `GET /sales` | Lista de ventas. Filtros: `date_from`, `date_to`, `item`, `payment_method`, `location`, `limit` (1–10.000, por defecto 100), `offset` |
| `GET /sales/{transaction_id}` | Una venta, o `404` |
| `GET /summary` | KPIs + totales por producto, medio de pago, ubicación y mes. Acepta `date_from` y `date_to` opcionales |

| Código | Cuándo |
|--------|--------|
| `200` | OK |
| `404` | Venta inexistente |
| `422` | Parámetro inválido (por ejemplo `limit=0`, `date_from=ayer`, o `date_from` posterior a `date_to`) |
| `503` | Base de datos no disponible |

La API de Python también publica el contrato en formato OpenAPI en `/openapi.json`
(documentación interactiva en `/docs`).

### Test de contrato

`python/tests/test_contract.py` toma la API de Python como referencia y envía los mismos
pedidos a las APIs de Node y Go, exigiendo **el mismo código de estado y el mismo cuerpo
JSON** (para los `422` por parámetros inválidos solo se compara el código, porque FastAPI
usa su propio formato de error). Última ejecución: **34/34 aprobados**.

```bash
(cd python && uv run uvicorn api:app --port 8000)   # terminal 1 (referencia)
(cd node && npm start)                               # terminal 2
(cd go && go run .)                                  # terminal 3
cd python && PY_API_URL=http://127.0.0.1:8000 NODE_API_URL=http://127.0.0.1:3000 \
  GO_API_URL=http://127.0.0.1:8080 uv run pytest tests/test_contract.py
```

Las implementaciones sin URL se omiten, así que la ejecución normal de los tests no necesita servidores.

> Esto es una arquitectura **políglota**, no escalado horizontal. Escalar horizontalmente
> significa tener varias copias del **mismo** servicio detrás de un balanceador de carga.

## Dashboard de Power BI

`powerbi/etl-cafe.pbix` consume la API por HTTP: un parámetro `ApiUrl`, una consulta de
Power Query sobre `GET /sales?limit=10000`, una tabla de fechas `Calendar`, siete medidas
DAX y 11 visuales (tarjetas de KPI, torta, líneas, barras, tabla, combinado de crecimiento
mensual, mapa de árbol y columnas por día de la semana). Como Power BI Desktop solo
funciona en Windows, se accede a la API a través de un Cloudflare Quick Tunnel gratuito.

Guía paso a paso, desde la instalación de Power BI hasta la resolución de problemas:
[powerbi/README.es.md](powerbi/README.es.md).

## Dashboard web

`web/` muestra los mismos KPIs en el navegador con React y Recharts, en cualquier sistema
operativo, con un filtro de fechas y una vista de tabla en cada gráfico. Un proxy de Vite
reenvía `/api` a la API elegida con `API_TARGET`. Ver [web/README.es.md](web/README.es.md).

## Hoja de ruta

- [ ] **Hosting remoto:** un VPS (~USD 5/mes) con MariaDB + una API, exponiendo solo la API
      y con MariaDB escuchando en localhost; o Railway como alternativa administrada. Le
      da a Power BI una URL fija en lugar del túnel temporal.
- [x] **API políglota:** implementaciones en Node/Express y Go con tests de contrato.
