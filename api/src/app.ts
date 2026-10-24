import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { createToken, hashPassword, verifyPassword, verifyToken } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { Store } from "./store.js";

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").refine(isRealDate, "Not a real date");
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");
const idSchema = z.coerce.number().int().positive();

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
});
const categorySchema = z.object({ name: z.string().trim().min(1).max(50) });
const expenseSchema = z.object({
  amountCents: z.number().int().positive().max(1_000_000_000),
  description: z.string().trim().min(1).max(200),
  date: dateSchema,
  categoryId: z.number().int().positive(),
});
const filterSchema = z
  .object({ from: dateSchema.optional(), to: dateSchema.optional(), categoryId: idSchema.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must not be after `to`" });

export function createApp(store = new Store(), config: Config = loadConfig()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // Burns equivalent scrypt time when the email is unknown, to reduce user enumeration by timing.
  const dummyHash = hashPassword("not-a-real-password");

  // Express 4 does not catch rejected promises from async handlers; forward them to the error middleware.
  const ah =
    (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
      void fn(req, res).catch(next);

  const uid = (res: Response) => res.locals.userId as number;
  const issue = (userId: number) => createToken(userId, config.secret, config.tokenTtlSeconds);

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
    const userId = match ? verifyToken(match[1]!, config.secret) : null;
    if (userId === null || !store.getUser(userId)) {
      throw new HttpError(401, "unauthorized", "Missing, invalid or expired token");
    }
    res.locals.userId = userId;
    next();
  };

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/auth/register", ah(async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const user = store.createUser(email, await hashPassword(password));
    if (!user) throw new HttpError(409, "email_taken", "An account with this email already exists");
    res.status(201).json({ token: issue(user.id), user });
  }));

  app.post("/api/auth/login", ah(async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body);
    const user = store.findUserByEmail(email);
    const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
    if (!user || !ok) throw new HttpError(401, "invalid_credentials", "Invalid email or password");
    res.json({ token: issue(user.id), user: { id: user.id, email: user.email } });
  }));

  app.get("/api/auth/me", requireAuth, (_req, res) => {
    res.json(store.getUser(uid(res)));
  });

  app.get("/api/categories", requireAuth, (_req, res) => {
    res.json(store.listCategories(uid(res)));
  });

  app.post("/api/categories", requireAuth, (req, res) => {
    const { name } = categorySchema.parse(req.body);
    const category = store.createCategory(uid(res), name);
    if (!category) throw new HttpError(409, "category_exists", "Category already exists");
    res.status(201).json(category);
  });

  app.delete("/api/categories/:id", requireAuth, (req, res) => {
    const id = idSchema.parse(req.params.id);
    if (!store.getCategory(uid(res), id)) throw new HttpError(404, "not_found", "Category not found");
    if (store.categoryInUse(uid(res), id)) {
      throw new HttpError(409, "category_in_use", "Category has expenses; reassign or delete them first");
    }
    store.deleteCategory(uid(res), id);
    res.status(204).end();
  });

  const checkCategory = (userId: number, categoryId: number) => {
    if (!store.getCategory(userId, categoryId)) {
      throw new HttpError(400, "invalid_category", "Unknown category");
    }
  };

  app.get("/api/expenses", requireAuth, (req, res) => {
    res.json(store.listExpenses(uid(res), filterSchema.parse(req.query)));
  });

  app.get("/api/expenses/:id", requireAuth, (req, res) => {
    const expense = store.getExpense(uid(res), idSchema.parse(req.params.id));
    if (!expense) throw new HttpError(404, "not_found", "Expense not found");
    res.json(expense);
  });

  app.post("/api/expenses", requireAuth, (req, res) => {
    const input = expenseSchema.parse(req.body);
    checkCategory(uid(res), input.categoryId);
    res.status(201).json(store.createExpense(uid(res), input));
  });

  app.put("/api/expenses/:id", requireAuth, (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = expenseSchema.parse(req.body);
    checkCategory(uid(res), input.categoryId);
    const expense = store.updateExpense(uid(res), id, input);
    if (!expense) throw new HttpError(404, "not_found", "Expense not found");
    res.json(expense);
  });

  app.delete("/api/expenses/:id", requireAuth, (req, res) => {
    if (!store.deleteExpense(uid(res), idSchema.parse(req.params.id))) {
      throw new HttpError(404, "not_found", "Expense not found");
    }
    res.status(204).end();
  });

  app.get("/api/summary", requireAuth, (req, res) => {
    const { month } = z.object({ month: monthSchema }).parse(req.query);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const categories = store.totalsByCategory(uid(res), `${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
    const totalCents = categories.reduce((sum, c) => sum + c.totalCents, 0);
    res.json({ month, totalCents, categories });
  });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not_found", "Route not found")));

  // Consistent error shape: { error: { code, message, details? } }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof z.ZodError) {
      return void res
        .status(400)
        .json({ error: { code: "validation_error", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof SyntaxError) {
      return void res.status(400).json({ error: { code: "malformed_json", message: "Malformed JSON" } });
    }
    if ((err as { status?: number }).status === 413) {
      return void res.status(413).json({ error: { code: "payload_too_large", message: "Request body too large" } });
    }
    console.error(err);
    res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
  });

  return app;
}
