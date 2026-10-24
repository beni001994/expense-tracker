export interface CategoryTotal {
  categoryId: number;
  name: string;
  totalCents: number;
  count: number;
}

export interface Bar extends CategoryTotal {
  /** Width relative to the largest category, 0-100. */
  widthPct: number;
  /** Share of the month's total, rounded to one decimal. */
  sharePct: number;
}

/** Parses user input like "12", "12.5" or "1,234.50" into integer cents. Returns null if invalid or not positive. */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "");
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const cents = Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Inverse of parseAmountToCents for pre-filling edit forms. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO(date = new Date()): string {
  return `${monthOf(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive first and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Turns category totals into bar chart geometry. Input order is preserved. */
export function toBars(categories: CategoryTotal[]): Bar[] {
  const max = Math.max(0, ...categories.map((c) => c.totalCents));
  const total = categories.reduce((sum, c) => sum + c.totalCents, 0);
  return categories.map((c) => ({
    ...c,
    widthPct: max === 0 ? 0 : (c.totalCents / max) * 100,
    sharePct: total === 0 ? 0 : Math.round((c.totalCents / total) * 1000) / 10,
  }));
}

export interface ExpenseFormInput {
  amount: string;
  description: string;
  date: string;
  categoryId: string;
}

export type ExpenseFormResult =
  | { ok: true; value: { amountCents: number; description: string; date: string; categoryId: number } }
  | { ok: false; errors: Partial<Record<keyof ExpenseFormInput, string>> };

export function validateExpenseForm(f: ExpenseFormInput): ExpenseFormResult {
  const errors: Partial<Record<keyof ExpenseFormInput, string>> = {};
  const amountCents = parseAmountToCents(f.amount);
  if (amountCents === null) errors.amount = "Enter a positive amount, e.g. 12.50";
  const description = f.description.trim();
  if (!description) errors.description = "Description is required";
  else if (description.length > 200) errors.description = "Description must be 200 characters or fewer";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errors.date = "Pick a date";
  const categoryId = Number(f.categoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) errors.categoryId = "Pick a category";
  if (Object.keys(errors).length > 0 || amountCents === null) return { ok: false, errors };
  return { ok: true, value: { amountCents, description, date: f.date, categoryId } };
}
