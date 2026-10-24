import request from "supertest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { Store } from "../src/store.js";

export const testConfig: Config = {
  secret: "test-secret-test-secret-test-secret-123",
  port: 0,
  dbPath: ":memory:",
  tokenTtlSeconds: 3600,
};

export function makeApp() {
  return createApp(new Store(), testConfig);
}

export type App = ReturnType<typeof makeApp>;

export async function register(app: App, email: string, password = "correct-horse-battery") {
  const res = await request(app).post("/api/auth/register").send({ email, password });
  return { token: res.body.token as string, userId: res.body.user?.id as number, res };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function categoryId(app: App, token: string, name: string): Promise<number> {
  const res = await request(app).get("/api/categories").set(bearer(token));
  return (res.body as { id: number; name: string }[]).find((c) => c.name === name)!.id;
}

export async function addExpense(
  app: App,
  token: string,
  over: Partial<{ amountCents: number; description: string; date: string; categoryId: number }> = {},
) {
  const body = {
    amountCents: 1000,
    description: "Lunch",
    date: "2026-03-10",
    categoryId: over.categoryId ?? (await categoryId(app, token, "Food")),
    ...over,
  };
  return request(app).post("/api/expenses").set(bearer(token)).send(body);
}
