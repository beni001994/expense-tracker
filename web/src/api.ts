import type { CategoryTotal } from "./logic";

export interface Category {
  id: number;
  name: string;
}
export interface Expense {
  id: number;
  amountCents: number;
  description: string;
  date: string;
  categoryId: number;
  categoryName: string;
}
export interface ExpenseBody {
  amountCents: number;
  description: string;
  date: string;
  categoryId: number;
}
export interface Summary {
  month: string;
  totalCents: number;
  categories: CategoryTotal[];
}
export interface AuthResult {
  token: string;
  user: { id: number; email: string };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "expense-tracker.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable; session lasts until reload */
    }
  },
};

let unauthorizedHandler: () => void = () => {};
export const onUnauthorized = (fn: () => void) => {
  unauthorizedHandler = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 on a non-auth route means the session expired.
    if (res.status === 401 && !path.startsWith("/auth/")) unauthorizedHandler();
    throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string) => request<AuthResult>("POST", "/auth/register", { email, password }),
  login: (email: string, password: string) => request<AuthResult>("POST", "/auth/login", { email, password }),
  categories: () => request<Category[]>("GET", "/categories"),
  expenses: (q: { from?: string; to?: string; categoryId?: number }) => {
    const params = new URLSearchParams();
    if (q.from) params.set("from", q.from);
    if (q.to) params.set("to", q.to);
    if (q.categoryId) params.set("categoryId", String(q.categoryId));
    return request<Expense[]>("GET", `/expenses?${params}`);
  },
  createExpense: (b: ExpenseBody) => request<Expense>("POST", "/expenses", b),
  updateExpense: (id: number, b: ExpenseBody) => request<Expense>("PUT", `/expenses/${id}`, b),
  deleteExpense: (id: number) => request<void>("DELETE", `/expenses/${id}`),
  summary: (month: string) => request<Summary>("GET", `/summary?month=${month}`),
};
