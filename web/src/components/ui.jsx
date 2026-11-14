import { useState } from "react";

import { formatAmount, formatCount } from "../lib/metrics.js";

const PRESETS = [
  { id: "year", label: "Full year", from: null, to: null },
  { id: "q1", label: "Q1", from: "2023-01-01", to: "2023-03-31" },
  { id: "q2", label: "Q2", from: "2023-04-01", to: "2023-06-30" },
  { id: "q3", label: "Q3", from: "2023-07-01", to: "2023-09-30" },
  { id: "q4", label: "Q4", from: "2023-10-01", to: "2023-12-31" },
];

/** One filter row above every chart it scopes: presets plus a custom range. */
export function DateFilter({ range, presetId, onChange }) {
  const setCustom = (key, value) => onChange({ ...range, [key]: value || null }, null);
  return (
    <div className="filters" role="group" aria-label="Date range">
      <div className="segmented">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={presetId === p.id}
            onClick={() => onChange({ from: p.from, to: p.to }, p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="custom-range">
        <label>
          From{" "}
          <input
            type="date"
            min="2023-01-01"
            max="2023-12-31"
            value={range.from ?? ""}
            onChange={(e) => setCustom("from", e.target.value)}
          />
        </label>
        <label>
          To{" "}
          <input
            type="date"
            min="2023-01-01"
            max="2023-12-31"
            value={range.to ?? ""}
            onChange={(e) => setCustom("to", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

/** Headline numbers: a stat tile, not a chart, when the story is one number. */
export function KpiTiles({ summary }) {
  const tiles = [
    ["Total revenue", formatAmount(summary.total_revenue)],
    ["Transactions", formatCount(summary.total_transactions)],
    ["Units sold", formatCount(summary.total_units)],
    ["Average ticket", formatAmount(summary.average_ticket)],
  ];
  return (
    <section className="kpis" aria-label="Key figures">
      {tiles.map(([label, value]) => (
        <div className="tile" key={label}>
          <div className="tile-label">{label}</div>
          <div className="tile-value">{value}</div>
        </div>
      ))}
    </section>
  );
}

/** Card with a Chart / Table switch: every chart has a table twin. */
export function ChartCard({ title, subtitle, note, chart, table, wide = false }) {
  const [view, setView] = useState("chart");
  return (
    <section className="card" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="toggle" role="group" aria-label={`${title} view`}>
          {["chart", "table"].map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? chart : table}
      {note && <p className="note">{note}</p>}
    </section>
  );
}

/** columns: [{ key, label, format?, numeric? }] */
export function DataTable({ columns, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.numeric ? "num" : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : undefined}>
                  {c.format ? c.format(row[c.key]) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
