# Recorrido por el código de Python

[English](CODE_WALKTHROUGH.md) | **Español**

Explicación paso a paso de cómo funcionan `limpieza.py`, `carga.py` y `api.py`, siguiendo
el recorrido de los datos: entra el CSV sucio, sale una tabla limpia, se carga en MariaDB
y la API la sirve como JSON. Para *cómo ejecutarlo*, ver [README.es.md](README.es.md); para
*por qué* se decidió así, ver [../docs/decisions.es.md](../docs/decisions.es.md).

## Índice

1. [`limpieza.py` — limpieza](#1-limpiezapy--limpieza)
2. [`carga.py` — carga en MariaDB](#2-cargapy--carga-en-mariadb)
3. [`api.py` — la API](#3-apipy--la-api)
4. [Mejoras posibles](#4-mejoras-posibles)

---

## 1. `limpieza.py` — limpieza

### La idea general

```
main()  →  lee el CSV  →  clean(raw)  →  guarda CSV limpio + reporte
                              │
                              ├─ 1. normalizar textos y centinelas
                              ├─ 2. eliminar duplicados
                              ├─ 3. convertir tipos (números, fechas)
                              ├─ 4. descartar fechas inválidas
                              ├─ 5. reconstruir valores  ← el corazón
                              ├─ 6. descartar lo irrecuperable
                              ├─ 7. completar con "Unknown"
                              └─ 8. tipos finales y orden
```

**Decisión de diseño clave:** `clean()` no lee ni escribe archivos. Recibe un DataFrame y
devuelve otro DataFrame más el reporte. Por eso se puede testear con tablas pequeñas
armadas a mano, sin tocar el disco. Todo lo que es entrada y salida de archivos vive en
`main()`. Es el mismo principio que separa la lógica de negocio del handler HTTP en Express.

### Paso 0: leer sin que pandas "ayude"

```python
raw = pd.read_csv(RAW_FILE, dtype=str, keep_default_na=False)
```

- `dtype=str`: todo entra como **texto**. Si pandas viera `"ERROR"` en una columna
  numérica, la convertiría a su manera y se perdería el control.
- `keep_default_na=False`: por defecto pandas convierte automáticamente valores como `"NA"`
  o `""` en nulos. Se desactiva para que **el código** decida qué es un faltante.

Primero se lee todo en crudo, y después se decide.

### Paso 1: normalizar textos y centinelas

```python
SENTINELS = {"", "ERROR", "UNKNOWN"}

def normalize_text(df):
    df = df.apply(lambda s: s.str.strip())
    return df.mask(df.isna() | df.apply(lambda s: s.str.upper().isin(SENTINELS)))
```

- `s.str.strip()` quita los espacios al principio y al final de cada celda.
- `s.str.upper().isin(SENTINELS)` arma una tabla de `True`/`False` que indica si cada celda
  es `""`, `ERROR` o `UNKNOWN`. El `upper()` hace que `error` o `Unknown` también cuenten.
- `df.mask(condición)` reemplaza por **nulo** cada celda donde la condición es `True`.

A partir de acá, un dato faltante es siempre un nulo real, sin importar cómo venía escrito.

### Paso 2: duplicados

```python
df = df.drop_duplicates(subset="transaction_id", keep="first")
report["dropped_duplicates"] = before - len(df)
```

Si dos filas tienen el mismo ID de transacción, se conserva la primera. En este dataset da
0, pero la regla queda por si en el futuro llegan datos con duplicados.

El patrón **contar antes, operar, contar después** se repite en todo el archivo: la
diferencia se guarda en el reporte. Así el reporte de limpieza puede decir exactamente
cuánto hizo cada paso.

### Paso 3: convertir tipos

```python
for col in NUMERIC_COLUMNS:
    df[col] = pd.to_numeric(df[col], errors="coerce")
    df.loc[df[col] <= 0, col] = None
df["transaction_date"] = pd.to_datetime(df["transaction_date"], format="%Y-%m-%d", errors="coerce")
```

- `errors="coerce"`: si algo no se puede convertir, se vuelve nulo en lugar de lanzar un
  error. Así `"abc"` en una cantidad pasa a ser un faltante.
- `df.loc[df[col] <= 0, col] = None` significa "en las filas donde la columna es ≤ 0, poner
  nulo". Una cantidad negativa o un precio en 0 son **imposibles**, así que se tratan como faltantes.
- `format="%Y-%m-%d"` exige exactamente el formato `2023-01-31`. Una fecha como `31/01/2023`
  no se adivina: se vuelve nula.

La línea anterior, `df.astype(object).where(df.notna(), None)`, es un ajuste técnico:
convierte los nulos de pandas en `None` comunes antes de la conversión de tipos.

### Paso 4: fechas inválidas

```python
df = df[df["transaction_date"].notna()].copy()
```

Es la forma típica de filtrar en pandas: `df[condición]` se queda **solo con las filas
donde la condición es `True`**. Una fecha no se puede deducir de ninguna otra columna, así
que esas filas se descartan (460).

### Paso 5: reconstruir valores — el corazón

Primero se arma el **menú**, deducido de los propios datos:

```python
def build_menu(df):
    known = df.dropna(subset=["item", "price_per_unit"])
    item_to_price = known.groupby("item")["price_per_unit"].agg(lambda s: s.mode().iloc[0])
    items_per_price = item_to_price.reset_index().groupby("price_per_unit")["item"]
    unique = items_per_price.nunique() == 1
    price_to_item = items_per_price.first()[unique]
    return item_to_price, price_to_item
```

1. `known` toma solo las filas que tienen producto **y** precio.
2. `groupby("item")...mode()` obtiene, para cada producto, su precio más frecuente:
   Coffee → 2.0, Tea → 1.5, etc.
3. Después invierte el mapa: para cada precio, cuántos productos distintos lo tienen (`nunique`).
4. `price_to_item` se queda **solo con los precios que corresponden a un único producto**.
   El 3.0 (Juice o Cake) y el 4.0 (Sandwich o Smoothie) quedan afuera por ambiguos.

Ese último paso es lo que evita inventar datos: si el precio es 3.0, el código **no adivina**
si fue un jugo o una torta.

Después, la reconstrucción:

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

Dos herramientas clave:

- **`fillna(x)` solo rellena los huecos.** Si el valor ya existía, no lo toca: nunca pisa un dato real.
- **`map(diccionario)` traduce** cada valor usando el diccionario: si el producto es
  `"Tea"`, `map(item_to_price)` devuelve `1.5`.

Ejemplo con una fila:

| Paso | item | quantity | price | total |
|------|------|----------|-------|-------|
| Original | `ERROR` → nulo | 3 | 2.0 | nulo |
| Producto a partir del precio (2.0 → Coffee, único) | **Coffee** | 3 | 2.0 | nulo |
| total = 3 × 2.0 | Coffee | 3 | 2.0 | **6.0** |

- **Cantidad entera:** `total ÷ precio` solo se acepta si da un número entero, con una
  tolerancia de 0,01 para errores de redondeo. Si da 2,7 unidades, algo está mal y no se rellena.
- **Por qué el bucle corre 2 veces:** un valor reconstruido en la primera pasada puede
  habilitar otro en la segunda. Por ejemplo, el precio que se obtiene del total en la
  tercera línea recién permite deducir el producto en la vuelta siguiente.

### Paso 6: descartar lo irrecuperable

```python
unrecoverable = df[REBUILDABLE_COLUMNS].isna().any(axis=1)
df = df[~unrecoverable].copy()

inconsistent = (df["quantity"] * df["price_per_unit"] - df["total_spent"]).abs() > TOLERANCE
df = df[~inconsistent].copy()
```

- `.isna().any(axis=1)` pregunta, fila por fila, si **alguna** de las 4 columnas sigue
  vacía. `axis=1` significa "recorrer a lo ancho de cada fila".
- `~` es la negación en pandas: `df[~unrecoverable]` conserva las filas que **no** son irrecuperables.
- El control de consistencia verifica que `cantidad × precio = total`. Es la red de
  seguridad final; en este dataset da 0.

### Paso 7: `Unknown`

```python
df[col] = df[col].fillna(UNKNOWN_LABEL)
```

Para el medio de pago y la ubicación, el faltante se **etiqueta** como `Unknown` en lugar de
descartar la fila (decisión D3): descartar esas filas haría perder cerca del 40% de las ventas.

### Paso 8: tipos finales y salida

`astype(...)` fija el tipo de cada columna (la cantidad como entero, los precios como
decimal) y `sort_values` ordena por fecha. `main()` guarda dos archivos:

- `cafe_sales_clean.csv`: la tabla limpia.
- `cleaning_report.csv`: el diccionario `report`, que se fue completando paso a paso, convertido en tabla.

### Cómo se prueba

`tests/test_limpieza.py` arma DataFrames de pocas filas a mano, uno por regla, y verifica
el resultado. Por ejemplo, el del precio ambiguo:

```python
def test_ambiguous_price_cannot_rebuild_item_and_row_is_dropped():
    df, report = run(["TXN_9", "", "1", "3.0", "3.0", "Cash", "Takeaway", "2023-02-01"])
    assert "TXN_9" not in df["transaction_id"].values
    assert report["dropped_unrecoverable"] == 1
```

Esa es la ventaja de que `clean()` sea una función pura: cada regla de la limpieza tiene un
test que la demuestra.

---

## 2. `carga.py` — carga en MariaDB

### La idea general

```
main()  →  lee el CSV limpio  →  connect()  →  load(df, conn)  →  imprime filas
                                                   │
                                     una sola TRANSACCIÓN:
                                                   ├─ 1. crear tablas (schema.sql)
                                                   ├─ 2. tablas de referencia → mapas nombre→id
                                                   ├─ 3. ventas, usando esos ids como FK
                                                   └─ 4. COMMIT  (o ROLLBACK si algo falló)
```

### Paso 1: crear las tablas

```python
def apply_schema(cursor):
    lines = SCHEMA_FILE.read_text(encoding="utf-8").splitlines()
    script = "\n".join(ln for ln in lines if not ln.strip().startswith("--"))
    for statement in script.split(";"):
        sql = statement.strip()
        if sql:
            cursor.execute(sql)
```

El driver ejecuta **una sentencia por vez**, así que el archivo se divide por `;`. El orden
importa: primero se quitan los comentarios (`--`) y **después** se divide. Un comentario
con un `;` cortaba el SQL por la mitad; ese bug se corrigió y tiene su propio test.

Como el esquema usa `CREATE TABLE IF NOT EXISTS`, ejecutarlo varias veces no rompe nada.

### Paso 2: tablas de referencia y el "mapa de ids"

La tabla `sales` no guarda `"Cash"`, sino el **id** de Cash. Por eso primero se cargan los
nombres y se averigua qué id le tocó a cada uno:

```python
def upsert_lookup(cursor, table, id_column, names):
    cursor.executemany(f"INSERT IGNORE INTO {table} (name) VALUES (%s)", [(n,) for n in sorted(names)])
    cursor.execute(f"SELECT name, {id_column} FROM {table}")
    return dict(cursor.fetchall())
```

- `INSERT IGNORE` inserta y, si el nombre ya existe (es `UNIQUE`), lo ignora en lugar de fallar.
- `executemany` envía todas las filas juntas en lugar de un `execute` por fila.
- `dict(cursor.fetchall())` convierte `[("Cash", 1), ("Credit Card", 2), ...]` en `{"Cash": 1, "Credit Card": 2, ...}`.

**Nota de seguridad:** acá hay un f-string con `{table}`, y no es inyección SQL. Los
marcadores `%s` solo sirven para **valores**, no para nombres de tablas; y `table` lo
escribe el programador (`"payment_methods"`), nunca viene del usuario. Los **valores**
(`name`) sí van con `%s`. La regla: **todo lo que viene de afuera, siempre con marcadores**.

Para `items` es parecido, pero con `ON DUPLICATE KEY UPDATE`: si el producto ya existe, se
**actualiza** su precio de menú (el precio más frecuente de cada producto, igual que en la limpieza).

### Paso 3: las ventas

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

- `itertuples` recorre el DataFrame fila por fila; `r.item` accede a cada columna.
- `item_ids[r.item]` hace la traducción: `"Coffee"` pasa a ser el id que le tocó.
- `int()` y `float()` convierten los tipos numéricos de pandas (numpy), que el driver no
  siempre entiende, en números comunes de Python.

Es una función **pura** (recibe datos y devuelve tuplas, sin tocar la base), así que tiene
su propio test sin MariaDB.

Las ventas se insertan con:

```sql
INSERT INTO sales (...) VALUES (%s, %s, ...)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), ...
```

Si el `transaction_id` ya existe, se **actualiza** la fila en lugar de duplicarla. Por eso
la carga es **idempotente**: ejecutarla diez veces deja siempre 9.064 filas.

### Paso 4: la transacción

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

Una transacción es **todo o nada**, como una transferencia bancaria: no puede salir el
dinero de una cuenta sin entrar en la otra.

- Si todo sale bien, `commit()` confirma los cambios.
- Si algo falla a mitad de camino, `rollback()` **deshace todo** lo hecho desde el inicio, y
  `raise` vuelve a lanzar el error para que se vea. Nunca queda la mitad de las ventas cargadas.

Para que funcione, la conexión se abre con `autocommit=False`; si no, cada `INSERT` se
confirmaría por separado. `main()` cierra la conexión en un `finally`, pase lo que pase.

---

## 3. `api.py` — la API

### Las capas

```
pedido HTTP ──► ruta (@app.get)          ← solo HTTP: parámetros, códigos de estado
                    │
                    ├─ dependencias      ← validan filtros, abren/cierran la conexión
                    │
                    ▼
               SalesRepository           ← todo el SQL vive acá
                    │
                    ▼
                 MariaDB
                    │
respuesta ◄── modelo Pydantic            ← da forma y valida el JSON de salida
```

### Los modelos: la forma de la respuesta

```python
class Sale(BaseModel):
    transaction_id: str
    transaction_date: date
    item: str
    quantity: int
    price_per_unit: float
    ...
```

Es el **contrato** escrito en código. Cuando una ruta declara `-> Sale`, FastAPI toma lo que
devuelve la base, **lo valida** contra el modelo y lo convierte en JSON. Si la base
devolviera algo con otra forma, el error aparecería acá y no en Power BI. Estos modelos son
además los que se ven en `/docs` y `/openapi.json`.

### Los filtros: armar el `WHERE` sin inyección

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

El truco es un diccionario **condición SQL → valor**, del que se conservan solo las
condiciones que tienen valor. Para `?item=Tea&date_from=2023-03-01` devuelve:

```python
(" WHERE s.transaction_date >= %s AND i.name = %s",  ("2023-03-01", "Tea"))
```

El SQL lleva solo los `%s`, y los valores viajan **por separado**. El driver los escapa, así
que `Tea' OR '1'='1` se busca como un nombre de producto literal, no como SQL: devuelve `[]`.

### El repositorio: todo el SQL junto

```python
class SalesRepository:
    def __init__(self, conn):
        self.conn = conn

    def list_sales(self, filters, limit, offset):
        where, params = filters.where()
        sql = f"{SALES_QUERY}{where} ORDER BY ... LIMIT %s OFFSET %s"
        return self._fetch(sql, (*params, limit, offset))
```

`SALES_QUERY` es el `SELECT` con los `JOIN` que vuelven a traducir los ids a nombres: el
camino inverso al de la carga.

`summary()` ejecuta una consulta de totales y después **una por cada agrupación** (producto,
medio de pago, ubicación y mes), todas con el mismo `WHERE`. El `%%Y-%%m` del mes se debe a
que PyMySQL usa `%` para los parámetros, así que un `%` literal se escribe doble.

### Las dependencias: el "middleware" de FastAPI

```python
def get_repository():
    conn = db.connect(cursorclass=DictCursor)
    try:
        yield SalesRepository(conn)
    finally:
        conn.close()
```

Una función con `yield` funciona en **dos tiempos**:

1. **Antes del `yield`:** abre la conexión y le **entrega** el repositorio a la ruta.
2. **Después:** cuando la ruta terminó de responder, continúa desde el `yield` y el
   `finally` **cierra la conexión**, aunque haya ocurrido un error.

Es parecido a un middleware de Express con `next()`, pero declarativo. La ruta lo pide así:

```python
Repository = Annotated[SalesRepository, Depends(get_repository)]

def list_sales(repo: Repository, ...):
```

`Depends(get_repository)` le indica a FastAPI que, antes de llamar a la ruta, ejecute
`get_repository` y le pase lo que devuelva. Esa es la clave de los tests:
`app.dependency_overrides[get_repository] = lambda: FakeRepository()` **reemplaza la
dependencia por una falsa**, y la ruta no se entera.

`sale_filters` también es una dependencia: agrupa los 5 filtros en un `SaleFilters` y
verifica que `date_from <= date_to`; si no se cumple, responde `422`.

### Las rutas

```python
@app.get("/sales/{transaction_id}")
def get_sale(transaction_id: str, repo: Repository) -> Sale:
    sale = repo.get_sale(transaction_id)
    if sale is None:
        raise HTTPException(status_code=404, detail=f"Sale {transaction_id} not found")
    return sale
```

Las rutas son cortas porque solo se ocupan de HTTP: piden los datos al repositorio y deciden
el código de estado.

```python
limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100
```

Esta sola línea reemplaza la validación que en Node y Go está escrita a mano: entero, mínimo
1 (`ge` = mayor o igual), máximo 10.000 (`le` = menor o igual), 100 por defecto. Si no se
cumple, FastAPI responde `422` sin ejecutar la ruta.

### El manejador de errores

```python
@app.exception_handler(pymysql.MySQLError)
def database_error(request, exc):
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})
```

Cualquier error de MariaDB, en cualquier ruta, termina acá y se convierte en un `503`.
**No devuelve el mensaje real del error**, porque podría filtrar detalles internos (el
usuario o el nombre de la base) a quien llama a la API.

### Un pedido de punta a punta

`GET /sales?item=Tea&limit=2`:

1. **FastAPI valida** los parámetros: `limit=2` es un entero entre 1 y 10.000.
2. **`sale_filters`** arma `SaleFilters(item="Tea")`; no hay fechas para verificar.
3. **`get_repository`** abre la conexión y hace `yield` del repositorio.
4. **La ruta** llama a `repo.list_sales(filters, 2, 0)`.
5. **El repositorio** ejecuta `SELECT ... WHERE i.name = %s ORDER BY ... LIMIT %s OFFSET %s` con `("Tea", 2, 0)`.
6. **Pydantic** valida las 2 filas contra `Sale` y las convierte en JSON.
7. **Se responde `200`**, y `get_repository` retoma desde el `yield` y cierra la conexión.

Node y Go hacen **exactamente** los mismos pasos; lo que FastAPI resuelve con tipos y
dependencias, allá está escrito a mano (la validación en `app.js` / `handlers.go`, y la
conexión con un pool).

---

## 4. Mejoras posibles

Puntos del código que funcionan pero se podrían escribir mejor:

| Dónde | Qué | Mejora |
|-------|-----|--------|
| `limpieza.py`, `clean()` | `df.astype(object).where(df.notna(), None)` es poco legible | Convertir columna por columna directamente desde los tipos `string` de pandas |
| `api.py`, `summary()` | Reutiliza los `JOIN` cortando el texto de `SALES_QUERY` con `split("FROM")`, lo cual es frágil | Definir el `SELECT` y el `FROM ... JOIN` como dos constantes separadas, como en `go/repository.go` |
| `api.py`, `summary()` | Hace 5 consultas por pedido | Aceptable para 9.064 filas; con más datos convendría combinar las agrupaciones en una sola consulta con `UNION ALL` o usar tablas pre-agregadas |
