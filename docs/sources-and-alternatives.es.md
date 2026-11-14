# Fuentes de datos y alternativas

[English](sources-and-alternatives.md) | **Español**

De dónde sacar datasets para un proyecto como este, y qué otras opciones existen para cada
pieza que elegimos (túnel, hosting y herramienta de dashboard), con sus ventajas y
desventajas. El *por qué* de cada elección está en [decisions.es.md](decisions.es.md).
Vista general del proyecto: [../README.es.md](../README.es.md).

> Los precios y planes gratuitos cambian seguido. Los datos de este documento se
> relevaron en noviembre de 2026; **confirmar siempre en la página oficial** antes de decidir.

## 1. Fuentes de datos

### El dataset que usamos

**[Cafe Sales – Dirty Data for Cleaning Training](https://www.kaggle.com/datasets/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training)**
(Kaggle): 10.000 ventas de una cafetería con errores pensados para practicar limpieza.

Se puede descargar desde el navegador (requiere iniciar sesión en Kaggle) o directamente
desde la terminal, sin cuenta:

```bash
mkdir -p data/raw
curl -L -o /tmp/cafe.zip \
  "https://www.kaggle.com/api/v1/datasets/download/ahmedmohamed2003/cafe-sales-dirty-data-for-cleaning-training"
unzip -o /tmp/cafe.zip -d data/raw      # deja data/raw/dirty_cafe_sales.csv
```

> Su licencia todavía no se verificó: revisarla en la página de Kaggle antes de
> redistribuir los datos.

### Otras fuentes

| Fuente | Qué ofrece | Ventajas | Desventajas |
|--------|-----------|----------|-------------|
| [Kaggle — buscar "dirty data"](https://www.kaggle.com/datasets?search=dirty+data) | Datasets armados para practicar limpieza | Errores reales y ya preparados | Hay que revisar la licencia y la calidad de cada uno |
| [Dirty E-Commerce Data (Shein)](https://baselight.app/u/kaggle/dataset/oleksiimartusiuk_e_commerce_data_shein) | +80.000 productos con faltantes y formatos inconsistentes | Muy sucio, ideal para practicar | Es un catálogo, no ventas: los KPIs del dashboard quedan pobres |
| [Tableau Sample Superstore](https://public.tableau.com/app/learn/sample-data) | Ventas con categorías, regiones, clientes y ganancia (CSV y XLSX) | Ideal para normalizar en varias tablas; descarga oficial | Viene **limpio**: habría que agregarle errores con un script |
| [datos.gob.ar — etiqueta "ventas"](https://datos.gob.ar/dataset?tags=ventas) | Series oficiales (supermercados, mayoristas, centros de compras) | Datos públicos de Argentina | Son totales mensuales, no transacciones: poco para limpiar |
| [Kaggle Learn — Data Cleaning](https://www.kaggle.com/learn/data-cleaning) | Curso corto con datasets de práctica | Sirve para aprender las técnicas | No es un dataset para el proyecto en sí |

Para Superstore conviene usar **solo la página oficial de Tableau**: muchos sitios que
dicen ofrecer esa descarga son spam.

### Cómo elegir un dataset

- **Dominio con KPIs claros:** ventas, pedidos o reservas permiten armar facturación,
  cantidades y evolución en el tiempo.
- **Transacciones, no totales:** una fila por venta da material para limpiar, normalizar y agrupar.
- **Tamaño razonable:** entre miles y decenas de miles de filas se procesa rápido y sigue siendo realista.
- **Errores reales y documentados:** saber qué tipo de suciedad tiene ayuda a planificar la limpieza.
- **Licencia que permita usarlo y compartirlo** en un repositorio.

### Si los datos vienen en Excel (`.xlsx`)

`limpieza.py` lee CSV, pero pandas lee Excel casi igual. Hay que instalar `openpyxl`
(`uv add openpyxl`) y cambiar la lectura por:

```python
raw = pd.read_excel("data/raw/archivo.xlsx", sheet_name=0, dtype=str, keep_default_na=False)
```

`dtype=str` y `keep_default_na=False` cumplen la misma función que en el CSV: leer todo
como texto y decidir en el código qué es un faltante. Ojo: Excel puede guardar las fechas
como fechas reales y no como texto, así que conviene revisar cómo llegan antes de aplicar
el formato `%Y-%m-%d`.

## 2. Cómo hacer llegar la API a Power BI

Power BI Desktop corre en Windows y la API en Linux, así que la API necesita una dirección
a la que la PC con Windows pueda llegar.

| Opción | Costo | Ventajas | Desventajas |
|--------|-------|----------|-------------|
| **Cloudflare Quick Tunnel** (la que usamos) | Gratis, sin cuenta | Un comando; no hay que abrir puertos del router; da HTTPS | URL temporal que cambia en cada ejecución; pública; depende de que la máquina Linux esté encendida; sin garantía de disponibilidad |
| **Misma red local** (`uvicorn api:app --host 0.0.0.0` y la IP local de la máquina Linux) | Gratis | Sin servicios externos; nada queda público en internet | Solo funciona si ambas PCs están en la misma red; puede requerir abrir el puerto en el firewall de Linux |
| **Máquina virtual con Windows** en la misma PC Linux | Gratis (salvo la licencia de Windows) | Todo en una sola máquina | Consume mucha memoria y CPU |
| **Cloudflare Tunnel con cuenta y dominio propio** | La cuenta es gratis; el dominio se paga | URL fija | Requiere un dominio y más configuración (no lo probamos) |
| **ngrok** u otros servicios de túnel | Tienen plan gratuito con cuenta | Similar a Cloudflare | No los probamos; revisar los límites actuales del plan gratuito |
| **Publicar la API en un servidor** (sección 3) | Desde ~USD 5/mes | URL fija, no depende de una PC personal | Cuesta dinero y hay que administrarlo |

## 3. Hosting remoto (hoja de ruta)

| Opción | Costo aproximado | Ventajas | Desventajas |
|--------|------------------|----------|-------------|
| **VPS** (DigitalOcean, Hetzner, Vultr) con MariaDB + una API | ~USD 4–6/mes | URL fija; se aprende SSH, Linux y firewall; la base queda en localhost y solo se expone la API | Hay que administrar actualizaciones, backups y seguridad |
| **Railway** | Prueba de USD 5 por 30 días; después el plan Hobby, USD 5/mes según uso | Base MySQL con un clic y también aloja la API; casi sin administración | Se aprende menos de infraestructura; el costo depende del uso |
| **Aiven** (solo la base) | El plan gratuito de MySQL ya no acepta servicios nuevos; el plan Developer cuesta USD 5/mes | Base administrada | La API igual necesitaría alojarse en otro lado |
| **TiDB Cloud** (compatible con MySQL) | Tiene un plan gratuito (límites sin verificar) | Sin servidor que administrar | Solo la base; compatibilidad a revisar |
| **PlanetScale** | Eliminó su plan gratuito | — | Descartado |

Para estudiantes, el **GitHub Student Developer Pack** históricamente incluyó créditos de
DigitalOcean; no se verificó si sigue vigente.

## 4. Herramientas de dashboard

| Herramienta | Funciona en | Costo | Ventajas | Desventajas |
|-------------|-------------|-------|----------|-------------|
| **Power BI Desktop** (la que usamos) | Solo Windows 10 o posterior | Gratis | Estándar en empresas; DAX; muy pedido en la industria | No funciona en Linux ni macOS; sin publicar, la actualización es manual |
| **Power BI web / Microsoft Fabric** | Navegador | Requiere licencia según el uso | Publicar y compartir en línea | Exige una cuenta **laboral o educativa**; las cuentas personales (incluida Microsoft 365 Familia) son rechazadas |
| **Dashboard web propio** ([`web/`](../web/README.es.md), React) | Cualquier navegador | Gratis | Funciona en cualquier sistema; control total del diseño; consume la misma API | Hay que programarlo y mantenerlo |
| **Metabase** | Linux, Windows, macOS (se instala como servidor) | Versión de código abierto gratuita | Se conecta directo a MariaDB; dashboards sin programar | Otro servicio para instalar; no consume la API sino la base |
| **Apache Superset** | Linux (se instala como servidor) | Código abierto, gratis | Muy completo; usa SQL | Instalación más pesada; curva de aprendizaje mayor |

Metabase y Superset se mencionan como alternativas conocidas; no se instalaron ni probaron
en este proyecto.
