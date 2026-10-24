import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatCents,
  monthLabel,
  monthRange,
  parseAmountToCents,
  shiftMonth,
  todayISO,
  toBars,
  validateExpenseForm,
} from "./logic";

describe("parseAmountToCents", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.07", 7],
    ["$1,234.56", 123456],
    ["  3  ", 300],
  ])("parses %s", (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "1.", ".5", "1e3", "12,5"])("rejects %j", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });

  it("avoids floating point drift", () => {
    expect(parseAmountToCents("19.99")).toBe(1999);
    expect(parseAmountToCents("0.29")).toBe(29);
  });

  it("round-trips through centsToInput", () => {
    expect(parseAmountToCents(centsToInput(1999))).toBe(1999);
    expect(centsToInput(5)).toBe("0.05");
  });
});

describe("formatCents", () => {
  it("formats as USD", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("month helpers", () => {
  it("shifts across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-03", 0)).toBe("2026-03");
    expect(shiftMonth("2026-03", -15)).toBe("2024-12");
  });

  it("computes inclusive ranges including leap years", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("labels months and formats local dates", () => {
    expect(monthLabel("2026-03")).toBe("March 2026");
    expect(todayISO(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("toBars", () => {
  const totals = [
    { categoryId: 1, name: "Rent", totalCents: 5000, count: 1 },
    { categoryId: 2, name: "Food", totalCents: 2500, count: 4 },
    { categoryId: 3, name: "Fun", totalCents: 2500, count: 2 },
  ];

  it("scales widths to the largest bar and computes shares", () => {
    const bars = toBars(totals);
    expect(bars.map((b) => b.widthPct)).toEqual([100, 50, 50]);
    expect(bars.map((b) => b.sharePct)).toEqual([50, 25, 25]);
  });

  it("rounds shares to one decimal", () => {
    const bars = toBars([
      { categoryId: 1, name: "A", totalCents: 1, count: 1 },
      { categoryId: 2, name: "B", totalCents: 2, count: 1 },
    ]);
    expect(bars.map((b) => b.sharePct)).toEqual([33.3, 66.7]);
  });

  it("handles empty input", () => {
    expect(toBars([])).toEqual([]);
  });
});

describe("validateExpenseForm", () => {
  const valid = { amount: "12.50", description: " Lunch ", date: "2026-03-10", categoryId: "2" };

  it("returns normalised values", () => {
    expect(validateExpenseForm(valid)).toEqual({
      ok: true,
      value: { amountCents: 1250, description: "Lunch", date: "2026-03-10", categoryId: 2 },
    });
  });

  it("reports each invalid field", () => {
    const res = validateExpenseForm({ amount: "x", description: " ", date: "", categoryId: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(["amount", "categoryId", "date", "description"]);
  });

  it("rejects over-long descriptions", () => {
    const res = validateExpenseForm({ ...valid, description: "x".repeat(201) });
    expect(res.ok).toBe(false);
  });
});
