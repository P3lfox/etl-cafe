// HTTP layer of the Node API. Same contract as ../../api.py:
// GET /sales, GET /sales/:transactionId, GET /summary — read-only, JSON.
import express from "express";

import { DatabaseError } from "./repository.js";

const MAX_LIMIT = 10_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^[+-]?\d+$/;

class ValidationError extends Error {}

/** Repeated query keys arrive as arrays; keep the last one (FastAPI does the same). */
function single(value) {
  return Array.isArray(value) ? value.at(-1) : value;
}

function parseInteger(query, name, { defaultValue, min, max = Infinity }) {
  const raw = single(query[name]);
  if (raw === undefined) return defaultValue;
  if (!INTEGER.test(raw)) throw new ValidationError(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new ValidationError(`${name} must be between ${min} and ${max}`);
  return value;
}

function parseDate(query, name) {
  const raw = single(query[name]);
  if (raw === undefined) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  // The round trip rejects impossible dates like 2023-02-30.
  if (!ISO_DATE.test(raw) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ValidationError(`${name} must be a valid date (YYYY-MM-DD)`);
  }
  return raw;
}

function parseDateRange(query) {
  const dateFrom = parseDate(query, "date_from");
  const dateTo = parseDate(query, "date_to");
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError("date_from must be on or before date_to");
  }
  return { dateFrom, dateTo };
}

function text(query, name) {
  return single(query[name]) ?? null;
}

export function createApp(repository) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/", (req, res) => {
    res.json({ endpoints: ["/sales", "/sales/{transaction_id}", "/summary"] });
  });

  app.get("/sales", async (req, res) => {
    const filters = {
      ...parseDateRange(req.query),
      item: text(req.query, "item"),
      paymentMethod: text(req.query, "payment_method"),
      location: text(req.query, "location"),
    };
    const limit = parseInteger(req.query, "limit", { defaultValue: 100, min: 1, max: MAX_LIMIT });
    const offset = parseInteger(req.query, "offset", { defaultValue: 0, min: 0 });
    res.json(await repository.listSales(filters, limit, offset));
  });

  app.get("/sales/:transactionId", async (req, res) => {
    const { transactionId } = req.params;
    const sale = await repository.getSale(transactionId);
    if (sale === null) {
      res.status(404).json({ detail: `Sale ${transactionId} not found` });
      return;
    }
    res.json(sale);
  });

  app.get("/summary", async (req, res) => {
    const { dateFrom, dateTo } = parseDateRange(req.query);
    res.json(await repository.summary(dateFrom, dateTo));
  });

  // Express 5 forwards errors thrown in async handlers here.
  app.use((error, req, res, next) => {
    if (error instanceof ValidationError) {
      res.status(422).json({ detail: error.message });
    } else if (error instanceof DatabaseError) {
      res.status(503).json({ detail: "Database unavailable" });
    } else {
      console.error(error);
      res.status(500).json({ detail: "Internal server error" });
    }
  });

  return app;
}
