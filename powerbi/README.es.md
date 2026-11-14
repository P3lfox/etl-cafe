# Dashboard de Power BI — guía paso a paso

[English](README.md) | **Español**

Cómo armar desde cero el dashboard de ventas de la cafetería (`etl-cafe.pbix`): conectar
Power BI a la API, modelar los datos, escribir las medidas DAX, armar los visuales y
comprobar que los números sean correctos. Vista general del proyecto: [../README.es.md](../README.es.md).

Los menús aparecen con su nombre en la **interfaz en español** y, entre paréntesis, en
inglés; por ejemplo: **Transformar datos** (*Transform data*).

**Meta:** las cuatro tarjetas de KPI muestran exactamente lo que devuelve `GET /summary`:

| Tarjeta | Valor esperado |
|---------|---------------:|
| Total Revenue | **80.041,50** |
| Transactions | **9.064** |
| Units Sold | **27.358** |
| Average Ticket | **8,83** |

## Camino rápido

1. [Instalar Power BI Desktop](#1-requisitos) en una PC con Windows 10/11.
2. [Levantar una API y un túnel](#2-exponer-la-api) en la máquina Linux y copiar la URL.
3. [Cargar los datos](#3-cargar-los-datos-power-query) con un parámetro `ApiUrl` y una consulta.
4. [Agregar la tabla Calendar y la relación](#4-modelo-tabla-calendar-y-relación).
5. [Escribir las medidas](#5-medidas-dax).
6. [Armar los visuales](#6-visuales).
7. [Verificar los números](#7-verificar-los-números) y [guardar el `.pbix`](#8-guardar-y-compartir).

## 1. Requisitos

| Elemento | Detalle |
|----------|---------|
| **Power BI Desktop** | Gratuito. **Solo funciona en Windows 10 o posterior** (no hay versión para Linux ni macOS, y Windows 7 dejó de estar soportado en enero de 2021). Se instala desde Microsoft Store o desde microsoft.com. |
| **Cuenta de Microsoft** | **No hace falta.** Cuando Desktop pida iniciar sesión, se cierra esa ventana y se continúa. Iniciar sesión solo es necesario para *publicar* en la web. |
| **Power BI web / Fabric** | No se usan. Requieren una cuenta **laboral o educativa**; las cuentas personales (Gmail, Outlook, Microsoft 365 Familia) son rechazadas. |
| **La API accesible desde la PC con Windows** | Ver el paso siguiente. |

## 2. Exponer la API

Power BI corre en Windows, pero la API corre en Linux. `127.0.0.1` apuntaría a la propia
PC con Windows, así que la API necesita una URL a la que esa PC pueda llegar. Un
**Cloudflare Quick Tunnel** la ofrece gratis y sin cuenta:

```
PC con Windows (Power BI) ──► https://palabras-al-azar.trycloudflare.com ──► Cloudflare ──► túnel ──► Linux: localhost:8000 (API)
```

En la máquina Linux, con la base ya cargada (ver [../python/README.es.md](../python/README.es.md)):

```bash
sudo pacman -S cloudflared                         # una sola vez (Arch/CachyOS; otras distribuciones: ver la documentación de Cloudflare)

cd python && uv run uvicorn api:app                # terminal 1: la API
cloudflared tunnel --url http://localhost:8000     # terminal 2: el túnel
```

Entre los mensajes del túnel aparece un recuadro con una URL del estilo
`https://palabras-al-azar.trycloudflare.com`. Conviene probarla desde el celular **con datos
móviles** (no con wifi): `https://<tu-url>/summary` tiene que mostrar el JSON.

Sirve cualquiera de las implementaciones, porque comparten el [contrato de la API](../README.es.md#contrato-de-la-api):

| API | Cómo levantarla | Túnel hacia |
|-----|-----------------|-------------|
| Python | `cd python && uv run uvicorn api:app` | `http://localhost:8000` |
| Node | `cd node && npm start` | `http://localhost:3000` |
| Go | `cd go && go run .` | `http://localhost:8080` |

> **Las dos terminales tienen que quedar abiertas** mientras Power BI carga o actualiza datos.
> La URL **cambia cada vez** que se reinicia el túnel y es **pública** (cualquiera que la
> tenga puede leer los datos), lo cual es aceptable porque la API es de solo lectura.
> No usar la opción `--allowed-mail` del túnel: Power BI no puede ingresar el código que llega por mail.

## 3. Cargar los datos (Power Query)

La URL del túnel cambia, así que se guarda en un **parámetro**: un único lugar para
actualizarla en lugar de editar la consulta cada vez.

### 3.1 Crear el parámetro `ApiUrl`

1. **Inicio → Transformar datos** (*Home → Transform data*). Se abre el editor de Power Query.
2. **Administrar parámetros → Nuevo parámetro** (*Manage parameters → New parameter*):
   - Nombre: `ApiUrl`
   - Tipo: **Texto** (*Text*)
   - Valor actual: `https://tu-url.trycloudflare.com` — **sin `/` al final**
3. **Aceptar** (*OK*).

### 3.2 Crear la consulta `sales`

1. **Nuevo origen → Consulta en blanco** (*New source → Blank query*).
2. **Editor avanzado** (*Advanced editor*): borrar todo y pegar:

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

3. Renombrar la consulta a **`sales`** (clic derecho → **Cambiar nombre** / *Rename*).
4. Si pregunta cómo conectarse, elegir **Anónimo** (*Anonymous*) → **Conectar** (*Connect*).
5. **Cerrar y aplicar** (*Close & Apply*).

Qué hace cada línea:

| Paso | Significado |
|------|-------------|
| `Web.Contents(ApiUrl, [RelativePath = "sales", Query = [limit = "10000"]])` | Llama a `GET <ApiUrl>/sales?limit=10000` |
| `Json.Document(...)` | Interpreta la respuesta: una lista de registros JSON |
| `Table.FromRecords(Source)` | Convierte la lista en una tabla, con una columna por campo |
| `Table.TransformColumnTypes(...)` | Le asigna su tipo a cada columna (fecha, número entero, decimal, texto) |

> **¿Por qué `limit = "10000"`?** Por defecto la API devuelve 100 filas. Con 10.000 devuelve
> las 9.064 filas en una sola llamada. Sin ese parámetro, los totales darían mal.

## 4. Modelo: tabla Calendar y relación

Para comparar un mes con el anterior hace falta una **tabla de fechas**: una fila por día,
relacionada con las ventas. Es la práctica estándar en cualquier modelo de Power BI.

### 4.1 Crear la tabla

**Modelado → Nueva tabla** (*Modeling → New table*):

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

Crea una fila por día, desde la primera hasta la última venta (2023-01-01 a 2023-12-31),
con el mes y el día de la semana como número y como texto.

### 4.2 Relacionarla con `sales`

1. Abrir la **Vista de modelo** (*Model view*): en la barra vertical de la izquierda, el
   ícono de **tres cajitas unidas por líneas** (al pasar el mouse aparece el nombre).
2. Arrastrar `Date` desde la caja `Calendar` y soltarlo sobre `transaction_date` en la caja `sales`.
3. Confirmar:
   - Cardinalidad: **Uno a varios (1:\*)** o **Varios a uno (\*:1)**, que es lo mismo visto desde cada lado.
   - Dirección del filtro cruzado: **Única** (*Single*).
4. Aparece una línea entre las tablas, con un **1** del lado de `Calendar` y un **\*** del
   lado de `sales`. Si Power BI ya la creó solo, no hay nada que hacer.

### 4.3 Marcarla como tabla de fechas

Clic derecho sobre la tabla `Calendar` → **Marcar como tabla de fechas** (*Mark as date table*) → columna `Date`.

### 4.4 Ordenar los nombres de mes y de día

`Month` es texto, y el texto se ordena alfabéticamente (abr, ago, dic…). Hay que indicarle
a Power BI que lo ordene según su número:

1. **Vista de tabla** (*Table view*): el ícono de cuadrícula de la barra izquierda.
2. En el panel **Datos** (*Data*) de la derecha, desplegar `Calendar` y hacer clic en la columna **`Month`**.
3. **Herramientas de columnas → Ordenar por columna** (*Column tools → Sort by column*) → **`Month Number`**.
4. Repetir con **`Weekday`** → **`Weekday Number`**.

## 5. Medidas DAX

Una **medida** es una fórmula que se recalcula según lo que se esté mostrando (una
tarjeta, un mes, un producto). Cada una se crea con **Inicio → Nueva medida**
(*Home → New measure*) con la tabla `sales` seleccionada:

```
Total Revenue = SUM(sales[total_spent])
Transactions = COUNTROWS(sales)
Units Sold = SUM(sales[quantity])
Average Ticket = DIVIDE([Total Revenue], [Transactions])
Revenue Previous Month = CALCULATE([Total Revenue], DATEADD('Calendar'[Date], -1, MONTH))
MoM Growth % = DIVIDE([Total Revenue] - [Revenue Previous Month], [Revenue Previous Month])
Revenue Share % = DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALL(sales[item])))
```

| Medida | Qué calcula |
|--------|-------------|
| `Total Revenue` | Suma de `total_spent` |
| `Transactions` | Cantidad de filas (cada fila es una venta) |
| `Units Sold` | Suma de `quantity` |
| `Average Ticket` | Facturación ÷ transacciones. `DIVIDE` devuelve vacío en lugar de un error por división por cero |
| `Revenue Previous Month` | La facturación, pero con las fechas corridas un mes hacia atrás (necesita la tabla Calendar) |
| `MoM Growth %` | (mes actual − mes anterior) ÷ mes anterior. Enero queda vacío: no tiene mes anterior |
| `Revenue Share %` | Facturación de este producto ÷ facturación de **todos** los productos |

**La idea clave de DAX, `CALCULATE`:** cuando un visual dibuja "Coffee", todas las medidas
se calculan **filtradas** a Coffee. En `Revenue Share %` el numerador es la facturación de
Coffee, mientras que `CALCULATE([Total Revenue], ALL(sales[item]))` **quita el filtro de
producto** y da la facturación total. El resultado es el porcentaje de Coffee. `CALCULATE`
significa "calcular esto, pero cambiando los filtros"; `DATEADD` y `ALL` son dos maneras de
cambiarlos.

### Formato de porcentaje

Seleccionar la medida (ícono de calculadora) en el panel **Datos** → **Herramientas de
medición** (*Measure tools*) → grupo **Formato** → botón **%**, con **1** decimal. Hacerlo
para `MoM Growth %` y `Revenue Share %`. El formato solo cambia cómo se muestra el valor
(`0.053` → `5,3%`), no el valor en sí.

## 6. Visuales

En la **Vista de informe** (*Report view*), elegir cada visual en el panel
**Visualizaciones** (*Visualizations*) y arrastrar los campos a sus casilleros. Al pasar el
mouse sobre un ícono aparece su nombre.

| # | Visual | Campos | Pregunta que responde |
|---|--------|--------|-----------------------|
| 1–4 | **Tarjeta** (*Card*) × 4 | una medida cada una: Total Revenue, Transactions, Units Sold, Average Ticket | KPIs principales |
| 5 | **Gráfico circular** (*Pie chart*) | Leyenda: `payment_method` · Valores: `Total Revenue` | ¿Cómo pagan los clientes? |
| 6 | **Gráfico de líneas** (*Line chart*) | Eje X: `Calendar[Month]` · Eje Y: `Total Revenue` | Tendencia a lo largo del año |
| 7 | **Gráfico de barras agrupadas** (*Clustered bar chart*) | Eje Y: `item` · Eje X: `Total Revenue` | Productos más vendidos |
| 8 | **Tabla** (*Table*) | `item`, `Transactions`, `Units Sold`, `Total Revenue` | Detalle por producto |
| 9 | **Gráfico de columnas agrupadas y de líneas** (*Line and clustered column chart*) | Eje X: `Calendar[Month]` · Columnas: `Total Revenue` · Línea: `MoM Growth %` | Crecimiento mes a mes |
| 10 | **Gráfico de rectángulos** (*Treemap*) | Categoría: `item` · Valores: `Total Revenue` · Información sobre herramientas: `Revenue Share %` | Participación de cada producto |
| 11 | **Gráfico de columnas agrupadas** (*Clustered column chart*) | Eje X: `Calendar[Weekday]` · Eje Y: `Total Revenue` | Días de la semana con más ventas |

**Barras vs columnas:** en Power BI, las *barras* son **horizontales** y las *columnas*,
**verticales**. Con 8 productos, las barras horizontales se leen mejor porque los nombres entran cómodos.

**Qué gráfico para qué pregunta:**

- **Líneas para el tiempo:** los meses van uno después del otro, y la línea muestra la **tendencia**.
- **Barras o columnas para comparar categorías:** Coffee, Tea y Cake no tienen un orden
  entre sí; unirlos con una línea sugeriría una continuidad que no existe.
- **Torta o mapa de árbol para partes de un todo:** muestran cuánto representa cada porción del 100%.

## 7. Verificar los números

Las cuatro tarjetas tienen que coincidir con `GET <ApiUrl>/summary` y con los valores
esperados del principio de esta guía. Si coinciden, el pipeline queda validado de punta a
punta: el CSV sucio pasó por la limpieza, la base de datos y la API, y llegó a Power BI
sin perder ni un centavo.

## 8. Guardar y compartir

**Archivo → Guardar como → Examinar este dispositivo** (*File → Save as → Browse this
device*), con el tipo **Archivo de Power BI (\*.pbix)**. El `.pbix` contiene los visuales,
las medidas, la consulta **y una copia de los datos** (modo importación).

| Formato | Contiene | Sirve para |
|---------|----------|------------|
| `.pbix` (Guardar como) | Informe + modelo + **datos** | Compartir: se abre con datos en cualquier PC, aunque la API esté apagada |
| `.pbit` (Exportar → plantilla) | Informe + modelo, **sin datos** | Al abrirlo pide `ApiUrl` y vuelve a descargar todo |
| PDF (Exportar) | Una imagen estática del informe | Imprimir o adjuntar |

## 9. Actualizar con una URL nueva

La copia de los datos queda guardada en el `.pbix`; solo **Actualizar** necesita una API
funcionando. Cada vez que cambia la URL del túnel (otra ejecución, otra PC, otra API):

1. Volver a levantar la API y el túnel, y copiar la URL nueva.
2. **Transformar datos → Editar parámetros** (*Transform data → Edit parameters*) → pegarla en `ApiUrl`.
3. **Actualizar** (*Refresh*).

La consulta, las medidas y los visuales no se tocan.

**Idea para la demo:** levantar tres túneles a la vez (puertos 8000, 3000 y 8080), cambiar
`ApiUrl` entre las URLs de Python, Node y Go, y actualizar: el dashboard queda idéntico,
porque Power BI solo ve el contrato de la API, no el lenguaje que hay detrás.

## Resolución de problemas

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `DataSource.Error` / no se pudo conectar | La API o el túnel no están corriendo, o la URL cambió | Levantar ambos, probar `<url>/summary` en el navegador y actualizar `ApiUrl` |
| La URL funciona en el navegador pero no en Power BI | `ApiUrl` termina en `/` o tiene un error de tipeo | Quitar la `/` final y copiar la URL exacta |
| Pide credenciales una y otra vez | Quedó guardado un método de autenticación incorrecto | **Archivo → Opciones y configuración → Configuración de origen de datos** → borrar permisos → elegir **Anónimo** |
| Las tarjetas muestran 100 transacciones | La consulta no tiene `limit = "10000"` | Usar la consulta de la sección 3.2 |
| Errores en `transaction_date` | Interpretación regional de las fechas | La API envía fechas ISO (`2023-01-01`); en Power Query usar **Cambiar tipo → Usar configuración regional** → Fecha, inglés (Estados Unidos) |
| Error de fórmula DAX en las comas | Separadores regionales de DAX (`;` en lugar de `,`) | Reemplazar `,` por `;` en la fórmula, o activar los separadores DAX estándar en **Opciones → Configuración regional** |
| Los meses aparecen como abr, ago, dic… | `Month` se ordena como texto | Sección 4.4: ordenar por `Month Number` |
| `MoM Growth %` vacío en enero | No hay mes anterior para comparar | Es el comportamiento esperado |
| `MoM Growth %` vacío en todos los meses | La tabla Calendar no está relacionada o no está marcada como tabla de fechas | Secciones 4.2 y 4.3 |
| La relación aparece como varios a varios | `Calendar[Date]` y `transaction_date` tienen tipos distintos | Dejar ambas como tipo **Fecha** y volver a crear la relación |
| `MoM Growth %` muestra 0,05 en lugar de 5% | Falta el formato de porcentaje | Sección 5, *Formato de porcentaje* |
