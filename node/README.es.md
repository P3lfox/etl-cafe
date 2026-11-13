# Node.js — API con Express

[English](README.md) | **Español**

La misma API de solo lectura que [`../python/api.py`](../python/api.py), escrita en
**Node.js + Express 5**, sobre la misma base MariaDB. Cumple el
[contrato de la API](../README.es.md#contrato-de-la-api) y está verificada por el test de
contrato entre lenguajes.

## Camino rápido

Requisitos: Node.js 22 o posterior, la base cargada por el pipeline de Python y el
archivo `.env` en la raíz del repositorio.

```bash
cd node
npm install
npm start          # http://127.0.0.1:3000
npm run dev        # lo mismo, pero se reinicia al guardar cambios (como nodemon)
npm test           # tests unitarios con un repositorio falso, sin base de datos
```

El `.env` se carga con la opción incorporada de Node `--env-file=../.env` (sin el paquete
`dotenv`). La variable `PORT` permite cambiar el puerto.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `src/server.js` | Punto de entrada: crea el pool de conexiones y empieza a escuchar |
| `src/app.js` | `createApp(repository)`: rutas, validación de parámetros y middleware de errores |
| `src/repository.js` | `SalesRepository` con el SQL, `createPool()` y `DatabaseError` |
| `test/app.test.js` | 13 tests con `node:test` + `fetch` contra un repositorio falso |

## Diseño

- **Las rutas solo se ocupan de HTTP**; todo el SQL está en `SalesRepository`, así que los tests inyectan uno falso.
- **La validación es explícita** (Express no valida a partir de tipos como FastAPI): un
  `limit`, `offset` o fecha inválidos lanzan un `ValidationError` → `422 {"detail": ...}`.
- **Errores:** Express 5 envía al middleware de errores lo que se lanza dentro de los
  handlers `async`: `ValidationError` → `422`, `DatabaseError` → `503`, cualquier otro → `500`.
- **El SQL** usa marcadores `?`, nunca concatenación de texto.

## Cómo igualar el JSON de Python

| Problema | Solución |
|----------|----------|
| mysql2 devuelve los `DECIMAL` como texto (`"4.00"`) | `decimalNumbers: true` |
| mysql2 convierte `DATE` en objetos `Date` de JS, que pueden correrse un día por la zona horaria | `dateStrings: true` → `"2023-01-01"` |
| Express 5 convierte las claves repetidas (`?item=a&item=b`) en arrays | se toma el último valor, igual que FastAPI |
| Fechas imposibles como `2023-02-30` | se rechazan comprobando la conversión ida y vuelta a ISO |
