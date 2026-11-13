# Python — ETL + API de referencia

[English](README.md) | **Español**

La parte de Python ejecuta **todo el pipeline de datos** (limpieza y carga) y expone la
**API de referencia** contra la que se prueban las implementaciones de Node y Go.
Vista general del proyecto: [../README.es.md](../README.es.md).

## Camino rápido

Requisitos: [uv](https://docs.astral.sh/uv/), MariaDB/MySQL y el archivo `.env` en la
raíz del repositorio (ver el README principal).

```bash
cd python
uv sync                              # instala las dependencias
uv run python limpieza.py            # 1. limpieza -> ../data/clean/
uv run python carga.py               # 2. carga    -> MariaDB
uv run uvicorn api:app --reload      # 3. API      -> http://127.0.0.1:8000/docs
uv run pytest                        # tests (no necesitan base de datos)
```

Los scripts resuelven `data/`, `sql/` y `.env` a partir de la raíz del repositorio, así
que funcionan desde cualquier directorio.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `limpieza.py` | Paso 1: limpieza (`clean()` es una función pura y `main()` lee y escribe los archivos) |
| `carga.py` | Paso 2: carga del CSV limpio en MariaDB |
| `db.py` | Configuración de conexión compartida, leída desde `../.env` |
| `api.py` | Paso 3: FastAPI de solo lectura (implementación de referencia) |
| `tests/test_limpieza.py` | Reglas de limpieza |
| `tests/test_carga.py` | Funciones auxiliares de la carga y lectura del esquema |
| `tests/test_api.py` | Rutas, validación y códigos de error, con un repositorio falso |
| `tests/test_contract.py` | Test de contrato entre lenguajes (necesita los servidores levantados) |

## Limpieza — `limpieza.py`

**Principio: reconstruir solo lo que se puede deducir con exactitud, nunca inventar datos**
(sin imputar con media ni moda).

| Regla | Cómo |
|-------|------|
| Valores centinela | `ERROR`, `UNKNOWN` y las celdas vacías pasan a ser valores faltantes reales |
| Valores imposibles | Cantidad, precio o total `<= 0` se tratan como faltantes |
| Total / cantidad / precio | `total = cantidad × precio`, así que cualquiera se deduce de los otros dos |
| Precio ↔ producto | Cada producto tiene un precio de menú fijo (Coffee 2.0, Tea 1.5, Cookie 1.0, Salad 5.0…), así que uno permite deducir el otro |
| Precios ambiguos | 3.0 es Juice **o** Cake, y 4.0 es Sandwich **o** Smoothie: el producto no se puede deducir y la fila se descarta |
| Fechas | Formato estricto `YYYY-MM-DD`; las fechas inválidas o faltantes se descartan (no se pueden deducir) |
| Medio de pago / ubicación | Si falta, pasa a `Unknown` (descartar alrededor del 30% de las filas sería peor) |
| Duplicados | Se eliminan por `transaction_id` |

Resultados (de `../data/clean/cleaning_report.csv`):

| Métrica | Filas |
|---------|------:|
| Entrada | 10.000 |
| Producto reconstruido | 471 |
| Cantidad reconstruida | 431 |
| Precio reconstruido | 500 |
| Total reconstruido | 453 |
| Descartadas: fecha inválida | 460 |
| Descartadas: irrecuperables | 476 |
| Descartadas: duplicados | 0 |
| Medio de pago `Unknown` | 2.870 |
| Ubicación `Unknown` | 3.592 |
| **Salida** | **9.064** (0 celdas vacías) |

## Carga — `carga.py`

- Crea el esquema a partir de `../sql/schema.sql` si no existe.
- Completa las tablas de referencia (`items`, `payment_methods`, `locations`) e inserta o actualiza cada venta.
- Corre en **una sola transacción**: ante cualquier error hace rollback y nada queda cargado a medias.
- **Idempotente:** al volver a ejecutarla usa `ON DUPLICATE KEY UPDATE`, así que las filas se actualizan en lugar de duplicarse.

Verificado: 9.064 filas en el CSV = 9.064 en `sales`; las sumas de facturación y unidades coinciden; 0 claves foráneas huérfanas.

## API — `api.py`

FastAPI convierte las anotaciones de tipos en validación (`422` automático) y genera la
documentación interactiva en `/docs` y el contrato OpenAPI en `/openapi.json`. Endpoints y
códigos de estado: [README principal → Contrato de la API](../README.es.md#contrato-de-la-api).

| Capa | Responsabilidad |
|------|-----------------|
| Modelos de Pydantic (`Sale`, `Group`, `Summary`) | Forma de las respuestas JSON |
| `SaleFilters` | Arma una cláusula `WHERE` **parametrizada** (sin inyección SQL) |
| `SalesRepository` | Concentra todo el SQL |
| `get_repository` | Dependencia que abre y cierra la conexión; los tests la reemplazan por una falsa |
| Manejador de excepciones | Cualquier error de base de datos → `503 {"detail": "Database unavailable"}` |

> Detalle a tener en cuenta: con PyMySQL, un `%` literal en el SQL debe escribirse `%%`
> cuando se pasan parámetros (por ejemplo `DATE_FORMAT(..., '%%Y-%%m')`).
