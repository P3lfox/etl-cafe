from datetime import date

import pymysql
import pytest
from fastapi.testclient import TestClient

from api import app, get_repository

SALE = {
    "transaction_id": "TXN_1",
    "transaction_date": date(2023, 1, 1),
    "item": "Coffee",
    "quantity": 2,
    "price_per_unit": 2.0,
    "total_spent": 4.0,
    "payment_method": "Cash",
    "location": "In-store",
}
GROUP = {"name": "Coffee", "transactions": 1, "units": 2, "revenue": 4.0}
SUMMARY = {
    "total_revenue": 4.0,
    "total_transactions": 1,
    "total_units": 2,
    "average_ticket": 4.0,
    "by_item": [GROUP],
    "by_payment_method": [{**GROUP, "name": "Cash"}],
    "by_location": [{**GROUP, "name": "In-store"}],
    "by_month": [{**GROUP, "name": "2023-01"}],
}


class FakeRepository:
    def __init__(self):
        self.calls = []

    def list_sales(self, filters, limit, offset):
        self.calls.append(("list_sales", filters, limit, offset))
        return [SALE]

    def get_sale(self, transaction_id):
        return SALE if transaction_id == "TXN_1" else None

    def summary(self, date_from, date_to):
        self.calls.append(("summary", date_from, date_to))
        return SUMMARY


@pytest.fixture
def repo():
    fake = FakeRepository()
    app.dependency_overrides[get_repository] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


client = TestClient(app)


def test_list_sales_returns_rows_and_forwards_filters(repo):
    response = client.get("/sales?date_from=2023-01-01&item=Coffee&limit=50&offset=10")
    assert response.status_code == 200
    assert response.json()[0]["transaction_id"] == "TXN_1"
    _, filters, limit, offset = repo.calls[0]
    assert filters.date_from == date(2023, 1, 1)
    assert filters.item == "Coffee"
    assert (limit, offset) == (50, 10)


@pytest.mark.parametrize("query", ["limit=0", "limit=10001", "offset=-1", "date_from=ayer"])
def test_invalid_query_params_return_422(repo, query):
    assert client.get(f"/sales?{query}").status_code == 422


def test_date_from_after_date_to_returns_422(repo):
    response = client.get("/sales?date_from=2023-12-01&date_to=2023-01-01")
    assert response.status_code == 422
    assert repo.calls == []


def test_get_sale_found(repo):
    response = client.get("/sales/TXN_1")
    assert response.status_code == 200
    assert response.json()["transaction_date"] == "2023-01-01"


def test_get_sale_missing_returns_404(repo):
    response = client.get("/sales/TXN_999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Sale TXN_999 not found"}


def test_summary_forwards_date_range(repo):
    response = client.get("/summary?date_to=2023-06-30")
    assert response.status_code == 200
    assert response.json()["by_month"][0]["name"] == "2023-01"
    assert repo.calls == [("summary", None, date(2023, 6, 30))]


def test_database_error_returns_503():
    def broken():
        raise pymysql.err.OperationalError(2003, "Can't connect")

    app.dependency_overrides[get_repository] = broken
    try:
        response = TestClient(app).get("/sales")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json() == {"detail": "Database unavailable"}
