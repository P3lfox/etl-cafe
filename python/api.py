"""Step 3 of the pipeline: read-only REST API over the cafe sales database.

Run:   uv run uvicorn api:app --reload
Docs:  http://127.0.0.1:8000/docs

Only GET endpoints: data enters through limpieza.py -> carga.py, never
through the API, so there is nothing to create, update or delete here.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from typing import Annotated

import pymysql
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymysql.cursors import DictCursor

import db

MAX_LIMIT = 10_000  # large enough for Power BI to fetch every row in one call

SALES_QUERY = """
    SELECT s.transaction_id, s.transaction_date, i.name AS item, s.quantity,
           s.price_per_unit, s.total_spent, p.name AS payment_method, l.name AS location
    FROM sales s
    JOIN items i USING (item_id)
    JOIN payment_methods p USING (payment_method_id)
    JOIN locations l USING (location_id)
"""

# Group-by expressions for /summary. '%%' because pymysql uses '%' for params.
SUMMARY_GROUPS = {
    "by_item": "i.name",
    "by_payment_method": "p.name",
    "by_location": "l.name",
    "by_month": "DATE_FORMAT(s.transaction_date, '%%Y-%%m')",
}


# ------------------------------------------------------------------ models

class Sale(BaseModel):
    transaction_id: str
    transaction_date: date
    item: str
    quantity: int
    price_per_unit: float
    total_spent: float
    payment_method: str
    location: str


class Group(BaseModel):
    name: str
    transactions: int
    units: int
    revenue: float


class Summary(BaseModel):
    total_revenue: float
    total_transactions: int
    total_units: int
    average_ticket: float
    by_item: list[Group]
    by_payment_method: list[Group]
    by_location: list[Group]
    by_month: list[Group]


@dataclass
class SaleFilters:
    date_from: date | None = None
    date_to: date | None = None
    item: str | None = None
    payment_method: str | None = None
    location: str | None = None

    def where(self) -> tuple[str, tuple]:
        """Build a parameterized WHERE clause (never string-format user input)."""
        conditions = {
            "s.transaction_date >= %s": self.date_from,
            "s.transaction_date <= %s": self.date_to,
            "i.name = %s": self.item,
            "p.name = %s": self.payment_method,
            "l.name = %s": self.location,
        }
        used = {sql: value for sql, value in conditions.items() if value is not None}
        clause = " WHERE " + " AND ".join(used) if used else ""
        return clause, tuple(used.values())


# ------------------------------------------------------------- repository

class SalesRepository:
    """All SQL lives here; the routes only deal with HTTP."""

    def __init__(self, conn):
        self.conn = conn

    def _fetch(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.conn.cursor() as cursor:
            cursor.execute(sql, params)
            return list(cursor.fetchall())

    def list_sales(self, filters: SaleFilters, limit: int, offset: int) -> list[dict]:
        where, params = filters.where()
        sql = f"{SALES_QUERY}{where} ORDER BY s.transaction_date, s.transaction_id LIMIT %s OFFSET %s"
        return self._fetch(sql, (*params, limit, offset))

    def get_sale(self, transaction_id: str) -> dict | None:
        rows = self._fetch(f"{SALES_QUERY} WHERE s.transaction_id = %s", (transaction_id,))
        return rows[0] if rows else None

    def summary(self, date_from: date | None, date_to: date | None) -> dict:
        where, params = SaleFilters(date_from=date_from, date_to=date_to).where()
        base = SALES_QUERY.split("FROM", 1)[1]  # same joins as SALES_QUERY
        metrics = "COUNT(*) AS transactions, COALESCE(SUM(s.quantity), 0) AS units, " \
                  "COALESCE(SUM(s.total_spent), 0) AS revenue"

        totals = self._fetch(f"SELECT {metrics} FROM {base}{where}", params)[0]
        result = {
            "total_revenue": totals["revenue"],
            "total_transactions": totals["transactions"],
            "total_units": totals["units"],
            "average_ticket": round(totals["revenue"] / totals["transactions"], 2)
            if totals["transactions"] else 0,
        }
        for key, expression in SUMMARY_GROUPS.items():
            result[key] = self._fetch(
                f"SELECT {expression} AS name, {metrics} FROM {base}{where} "
                f"GROUP BY name ORDER BY name",
                params,
            )
        return result


def get_repository() -> Iterator[SalesRepository]:
    conn = db.connect(cursorclass=DictCursor)
    try:
        yield SalesRepository(conn)
    finally:
        conn.close()


Repository = Annotated[SalesRepository, Depends(get_repository)]


def check_date_range(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from must be on or before date_to")


def sale_filters(
    date_from: date | None = None,
    date_to: date | None = None,
    item: str | None = None,
    payment_method: str | None = None,
    location: str | None = None,
) -> SaleFilters:
    check_date_range(date_from, date_to)
    return SaleFilters(date_from, date_to, item, payment_method, location)


# ------------------------------------------------------------------- app

app = FastAPI(
    title="Cafe Sales API",
    description="Read-only API over the cleaned cafe sales data (source for Power BI).",
    version="1.0.0",
)


@app.exception_handler(pymysql.MySQLError)
def database_error(request: Request, exc: pymysql.MySQLError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


@app.get("/", summary="API index")
def index() -> dict:
    return {"docs": "/docs", "endpoints": ["/sales", "/sales/{transaction_id}", "/summary"]}


@app.get("/sales", summary="List sales with optional filters")
def list_sales(
    repo: Repository,
    filters: Annotated[SaleFilters, Depends(sale_filters)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Sale]:
    return repo.list_sales(filters, limit, offset)


@app.get("/sales/{transaction_id}", summary="Get one sale")
def get_sale(transaction_id: str, repo: Repository) -> Sale:
    sale = repo.get_sale(transaction_id)
    if sale is None:
        raise HTTPException(status_code=404, detail=f"Sale {transaction_id} not found")
    return sale


@app.get("/summary", summary="KPIs and totals grouped by item, payment, location and month")
def summary(
    repo: Repository,
    date_from: date | None = None,
    date_to: date | None = None,
) -> Summary:
    check_date_range(date_from, date_to)
    return repo.summary(date_from, date_to)
