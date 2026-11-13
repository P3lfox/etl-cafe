"""Contract test: every API implementation must answer exactly like the Python one.

The Python API (api.py) is the reference. Each other implementation whose URL is
set is compared against it, request by request. All servers must use the same database:

    (cd python && uv run uvicorn api:app --port 8000)   # reference
    (cd node && npm start)                               # port 3000
    (cd go && go run .)                                  # port 8080
    PY_API_URL=http://127.0.0.1:8000 \
    NODE_API_URL=http://127.0.0.1:3000 \
    GO_API_URL=http://127.0.0.1:8080 \
    uv run --project python pytest python/tests/test_contract.py

Implementations without a URL are skipped, so `uv run pytest` works without servers.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

import pytest

PY_API_URL = os.getenv("PY_API_URL")
IMPLEMENTATIONS = {
    "node": os.getenv("NODE_API_URL"),
    "go": os.getenv("GO_API_URL"),
}

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


def implementation_params() -> list:
    return [
        pytest.param(
            url,
            id=name,
            marks=pytest.mark.skipif(
                not (PY_API_URL and url),
                reason=f"set PY_API_URL and {name.upper()}_API_URL to run the {name} contract test",
            ),
        )
        for name, url in IMPLEMENTATIONS.items()
    ]


def call(base: str, path: str) -> tuple[int, object]:
    try:
        with urllib.request.urlopen(base + path, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


@pytest.mark.parametrize("path", FULL_MATCH)
@pytest.mark.parametrize("impl_url", implementation_params())
def test_same_status_and_body(impl_url, path):
    assert call(impl_url, path) == call(PY_API_URL, path)


@pytest.mark.parametrize("path", STATUS_ONLY)
@pytest.mark.parametrize("impl_url", implementation_params())
def test_same_status(impl_url, path):
    py_status, _ = call(PY_API_URL, path)
    impl_status, _ = call(impl_url, path)
    assert impl_status == py_status == 422
