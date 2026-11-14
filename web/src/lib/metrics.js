// Pure helpers: derive what /summary does not return directly, and format numbers.
// No React and no fetch here, so everything is unit-tested in metrics.test.js.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNKNOWN = "Unknown";

/** "2023-01" -> "Jan" */
export function monthLabel(yearMonth) {
  return MONTHS[Number(yearMonth.slice(5, 7)) - 1];
}

/** Adds `growth` = (revenue - previous) / previous; null for the first month or a zero base. */
export function monthOverMonth(byMonth) {
  return byMonth.map((month, i) => {
    const previous = byMonth[i - 1]?.revenue;
    const growth = previous ? (month.revenue - previous) / previous : null;
    return { ...month, growth };
  });
}

/** Adds `share` = this group's revenue / total revenue of all groups. */
export function withShare(groups) {
  const total = groups.reduce((sum, g) => sum + g.revenue, 0);
  return groups.map((g) => ({ ...g, share: total ? g.revenue / total : 0 }));
}

/** Highest revenue first; "Unknown" (missing data, not a real category) always last. */
export function rankByRevenue(groups) {
  return [...groups].sort((a, b) => {
    if (a.name === UNKNOWN) return 1;
    if (b.name === UNKNOWN) return -1;
    return b.revenue - a.revenue;
  });
}

export function isUnknown(name) {
  return name === UNKNOWN;
}

/** Query string for /summary; only the dates that are set. */
export function buildSummaryQuery({ from, to }) {
  const params = new URLSearchParams();
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  return params.toString();
}

const amount = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const formatAmount = (value) => amount.format(value);
export const formatCount = (value) => count.format(value);
export const formatCompact = (value) => compact.format(value);
export const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;

/** "+5.3%" / "−10.0%" (true minus sign) / "—" when there is no value. */
export function formatSignedPercent(value) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}
