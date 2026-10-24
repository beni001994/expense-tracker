import request from "supertest";
import { describe, expect, it } from "vitest";
import { addExpense, bearer, categoryId, makeApp, register } from "./helpers.js";

describe("GET /api/summary", () => {
  it("totals per category for the month, largest first", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const transport = await categoryId(app, token, "Transport");
    await addExpense(app, token, { amountCents: 1000, date: "2026-03-01" });
    await addExpense(app, token, { amountCents: 2550, date: "2026-03-31" });
    await addExpense(app, token, { amountCents: 4000, date: "2026-03-15", categoryId: transport });

    const res = await request(app).get("/api/summary?month=2026-03").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.month).toBe("2026-03");
    expect(res.body.totalCents).toBe(7550);
    expect(res.body.categories).toEqual([
      { categoryId: transport, name: "Transport", totalCents: 4000, count: 1 },
      { categoryId: await categoryId(app, token, "Food"), name: "Food", totalCents: 3550, count: 2 },
    ]);
  });

  it("excludes neighbouring months (month boundaries, leap February)", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    await addExpense(app, token, { amountCents: 100, date: "2028-01-31" });
    await addExpense(app, token, { amountCents: 200, date: "2028-02-01" });
    await addExpense(app, token, { amountCents: 400, date: "2028-02-29" });
    await addExpense(app, token, { amountCents: 800, date: "2028-03-01" });
    const res = await request(app).get("/api/summary?month=2028-02").set(bearer(token));
    expect(res.body.totalCents).toBe(600);
  });

  it("returns an empty summary for a month with no expenses", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const res = await request(app).get("/api/summary?month=2026-07").set(bearer(token));
    expect(res.body).toEqual({ month: "2026-07", totalCents: 0, categories: [] });
  });

  it("reflects edits and deletes", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const a = await addExpense(app, token, { amountCents: 500 });
    await addExpense(app, token, { amountCents: 700 });
    await request(app).delete(`/api/expenses/${a.body.id}`).set(bearer(token));
    const res = await request(app).get("/api/summary?month=2026-03").set(bearer(token));
    expect(res.body.totalCents).toBe(700);
  });

  it("validates the month parameter", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    for (const q of ["", "?month=2026-13", "?month=2026-3", "?month=March"]) {
      const res = await request(app).get(`/api/summary${q}`).set(bearer(token));
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
    }
  });
});
