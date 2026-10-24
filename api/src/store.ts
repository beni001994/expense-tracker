import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Loaded via require because Vite's module runner strips the `node:` prefix from `node:sqlite`.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export interface User {
  id: number;
  email: string;
  passwordHash: string;
}
export interface PublicUser {
  id: number;
  email: string;
}
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
export interface ExpenseInput {
  amountCents: number;
  description: string;
  date: string;
  categoryId: number;
}
export interface ExpenseFilter {
  from?: string;
  to?: string;
  categoryId?: number;
}
export interface CategoryTotal {
  categoryId: number;
  name: string;
  totalCents: number;
  count: number;
}

export const DEFAULT_CATEGORIES = ["Food", "Transport", "Housing", "Entertainment", "Other"];

const EXPENSE_SELECT = `
  SELECT e.id, e.amount_cents AS amountCents, e.description, e.date,
         e.category_id AS categoryId, c.name AS categoryName
  FROM expenses e JOIN categories c ON c.id = e.category_id`;

const isUniqueViolation = (err: unknown) => err instanceof Error && /UNIQUE/i.test(err.message);

export class Store {
  private db: DatabaseSyncType;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL COLLATE NOCASE,
        UNIQUE (user_id, name)
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        category_id INTEGER NOT NULL REFERENCES categories(id),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        description TEXT NOT NULL,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date);
    `);
  }

  /** Creates a user and seeds default categories. Returns null if the email is taken. */
  createUser(email: string, passwordHash: string): PublicUser | null {
    try {
      const res = this.db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, passwordHash);
      const id = Number(res.lastInsertRowid);
      for (const name of DEFAULT_CATEGORIES) this.createCategory(id, name);
      return { id, email };
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  findUserByEmail(email: string): User | undefined {
    return this.db
      .prepare("SELECT id, email, password_hash AS passwordHash FROM users WHERE email = ?")
      .get(email) as unknown as User | undefined;
  }

  getUser(id: number): PublicUser | undefined {
    return this.db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as unknown as PublicUser | undefined;
  }

  listCategories(userId: number): Category[] {
    return this.db
      .prepare("SELECT id, name FROM categories WHERE user_id = ? ORDER BY name")
      .all(userId) as unknown as Category[];
  }

  getCategory(userId: number, id: number): Category | undefined {
    return this.db
      .prepare("SELECT id, name FROM categories WHERE user_id = ? AND id = ?")
      .get(userId, id) as unknown as Category | undefined;
  }

  /** Returns null if the user already has a category with this name (case-insensitive). */
  createCategory(userId: number, name: string): Category | null {
    try {
      const res = this.db.prepare("INSERT INTO categories (user_id, name) VALUES (?, ?)").run(userId, name);
      return { id: Number(res.lastInsertRowid), name };
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  categoryInUse(userId: number, id: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM expenses WHERE user_id = ? AND category_id = ? LIMIT 1").get(userId, id);
  }

  deleteCategory(userId: number, id: number): boolean {
    return Number(this.db.prepare("DELETE FROM categories WHERE user_id = ? AND id = ?").run(userId, id).changes) > 0;
  }

  listExpenses(userId: number, f: ExpenseFilter = {}): Expense[] {
    const where = ["e.user_id = ?"];
    const params: (string | number)[] = [userId];
    if (f.from) {
      where.push("e.date >= ?");
      params.push(f.from);
    }
    if (f.to) {
      where.push("e.date <= ?");
      params.push(f.to);
    }
    if (f.categoryId !== undefined) {
      where.push("e.category_id = ?");
      params.push(f.categoryId);
    }
    return this.db
      .prepare(`${EXPENSE_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.date DESC, e.id DESC`)
      .all(...params) as unknown as Expense[];
  }

  getExpense(userId: number, id: number): Expense | undefined {
    return this.db.prepare(`${EXPENSE_SELECT} WHERE e.user_id = ? AND e.id = ?`).get(userId, id) as unknown as
      | Expense
      | undefined;
  }

  createExpense(userId: number, input: ExpenseInput): Expense {
    const res = this.db
      .prepare("INSERT INTO expenses (user_id, category_id, amount_cents, description, date) VALUES (?, ?, ?, ?, ?)")
      .run(userId, input.categoryId, input.amountCents, input.description, input.date);
    return this.getExpense(userId, Number(res.lastInsertRowid))!;
  }

  updateExpense(userId: number, id: number, input: ExpenseInput): Expense | undefined {
    const res = this.db
      .prepare(
        "UPDATE expenses SET category_id = ?, amount_cents = ?, description = ?, date = ? WHERE user_id = ? AND id = ?",
      )
      .run(input.categoryId, input.amountCents, input.description, input.date, userId, id);
    return Number(res.changes) > 0 ? this.getExpense(userId, id) : undefined;
  }

  deleteExpense(userId: number, id: number): boolean {
    return Number(this.db.prepare("DELETE FROM expenses WHERE user_id = ? AND id = ?").run(userId, id).changes) > 0;
  }

  /** Totals per category for dates in [from, to] (inclusive), largest first. */
  totalsByCategory(userId: number, from: string, to: string): CategoryTotal[] {
    return this.db
      .prepare(
        `SELECT c.id AS categoryId, c.name, SUM(e.amount_cents) AS totalCents, COUNT(*) AS count
         FROM expenses e JOIN categories c ON c.id = e.category_id
         WHERE e.user_id = ? AND e.date >= ? AND e.date <= ?
         GROUP BY c.id ORDER BY totalCents DESC, c.name`,
      )
      .all(userId, from, to) as unknown as CategoryTotal[];
  }
}
