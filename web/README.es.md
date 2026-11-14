# Dashboard web — React

[English](README.md) | **Español**

Un dashboard en el navegador sobre la misma API que usa Power BI: tarjetas de KPI,
evolución mensual, crecimiento mes a mes y rankings por producto, medio de pago y
ubicación, con un filtro de fechas. Funciona en cualquier sistema operativo (a diferencia
de Power BI Desktop, que solo funciona en Windows). Vista general del proyecto:
[../README.es.md](../README.es.md).

## Camino rápido

Requisitos: Node.js 22 o posterior y **una de las APIs corriendo** (ver el
[README principal](../README.es.md#inicio-rápido)).

```bash
cd python && uv run uvicorn api:app      # terminal 1: la API (o la de Node / Go)

cd web
npm install
npm run dev                              # terminal 2: http://localhost:5173
```

Los valores esperados con el año completo son los mismos que en Power BI: **80.041,50** de
facturación, **9.064** transacciones, **27.358** unidades y **8,83** de ticket promedio.

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Servidor de desarrollo con recarga automática |
| `npm test` | Tests de la lógica pura (`src/lib/metrics.test.js`), sin API ni navegador |
| `npm run lint` | Revisión estática con oxlint |
| `npm run build` | Genera la versión optimizada en `dist/` |
| `npm run preview` | Sirve `dist/` localmente, con el mismo proxy hacia la API |

## Elegir qué API usa

El navegador **solo habla con el servidor de Vite** (`/api/...`), y Vite reenvía cada pedido
a la API elegida con la variable `API_TARGET` (por defecto, la de Python):

```bash
npm run dev                                         # Python, puerto 8000
API_TARGET=http://127.0.0.1:3000 npm run dev        # Node
API_TARGET=http://127.0.0.1:8080 npm run dev        # Go
```

El pie de la página muestra qué API está respondiendo. Como las tres cumplen el
[contrato](../README.es.md#contrato-de-la-api), el dashboard se ve idéntico con cualquiera.

**¿Por qué un proxy?** Si el navegador llamara directamente a `http://127.0.0.1:8000` desde
`http://localhost:5173`, serían orígenes distintos y el navegador bloquearía la respuesta
por **CORS**, salvo que las tres APIs agregaran cabeceras CORS. Con el proxy, para el
navegador todo viene del mismo origen, así que no hubo que tocar ninguna API.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `vite.config.js` | Proxy `/api` → `API_TARGET` (en `dev` y en `preview`) |
| `src/api.js` | `fetchSummary(range)`: llama a `GET /api/summary` y traduce los errores |
| `src/lib/metrics.js` | Lógica pura: crecimiento mes a mes, participación, ranking y formatos |
| `src/lib/metrics.test.js` | 9 tests con Vitest |
| `src/components/charts.jsx` | Los gráficos (Recharts): evolución mensual, crecimiento y barras ordenadas |
| `src/components/ui.jsx` | Filtro de fechas, tarjetas de KPI, tarjeta con vista Gráfico/Tabla y tabla |
| `src/App.jsx` | Estado, carga de datos y armado de la página |
| `src/index.css` | Colores por rol (modo claro y oscuro) y diseño adaptable al celular |

## Cómo funciona

1. `App.jsx` guarda el rango de fechas elegido y llama a `GET /api/summary?date_from=...&date_to=...`.
2. `/summary` ya trae los totales y las agrupaciones (por producto, medio de pago, ubicación
   y mes). Lo que la API no trae se calcula en `metrics.js`:
   - **crecimiento mes a mes** = (mes − mes anterior) ÷ mes anterior;
   - **participación** de cada grupo = su facturación ÷ la facturación total;
   - **ranking** de mayor a menor, con `Unknown` siempre al final.
3. Mientras llega la respuesta de un filtro nuevo, se muestra el resultado anterior
   atenuado (sin parpadeos ni saltos de diseño). Si la API no responde, aparece un aviso.

## Decisiones de diseño de los gráficos

Los gráficos siguen reglas de visualización verificables, no solo de gusto:

| Decisión | Por qué |
|----------|---------|
| **El crecimiento mensual es un gráfico aparte**, no una línea sobre las columnas de facturación | Un gráfico con **dos ejes Y** (como el combinado de Power BI) sugiere correlaciones que dependen de cómo se alinean las escalas, no de los datos |
| **Barras ordenadas en lugar de torta** para el medio de pago | Cash, Credit Card y Digital Wallet tienen valores muy parecidos (23,1% / 23,0% / 22,9%); en una torta esa diferencia no se ve |
| **`Unknown` en gris y siempre al final** | Es un dato faltante, no una categoría real; el gris lo separa visualmente de los datos válidos |
| **Crecimiento en azul (sube) y rojo (baja)** con una línea en cero | Es un dato con signo: dos colores opuestos y un punto neutro |
| **Un solo color para las barras de productos** | Es una sola serie; colorear cada barra distinto no agrega información |
| **Etiquetas selectivas** (porcentaje en la punta de cada barra, valor solo en el último mes) | Un número en cada punto satura el gráfico; el resto queda en el tooltip y en la tabla |
| **Vista de tabla en cada gráfico** | Cada valor se puede leer sin depender del color ni del mouse (accesibilidad) |
| **Paleta validada para daltonismo y contraste**, en modo claro y oscuro | Se comprobó con un script, no a ojo |

## Limitaciones

- Usa solo `/summary`, así que no incluye el gráfico por día de la semana de Power BI (la
  API no agrupa por día; habría que agregarlo a las tres implementaciones).
- El rango de fechas del filtro está fijo en 2023, porque el dataset es de ese año.
- El paquete compilado pesa unos 620 KB (Recharts es la mayor parte); Vite lo advierte al
  compilar. Para este proyecto es aceptable.
- `npm run build` genera archivos estáticos, pero necesitan el proxy hacia la API: para
  publicarlos haría falta un servidor que haga lo mismo (por ejemplo, el VPS de la hoja de ruta).
