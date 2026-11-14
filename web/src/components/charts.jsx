// Chart components (Recharts). Marks follow fixed specs: 2px lines, >=8px dots with a
// surface ring, bars <= 24px thick with a 4px rounded data-end and a square baseline,
// solid hairline grid, one y-axis per chart, text in text colors (never series colors).
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatAmount,
  formatCompact,
  formatCount,
  formatPercent,
  formatSignedPercent,
  isUnknown,
} from "../lib/metrics.js";

const AXIS_TICK = { fill: "var(--text-muted)", fontSize: 12 };
const BAR_MAX = 24;
const RADIUS = 4;

/** Rectangle path with only its data-end rounded ("top", "bottom" or "right"). */
function dataEndPath(rawX, rawY, rawW, rawH, end) {
  const x = rawW < 0 ? rawX + rawW : rawX;
  const y = rawH < 0 ? rawY + rawH : rawY;
  const w = Math.abs(rawW);
  const h = Math.abs(rawH);
  if (!w || !h) return null;
  const r = Math.min(RADIUS, end === "right" ? Math.min(h / 2, w) : Math.min(w / 2, h));
  if (end === "top") {
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }
  if (end === "bottom") {
    return `M${x},${y} L${x + w},${y} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} Z`;
  }
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

/** Diverging column: blue up, red down, rounded at the end away from zero. */
function GrowthColumn({ x, y, width, height, payload }) {
  const negative = payload.growth < 0;
  const d = dataEndPath(x, y, width, height, negative ? "bottom" : "top");
  return d && <path d={d} fill={negative ? "var(--series-negative)" : "var(--series-1)"} />;
}

/** Horizontal bar: blue for real categories, gray for "Unknown" (missing data). */
function RankedBar({ x, y, width, height, payload }) {
  const d = dataEndPath(x, y, width, height, "right");
  return d && <path d={d} fill={isUnknown(payload.name) ? "var(--series-missing)" : "var(--series-1)"} />;
}

/** Tooltip in text colors; `rows(datum)` returns [label, value] pairs. */
function ChartTooltip({ active, payload, rows }) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{datum.label ?? datum.name}</div>
      {rows(datum).map(([label, value]) => (
        <div className="tooltip-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

const revenueRows = (d) => [
  ["Revenue", formatAmount(d.revenue)],
  ["Transactions", formatCount(d.transactions)],
  ["Units", formatCount(d.units)],
];

/** Value label on the last point only (selective labeling, never on every point). */
function LastPointLabel({ x, y, value, index, count }) {
  if (index !== count - 1) return null;
  return (
    <text className="end-label" x={x} y={y - 12} textAnchor="end" fill="var(--text-secondary)" fontSize={12}>
      {formatAmount(value)}
    </text>
  );
}

export function RevenueTrendChart({ data }) {
  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--axis)" }} />
          <YAxis tickFormatter={formatCompact} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            content={<ChartTooltip rows={revenueRows} />}
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
          />
          <Line
            type="linear"
            dataKey="revenue"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 }}
            isAnimationActive={false}
          >
            <LabelList dataKey="revenue" content={<LastPointLabel count={data.length} />} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const growthRows = (d) => [
  ["Change vs. previous month", formatSignedPercent(d.growth)],
  ["Revenue", formatAmount(d.revenue)],
];

export function GrowthChart({ data }) {
  return (
    <div style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip content={<ChartTooltip rows={growthRows} />} cursor={{ fill: "var(--hover-wash)" }} />
          <Bar dataKey="growth" maxBarSize={BAR_MAX} shape={GrowthColumn} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const shareRows = (d) => [
  ["Revenue", formatAmount(d.revenue)],
  ["Share", formatPercent(d.share)],
  ["Transactions", formatCount(d.transactions)],
];

/** Horizontal ranked bars with the share as a label at each bar's tip. */
export function RankedBarChart({ data }) {
  const height = data.length * 36 + 24;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
          {/* No grid: the value axis is hidden and every bar carries its own share label. */}
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--axis)" }}
            width={104}
          />
          <Tooltip content={<ChartTooltip rows={shareRows} />} cursor={{ fill: "var(--hover-wash)" }} />
          <Bar dataKey="revenue" maxBarSize={BAR_MAX} shape={RankedBar} isAnimationActive={false}>
            <LabelList
              dataKey="share"
              position="right"
              formatter={formatPercent}
              fill="var(--text-secondary)"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
