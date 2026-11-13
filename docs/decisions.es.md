# Decisiones de diseño y limitaciones

[English](decisions.md) | **Español**

Por qué el proyecto está construido como está, qué alternativas se descartaron y qué
cosas **no** resuelve bien. Vista general del proyecto: [../README.es.md](../README.es.md).

## Resumen

| # | Decisión | En una línea |
|---|----------|--------------|
| D1 | [Usar el dataset sucio tal cual](#d1-usar-el-dataset-sucio-tal-cual) | Los errores reales valen más que los que inventamos nosotros |
| D2 | [Reconstruir valores, nunca imputar](#d2-reconstruir-valores-nunca-imputar) | Solo se deduce lo exacto; nada de media ni moda |
| D3 | [`Unknown` para medio de pago y ubicación](#d3-unknown-para-medio-de-pago-y-ubicación) | Descartar ~40% de las filas sería peor |
| D4 | [Descartar filas sin fecha válida](#d4-descartar-filas-sin-fecha-válida) | Una fecha no se puede deducir de nada |
| D5 | [Esquema normalizado con restricciones](#d5-esquema-normalizado-con-restricciones) | Tablas de referencia + claves foráneas + `CHECK` |
| D6 | [Carga idempotente en una sola transacción](#d6-carga-idempotente-en-una-sola-transacción) | Se puede repetir sin riesgo y nunca queda a medias |
| D7 | [`.env` compartido y usuario de base dedicado](#d7-env-compartido-y-usuario-de-base-dedicado) | Una sola configuración y mínimo privilegio |
| D8 | [API de solo lectura](#d8-api-de-solo-lectura) | Los datos entran solo por el pipeline |
| D9 | [Capa de repositorio y SQL parametrizado](#d9-capa-de-repositorio-y-sql-parametrizado) | Testeable sin base de datos y sin inyección SQL |
| D10 | [FastAPI como API de referencia](#d10-fastapi-como-api-de-referencia) | Validación y documentación a partir de los tipos |
| D11 | [`limit` de hasta 10.000](#d11-limit-de-hasta-10000) | Power BI obtiene todas las filas en una sola llamada |
| D12 | [Power BI Desktop + Cloudflare Quick Tunnel](#d12-power-bi-desktop--cloudflare-quick-tunnel) | Un puente gratuito hasta tener un servidor |
| D13 | [Modo importación, parámetro `ApiUrl` y tabla Calendar](#d13-modo-importación-parámetro-apiurl-y-tabla-calendar) | `.pbix` portable y un solo lugar para cambiar la URL |
| D14 | [API políglota con test de contrato](#d14-api-políglota-con-test-de-contrato) | La API es un contrato, no un lenguaje |
| D15 | [Repositorio organizado por lenguaje](#d15-repositorio-organizado-por-lenguaje) | Una carpeta y un README por lenguaje |

---

## Datos

### D1. Usar el dataset sucio tal cual

- **Decisión:** [Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)
  (Kaggle), conservado en CSV y sin agregarle errores.
- **Por qué:** los datos de ventas se prestan para un dashboard, y sus errores no los
  diseñamos nosotros, así que no se puede decir que la limpieza resuelve problemas que ella misma creó.
- **Descartado:** un dataset limpio (Tableau Sample Superstore) más un script que le
  agregue errores, que da control total sobre los errores pero es menos creíble; Dirty
  E-Commerce (Shein), que es un catálogo de productos y no ventas; datos.gob.ar, que tiene
  agregados mensuales y no transacciones.
- **Consecuencia:** el dataset solo tiene errores de *valores faltantes* (`ERROR`,
  `UNKNOWN`, vacíos). No tiene duplicados, fechas en distintos formatos, espacios de más ni
  mayúsculas mezcladas, así que esas reglas de limpieza existen pero nunca se activan con estos datos.

### D2. Reconstruir valores, nunca imputar

- **Decisión:** un valor faltante se completa solo si se puede **deducir con exactitud**:
  `total = cantidad × precio` permite obtener cualquiera de los tres a partir de los otros
  dos, y el precio fijo del menú permite deducir el producto a partir del precio (y al
  revés). Si no, la fila se descarta.
- **Por qué:** imputar con la media o la moda **inventa datos**. Un precio inventado
  cambia la facturación, que es justamente lo que mide el dashboard.
- **Descartado:** imputar con media, mediana o moda (lo que hacía el proyecto de referencia en el que se basa este).
- **Consecuencia:** se reconstruyeron 1.855 valores (471 productos, 431 cantidades, 500
  precios y 453 totales), y se descartaron 476 filas que no se podían reconstruir.

### D3. `Unknown` para medio de pago y ubicación

- **Decisión:** si falta el medio de pago o la ubicación, se usa la etiqueta `Unknown` y la fila se conserva.
- **Por qué:** estas columnas faltan en el **31,7%** (medio de pago) y el **39,6%**
  (ubicación) de las filas limpias. Descartarlas haría perder la facturación de esas ventas,
  y `Unknown` no finge saber algo que no sabemos.
- **Descartado:** descartar las filas; completar con el valor más frecuente (inventaría datos, ver D2).

### D4. Descartar filas sin fecha válida

- **Decisión:** se descartan las filas con fecha faltante o inválida (460 filas).
- **Por qué:** ninguna otra columna permite deducir una fecha, y una venta sin fecha no se
  puede ubicar en los gráficos mensuales.
- **Descartado:** completar con la fecha mediana (lo que hacía el proyecto de referencia):
  amontonaría cientos de ventas falsas en un solo día.

---

## Base de datos

### D5. Esquema normalizado con restricciones

- **Decisión:** las tablas de referencia `items`, `payment_methods` y `locations` guardan
  cada valor una sola vez; `sales` las referencia mediante claves foráneas. Hay `CHECK (> 0)`
  sobre cantidades y montos, y un índice sobre `transaction_date`.
- **Por qué:** no se repite texto, un error de tipeo no puede crear un producto "nuevo", y
  la propia base rechaza valores imposibles aunque se escape algún error en la limpieza.
- **Descartado:** una única tabla plana (lo que hacía el proyecto de referencia).
- **Consecuencia:** `sales.price_per_unit` se guarda en cada venta además de
  `items.menu_price`, así que un cambio de precio futuro no reescribe las ventas pasadas.

### D6. Carga idempotente en una sola transacción

- **Decisión:** `carga.py` inserta o actualiza con `ON DUPLICATE KEY UPDATE` dentro de una única transacción.
- **Por qué:** repetirla nunca duplica filas, y si falla a mitad de camino se deshace todo.

### D7. `.env` compartido y usuario de base dedicado

- **Decisión:** la configuración de conexión vive en un único `.env` en la raíz del
  repositorio, que leen Python, Node y Go. El usuario de base `etl_cafe` tiene permisos
  **solo** sobre `cafe_sales`.
- **Por qué:** las credenciales quedan fuera del código y fuera de git, y pasar a un
  servidor remoto solo cambia el `.env`. Mínimo privilegio: una contraseña filtrada no
  permite tocar otras bases.

---

## API

### D8. API de solo lectura

- **Decisión:** solo endpoints `GET`.
- **Por qué:** los datos entran por el pipeline (`limpieza.py` → `carga.py`), nunca por la
  API. Sin `POST`/`PUT`/`DELETE` no se puede modificar ni borrar nada a través de ella: menor
  superficie de ataque, lo que además hace aceptable un túnel público (D12).

### D9. Capa de repositorio y SQL parametrizado

- **Decisión:** las rutas solo se ocupan de HTTP; todo el SQL vive en un repositorio. Todas
  las consultas usan marcadores (`%s` / `?`), nunca concatenación de texto.
- **Por qué:** los tests reemplazan el repositorio por uno falso y corren sin base de datos;
  y lo que manda el usuario nunca puede convertirse en SQL (un intento de inyección como
  `item=Tea' OR '1'='1` devuelve `[]`).

### D10. FastAPI como API de referencia

- **Decisión:** FastAPI (Python) es la implementación de referencia.
- **Por qué:** las anotaciones de tipos dan validación automática (`422`), la forma de las
  respuestas, la documentación interactiva en `/docs` y el contrato OpenAPI en `/openapi.json`.
- **Descartado:** Flask, más parecido a Express, pero la validación y la documentación requieren extensiones.

### D11. `limit` de hasta 10.000

- **Decisión:** `GET /sales` devuelve 100 filas por defecto y acepta hasta 10.000.
- **Por qué:** el valor por defecto protege las consultas casuales; 10.000 cubre las 9.064
  filas, así que Power BI carga todo en un solo pedido sin implementar paginación en Power Query.

---

## Dashboard

### D12. Power BI Desktop + Cloudflare Quick Tunnel

- **Decisión:** Power BI Desktop, en una PC con Windows, llega a la API a través de un
  Cloudflare Quick Tunnel gratuito que corre en la máquina Linux.
- **Por qué:** Power BI Desktop solo funciona en Windows, y el servicio web de Power BI /
  Fabric requiere una cuenta laboral o educativa (las cuentas personales y Microsoft 365
  Familia son rechazadas). El túnel no necesita cuenta, ni abrir puertos del router, ni dinero.
- **Descartado por ahora:** un VPS (~USD 5/mes), que da una URL fija pero cuesta dinero y
  requiere administrar un servidor; Railway, administrado pero pago después del período de
  prueba. Ambos siguen en la hoja de ruta.

### D13. Modo importación, parámetro `ApiUrl` y tabla Calendar

- **Decisión:** la consulta importa los datos dentro del `.pbix`; la URL base de la API es
  un parámetro; una tabla de fechas `Calendar` permite los cálculos de tiempo.
- **Por qué:** el `.pbix` se abre con datos en cualquier PC aunque la API esté apagada; la
  URL cambiante del túnel se actualiza en un solo lugar; `DATEADD` (crecimiento mes a mes)
  necesita una tabla de fechas adecuada.

---

## Arquitectura

### D14. API políglota con test de contrato

- **Decisión:** la misma API en Python, Node.js (Express) y Go, con un test de contrato que
  compara cada implementación contra la de referencia en Python.
- **Por qué:** demuestra que los clientes solo dependen del **contrato** (HTTP + JSON):
  Power BI muestra un dashboard idéntico sin importar qué implementación consulte.
- **Descartado:** Rust (curva de aprendizaje demasiado empinada para el tiempo disponible);
  más lenguajes (tres ya demuestran la idea, y cada uno extra solo suma mantenimiento).
- **Consecuencia:** cada cambio en la API hay que hacerlo tres veces. En sistemas reales,
  los lenguajes suelen diferir **según la responsabilidad** de cada servicio, no para
  duplicar el mismo. Esto es una arquitectura *políglota*, no escalado horizontal (varias
  copias del mismo servicio detrás de un balanceador de carga).

### D15. Repositorio organizado por lenguaje

- **Decisión:** `python/`, `node/`, `go/` y `powerbi/`, cada una con su README; `data/`,
  `sql/` y `.env` compartidos en la raíz.
- **Por qué:** cada integrante encuentra el código y las instrucciones de un lenguaje en un
  solo lugar; el README principal queda como una vista general breve.

---

## Limitaciones

Lo que el proyecto **no** hace, dicho con claridad.

### Datos

| Limitación | Impacto |
|------------|---------|
| **936 filas descartadas (9,4%)**: 460 sin fecha válida + 476 irrecuperables | Los totales son los de las ventas **válidas**, no los de todas las ventas del archivo crudo |
| **`Unknown` es grande**: 31,7% de los medios de pago y 39,6% de las ubicaciones | El gráfico de torta de medios de pago y cualquier análisis por ubicación están dominados por `Unknown`; las conclusiones sobre cómo o dónde compran los clientes son débiles |
| **Precio de menú inferido** como el precio más frecuente de cada producto | Supone que los precios no cambiaron durante 2023 |
| **La cantidad solo se reconstruye si `total ÷ precio` da un número entero** | Si no, la fila se descarta |
| **Un solo año (2023), una sola cafetería, un dataset de práctica** | No representa un negocio real; no se pueden comparar años |
| **Licencia del dataset sin verificar** | Revisar la página de Kaggle antes de redistribuir los datos |

### Pipeline y API

| Limitación | Impacto |
|------------|---------|
| **Recarga completa**: se limpia y carga todo el archivo cada vez | Alcanza para 10.000 filas; una fuente grande o en crecimiento necesitaría cargas incrementales |
| **Sin autenticación ni límite de pedidos** en la API | Cualquiera que tenga la URL puede leer los datos (aceptable para datos públicos y de solo lectura) |
| **`limit` limitado a 10.000** | Si los datos superan esa cantidad, Power BI necesitaría paginación |
| **Los cuerpos de los `422` difieren según el lenguaje** (FastAPI tiene su propio formato) | El test de contrato solo compara el código de estado en los parámetros inválidos |
| **El redondeo de `average_ticket` está implementado tres veces** | Podría diferir en algún caso límite; el test de contrato solo verifica los rangos de fechas elegidos |
| **Sin CI** | Los tests corren solo cuando alguien los ejecuta; el test de contrato necesita levantar tres servidores a mano |

### Dashboard y hosting

| Limitación | Impacto |
|------------|---------|
| **La URL del Quick Tunnel es temporal** y cambia en cada ejecución | Hay que actualizar `ApiUrl` antes de cada actualización |
| **El túnel depende de la máquina Linux** encendida, con la API y el túnel corriendo; no hay garantía de disponibilidad | No sirve para nada permanente |
| **La URL del túnel es pública** | Cualquiera con el link puede leer los datos (ver D8) |
| **Power BI Desktop solo funciona en Windows**, la actualización es manual y no se publica nada | Los integrantes necesitan Windows; no hay actualización programada ni publicación web |
| **Credenciales en un `.env` de texto plano** | Está bien para desarrollo local; en un servidor se usaría un gestor de secretos o la configuración del entorno |

## Hoja de ruta para resolver estas limitaciones

- **VPS o Railway:** URL fija y sin depender de una máquina personal (limitaciones del túnel).
- **CI (por ejemplo, GitHub Actions):** correr los tests de Python, Node y Go en cada push,
  y el test de contrato contra una base de datos en un contenedor de servicio.
- **API key o restricción por IP** si los datos dejan de ser públicos.
