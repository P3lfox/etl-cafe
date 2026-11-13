"""Contract test: the Python API and the Node API must answer identically.

Both servers must be running against the same database:
    uv run uvicorn api:app --port 8000
    (cd api-node && npm start)            # port 3000
    PY_API_URL=http://127.0.0.1:8000 NODE_API_URL=http://127.0.0.1:3000 uv run pytest tests/test_contract.py

Skipped when the URLs are not set, so `uv run pytest` still works without servers.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

import pytest

PY_API_URL = os.getenv("PY_API_URL")
NODE_API_URL = os.getenv("NODE_API_URL")

pytestmark = pytest.mark.skipif(
    not (PY_API_URL and NODE_API_URL),
    reason="set PY_API_URL and NODE_API_URL to run the contract test",
)

# Same status code AND same JSON body.
FULL_MATCH = [
    "/sales",
    "/sales?limit=10000",
    "/sales?item=Tea&date_from=2023-03-01&date_to=2023-03-31",
    "/sales?payment_method=Unknown&location=Takeaway&limit=50&offset=20",
    "/sales?item=",
    "/sales?item=" + urllib.parse.quote("Tea' OR '1'='1"),
    "/sales?date_from=2023-12-01&date_to=2023-01-01",
    "/sales/TXN_1581562",
    "/sales/NOPE",
    "/summary",
    "/summary?date_from=2023-06-01&date_to=2023-06-30",
]

# Same status code only: FastAPI's validation error body has its own format.
STATUS_ONLY = [
    "/sales?limit=0",
    "/sales?limit=10001",
    "/sales?limit=abc",
    "/sales?offset=-1",
    "/sales?date_from=ayer",
    "/summary?date_to=2023-02-30",
]


def call(base: str, path: str) -> tuple[int, object]:
    try:
        with urllib.request.urlopen(base + path, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


@pytest.mark.parametrize("path", FULL_MATCH)
def test_same_status_and_body(path):
    assert call(NODE_API_URL, path) == call(PY_API_URL, path)


@pytest.mark.parametrize("path", STATUS_ONLY)
def test_same_status(path):
    py_status, _ = call(PY_API_URL, path)
    node_status, _ = call(NODE_API_URL, path)
    assert node_status == py_status == 422
