/* global __API_TARGET__ */
import { useEffect, useMemo, useState } from "react";

import { fetchSummary } from "./api.js";
import { GrowthChart, RankedBarChart, RevenueTrendChart } from "./components/charts.jsx";
import { ChartCard, DataTable, DateFilter, KpiTiles } from "./components/ui.jsx";
import {
  formatAmount,
  formatCount,
  formatPercent,
  formatSignedPercent,
  monthLabel,
  monthOverMonth,
  rankByRevenue,
  withShare,
} from "./lib/metrics.js";

const GROUP_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "transactions", label: "Transactions", format: formatCount, numeric: true },
  { key: "units", label: "Units", format: formatCount, numeric: true },
  { key: "revenue", label: "Revenue", format: formatAmount, numeric: true },
  { key: "share", label: "Share", format: formatPercent, numeric: true },
];

const MONTH_COLUMNS = [
  { key: "label", label: "Month" },
  { key: "transactions", label: "Transactions", format: formatCount, numeric: true },
  { key: "revenue", label: "Revenue", format: formatAmount, numeric: true },
  { key: "growth", label: "Change vs. previous", format: formatSignedPercent, numeric: true },
];

const UNKNOWN_NOTE = "Gray = Unknown: the value was missing in the raw data (kept so revenue is not lost).";

export default function App() {
  const [range, setRange] = useState({ from: null, to: null });
  const [presetId, setPresetId] = useState("year");
  const [state, setState] = useState({ summary: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    fetchSummary(range, controller.signal)
      .then((summary) => setState({ summary, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== "AbortError") setState((s) => ({ ...s, error, loading: false }));
      });
    return () => controller.abort();
  }, [range]);

  const view = useMemo(() => {
    const { summary } = state;
    if (!summary) return null;
    const months = monthOverMonth(summary.by_month).map((m) => ({ ...m, label: monthLabel(m.name) }));
    return {
      months,
      items: rankByRevenue(withShare(summary.by_item)),
      payments: rankByRevenue(withShare(summary.by_payment_method)),
      locations: rankByRevenue(withShare(summary.by_location)),
    };
  }, [state]);

  const onRangeChange = (nextRange, nextPreset) => {
    setState((s) => ({ ...s, loading: true })); // keep the previous render, dimmed, while loading
    setRange(nextRange);
    setPresetId(nextPreset);
  };

  return (
    <main className="app">
      <header className="app-header">
        <h1>Cafe Sales Dashboard</h1>
        <p>Cleaned cafe transactions for 2023, served by the read-only sales API.</p>
      </header>

      <DateFilter range={range} presetId={presetId} onChange={onRangeChange} />

      {state.error && (
        <div className="error" role="alert">
          <strong>Could not load the data</strong>
          {state.error.message}
        </div>
      )}

      {state.summary && view && (
        <div className={`content${state.loading ? " is-loading" : ""}`} aria-busy={state.loading}>
          <KpiTiles summary={state.summary} />
          <div className="grid">
            <ChartCard
              wide
              title="Revenue by month"
              subtitle="Total revenue per month"
              chart={<RevenueTrendChart data={view.months} />}
              table={<DataTable columns={MONTH_COLUMNS} rows={view.months} />}
            />
            <ChartCard
              title="Month-over-month growth"
              subtitle="Revenue change vs. the previous month"
              note="The first month has no previous month to compare with."
              chart={<GrowthChart data={view.months} />}
              table={<DataTable columns={MONTH_COLUMNS} rows={view.months} />}
            />
            <ChartCard
              title="Revenue by product"
              subtitle="Ranked, with each product's share of revenue"
              chart={<RankedBarChart data={view.items} />}
              table={<DataTable columns={GROUP_COLUMNS} rows={view.items} />}
            />
            <ChartCard
              title="Revenue by payment method"
              subtitle="Ranked, with each method's share of revenue"
              note={UNKNOWN_NOTE}
              chart={<RankedBarChart data={view.payments} />}
              table={<DataTable columns={GROUP_COLUMNS} rows={view.payments} />}
            />
            <ChartCard
              title="Revenue by location"
              subtitle="Ranked, with each location's share of revenue"
              note={UNKNOWN_NOTE}
              chart={<RankedBarChart data={view.locations} />}
              table={<DataTable columns={GROUP_COLUMNS} rows={view.locations} />}
            />
          </div>
        </div>
      )}

      <footer className="app-footer">
        Data source: <code>{__API_TARGET__}</code> (through the <code>/api</code> proxy)
      </footer>
    </main>
  );
}
