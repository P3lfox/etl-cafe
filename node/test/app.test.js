import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createApp } from "../src/app.js";
import { DatabaseError } from "../src/repository.js";

const SALE = {
  transaction_id: "TXN_1",
  transaction_date: "2023-01-01",
  item: "Coffee",
  quantity: 2,
  price_per_unit: 2.0,
  total_spent: 4.0,
  payment_method: "Cash",
  location: "In-store",
};
const SUMMARY = { total_revenue: 4.0, total_transactions: 1 };

class FakeRepository {
  constructor() {
    this.calls = [];
  }
  async listSales(filters, limit, offset) {
    this.calls.push(["listSales", filters, limit, offset]);
    return [SALE];
  }
  async getSale(id) {
    return id === "TXN_1" ? SALE : null;
  }
  async summary(dateFrom, dateTo) {
    this.calls.push(["summary", dateFrom, dateTo]);
    return SUMMARY;
  }
}

describe("cafe sales API (Node)", () => {
  const repo = new FakeRepository();
  let server;
  let base;

  before(async () => {
    server = createApp(repo).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    repo.calls = [];
  });

  test("list sales returns rows and forwards filters", async () => {
    const res = await fetch(`${base}/sales?date_from=2023-01-01&item=Coffee&limit=50&offset=10`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [SALE]);
    const [, filters, limit, offset] = repo.calls[0];
    assert.equal(filters.dateFrom, "2023-01-01");
    assert.equal(filters.item, "Coffee");
    assert.deepEqual([limit, offset], [50, 10]);
  });

  test("defaults are limit 100 and offset 0", async () => {
    await fetch(`${base}/sales`);
    assert.deepEqual(repo.calls[0].slice(2), [100, 0]);
  });

  for (const query of ["limit=0", "limit=10001", "limit=abc", "offset=-1", "date_from=ayer", "date_to=2023-02-30"]) {
    test(`invalid query ${query} returns 422`, async () => {
      const res = await fetch(`${base}/sales?${query}`);
      assert.equal(res.status, 422);
      assert.deepEqual(repo.calls, []);
    });
  }

  test("date_from after date_to returns 422", async () => {
    const res = await fetch(`${base}/sales?date_from=2023-12-01&date_to=2023-01-01`);
    assert.equal(res.status, 422);
    assert.deepEqual(await res.json(), { detail: "date_from must be on or before date_to" });
  });

  test("get sale found", async () => {
    const res = await fetch(`${base}/sales/TXN_1`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), SALE);
  });

  test("get sale missing returns 404", async () => {
    const res = await fetch(`${base}/sales/TXN_999`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { detail: "Sale TXN_999 not found" });
  });

  test("summary forwards date range", async () => {
    const res = await fetch(`${base}/summary?date_to=2023-06-30`);
    assert.equal(res.status, 200);
    assert.deepEqual(repo.calls, [["summary", null, "2023-06-30"]]);
  });

  test("database error returns 503", async () => {
    const broken = createApp({
      listSales: async () => {
        throw new DatabaseError(new Error("connect ECONNREFUSED"));
      },
    }).listen(0);
    await new Promise((resolve) => broken.once("listening", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${broken.address().port}/sales`);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { detail: "Database unavailable" });
    } finally {
      broken.close();
    }
  });
});
