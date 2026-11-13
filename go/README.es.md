# Go — API con net/http

[English](README.md) | **Español**

La misma API de solo lectura que [`../python/api.py`](../python/api.py), escrita en **Go**
usando solo el router de la biblioteca estándar, sobre la misma base MariaDB. Cumple el
[contrato de la API](../README.es.md#contrato-de-la-api) y está verificada por el test de
contrato entre lenguajes.

## Camino rápido

Requisitos: Go 1.22 o posterior (desarrollado con 1.27), la base cargada por el pipeline
de Python y el archivo `.env` en la raíz del repositorio.

```bash
cd go
go run .              # http://127.0.0.1:8080
go test ./...         # tests unitarios con un repositorio falso, sin base de datos
go build -o api-go .  # opcional: un único binario autocontenido (ignorado por git)
```

`main.go` carga `../.env` con un lector propio muy simple (las variables de entorno que
ya existen tienen prioridad, igual que con python-dotenv). La variable `PORT` permite
cambiar el puerto.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| `main.go` | Punto de entrada: lector del `.env`, configuración de la base y servidor HTTP |
| `handlers.go` | `NewServer(repo)`: rutas, validación de parámetros y respuestas JSON |
| `repository.go` | Interfaz `Repository`, `SQLRepository` con el SQL y `DatabaseError` |
| `handlers_test.go` | 8 tests con `net/http/httptest` contra un repositorio falso |

La única dependencia externa es el driver de MySQL
[`github.com/go-sql-driver/mysql`](https://github.com/go-sql-driver/mysql).

## Diseño

- **Router de la biblioteca estándar:** desde Go 1.22, `http.ServeMux` entiende métodos y
  parámetros de ruta (`"GET /sales/{transaction_id}"`), así que no hace falta un framework.
- **Las rutas solo se ocupan de HTTP**; `SQLRepository` concentra el SQL detrás de la
  interfaz `Repository`, así que los tests inyectan uno falso.
- **Errores:** validación → `422 {"detail": ...}`, `DatabaseError` → `503`, cualquier otro → `500`.
- **El SQL** usa marcadores `?`, nunca concatenación de texto.
- **`ReadHeaderTimeout`** en el servidor protege contra clientes que envían las cabeceras
  muy lentamente (ataque Slowloris).
- **Compilado:** a diferencia de Python y Node, `go build` genera un único binario nativo
  que corre sin instalar ningún runtime, algo muy práctico para desplegar en un servidor.

## Cómo igualar el JSON de Python

| Problema | Solución |
|----------|----------|
| Un slice `nil` se codifica como `null`, no como `[]` | los slices se crean con `make([]T, 0)` |
| Columnas `DATE` | se leen como `string` (sin `parseTime`) → `"2023-01-01"` |
| Fechas imposibles como `2023-02-30` | `time.Parse(time.DateOnly, ...)` las rechaza |
| Redondeo de `average_ticket` | `math.Round(x*100) / 100` |
