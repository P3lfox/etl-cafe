// All SQL lives here; the routes in app.js only deal with HTTP.
// Mirrors SalesRepository in ../../python/api.py so all APIs return the same data.
import mysql from "mysql2/promise";

/** Any driver failure (connection refused, timeout, bad credentials...). Mapped to HTTP 503. */
export class DatabaseError extends Error {
  constructor(cause) {
    super("Database unavailable", { cause });
    this.name = "DatabaseError";
  }
}

const SALES_QUERY = `
  SELECT s.transaction_id, s.transaction_date, i.name AS item, s.quantity,
         s.price_per_unit, s.total_spent, p.name AS payment_method, l.name AS location
  FROM sales s
  JOIN items i USING (item_id)
  JOIN payment_methods p USING (payment_method_id)
  JOIN locations l USING (location_id)
`;
const FROM_JOINS = SALES_QUERY.slice(SALES_QUERY.indexOf("FROM") + "FROM".length);

const METRICS =
  "COUNT(*) AS transactions, COALESCE(SUM(s.quantity), 0) AS units, " +
  "COALESCE(SUM(s.total_spent), 0) AS revenue";

const SUMMARY_GROUPS = {
  by_item: "i.name",
  by_payment_method: "p.name",
  by_location: "l.name",
  by_month: "DATE_FORMAT(s.transaction_date, '%Y-%m')",
};

/** Build a parameterized WHERE clause (never concatenate user input into SQL). */
export function whereClause({ dateFrom = null, dateTo = null, item = null, paymentMethod = null, location = null }) {
  const conditions = [
    ["s.transaction_date >= ?", dateFrom],
    ["s.transaction_date <= ?", dateTo],
    ["i.name = ?", item],
    ["p.name = ?", paymentMethod],
    ["l.name = ?", location],
  ].filter(([, value]) => value !== null);
  const clause = conditions.length ? ` WHERE ${conditions.map(([sql]) => sql).join(" AND ")}` : "";
  return [clause, conditions.map(([, value]) => value)];
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export class SalesRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async #fetch(sql, params = []) {
    try {
      const [rows] = await this.pool.query(sql, params);
      return rows;
    } catch (error) {
      throw new DatabaseError(error);
    }
  }

  async listSales(filters, limit, offset) {
    const [where, params] = whereClause(filters);
    const sql = `${SALES_QUERY}${where} ORDER BY s.transaction_date, s.transaction_id LIMIT ? OFFSET ?`;
    return this.#fetch(sql, [...params, limit, offset]);
  }

  async getSale(transactionId) {
    const rows = await this.#fetch(`${SALES_QUERY} WHERE s.transaction_id = ?`, [transactionId]);
    return rows[0] ?? null;
  }

  async summary(dateFrom, dateTo) {
    const [where, params] = whereClause({ dateFrom, dateTo });
    const [totals] = await this.#fetch(`SELECT ${METRICS} FROM ${FROM_JOINS}${where}`, params);
    const result = {
      total_revenue: totals.revenue,
      total_transactions: totals.transactions,
      total_units: totals.units,
      average_ticket: totals.transactions ? round2(totals.revenue / totals.transactions) : 0,
    };
    for (const [key, expression] of Object.entries(SUMMARY_GROUPS)) {
      result[key] = await this.#fetch(
        `SELECT ${expression} AS name, ${METRICS} FROM ${FROM_JOINS}${where} GROUP BY name ORDER BY name`,
        params,
      );
    }
    return result;
  }
}

/** Connection pool configured from the same .env as the Python side (see ../../python/db.py). */
export function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: "utf8mb4",
    connectTimeout: 5000,
    connectionLimit: 5,
    decimalNumbers: true, // DECIMAL as JS numbers, not strings (matches the Python floats)
    dateStrings: true, // DATE as "YYYY-MM-DD", no timezone shift
  });
}
