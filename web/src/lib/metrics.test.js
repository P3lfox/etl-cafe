import { describe, expect, test } from "vitest";

import {
  buildSummaryQuery,
  formatAmount,
  formatCount,
  formatPercent,
  formatSignedPercent,
  monthLabel,
  monthOverMonth,
  rankByRevenue,
  withShare,
} from "./metrics.js";

const group = (name, revenue) => ({ name, transactions: 1, units: 1, revenue });

describe("monthOverMonth", () => {
  test("first month has no growth, the rest compare with the previous one", () => {
    const result = monthOverMonth([group("2023-01", 100), group("2023-02", 110), group("2023-03", 99)]);
    expect(result.map((m) => m.growth)).toEqual([null, 0.1, -0.1]);
  });

  test("growth is null when the previous month had no revenue", () => {
    expect(monthOverMonth([group("2023-01", 0), group("2023-02", 50)])[1].growth).toBeNull();
  });
});

describe("withShare", () => {
  test("adds each group's share of the total revenue", () => {
    const result = withShare([group("A", 30), group("B", 10)]);
    expect(result.map((g) => g.share)).toEqual([0.75, 0.25]);
  });

  test("an empty total gives zero shares instead of NaN", () => {
    expect(withShare([group("A", 0)])[0].share).toBe(0);
  });
});

describe("rankByRevenue", () => {
  test("sorts by revenue descending and keeps Unknown last", () => {
    const ranked = rankByRevenue([group("Cash", 10), group("Unknown", 99), group("Card", 20)]);
    expect(ranked.map((g) => g.name)).toEqual(["Card", "Cash", "Unknown"]);
  });

  test("does not mutate its input", () => {
    const input = [group("A", 1), group("B", 2)];
    rankByRevenue(input);
    expect(input.map((g) => g.name)).toEqual(["A", "B"]);
  });
});

describe("buildSummaryQuery", () => {
  test("includes only the dates that are set", () => {
    expect(buildSummaryQuery({ from: "2023-01-01", to: null })).toBe("date_from=2023-01-01");
    expect(buildSummaryQuery({ from: "2023-01-01", to: "2023-03-31" })).toBe(
      "date_from=2023-01-01&date_to=2023-03-31",
    );
    expect(buildSummaryQuery({ from: null, to: null })).toBe("");
  });
});

describe("formatters", () => {
  test("format amounts, counts and percentages", () => {
    expect(formatAmount(80041.5)).toBe("80,041.50");
    expect(formatCount(9064)).toBe("9,064");
    expect(formatPercent(0.0532)).toBe("5.3%");
    expect(formatSignedPercent(0.0532)).toBe("+5.3%");
    expect(formatSignedPercent(-0.1)).toBe("−10.0%");
    expect(formatSignedPercent(null)).toBe("—");
  });

  test("month labels are short month names", () => {
    expect(monthLabel("2023-01")).toBe("Jan");
    expect(monthLabel("2023-12")).toBe("Dec");
  });
});
