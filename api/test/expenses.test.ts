import request from "supertest";
import { describe, expect, it } from "vitest";
import { addExpense, bearer, categoryId, makeApp, register } from "./helpers.js";

describe("expenses CRUD", () => {
  it("creates, reads, updates and deletes an expense", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const created = await addExpense(app, token, { amountCents: 1250, description: "  Coffee  " });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ amountCents: 1250, description: "Coffee", categoryName: "Food" });

    const id = created.body.id;
    const transport = await categoryId(app, token, "Transport");
    const updated = await request(app)
      .put(`/api/expenses/${id}`)
      .set(bearer(token))
      .send({ amountCents: 300, description: "Bus", date: "2026-03-11", categoryId: transport });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ amountCents: 300, categoryName: "Transport", date: "2026-03-11" });

    expect((await request(app).get(`/api/expenses/${id}`).set(bearer(token))).body.description).toBe("Bus");
    expect((await request(app).delete(`/api/expenses/${id}`).set(bearer(token))).status).toBe(204);
    expect((await request(app).get(`/api/expenses/${id}`).set(bearer(token))).status).toBe(404);
  });

  it("returns 404 when updating or deleting a missing expense", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const body = { amountCents: 1, description: "x", date: "2026-03-01", categoryId: await categoryId(app, token, "Food") };
    expect((await request(app).put("/api/expenses/999").set(bearer(token)).send(body)).status).toBe(404);
    expect((await request(app).delete("/api/expenses/999").set(bearer(token))).status).toBe(404);
  });
});

describe("validation", () => {
  it.each([
    ["zero amount", { amountCents: 0 }],
    ["negative amount", { amountCents: -5 }],
    ["fractional amount", { amountCents: 10.5 }],
    ["string amount", { amountCents: "10" }],
    ["empty description", { description: "   " }],
    ["bad date format", { date: "10/03/2026" }],
    ["impossible date", { date: "2026-02-30" }],
    ["missing category", { categoryId: undefined }],
  ])("rejects %s", async (_name, override) => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const res = await addExpense(app, token, override as never);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("rejects an unknown category", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const res = await addExpense(app, token, { categoryId: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_category");
  });

  it("rejects a non-numeric id", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    expect((await request(app).get("/api/expenses/abc").set(bearer(token))).status).toBe(400);
  });
});

describe("user isolation", () => {
  it("never shows one user's expenses to another", async () => {
    const app = makeApp();
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const secret = await addExpense(app, alice.token, { description: "Alice private" });

    expect((await request(app).get("/api/expenses").set(bearer(bob.token))).body).toEqual([]);
    expect((await request(app).get(`/api/expenses/${secret.body.id}`).set(bearer(bob.token))).status).toBe(404);
    const bobFood = await categoryId(app, bob.token, "Food");
    const put = await request(app)
      .put(`/api/expenses/${secret.body.id}`)
      .set(bearer(bob.token))
      .send({ amountCents: 1, description: "hijack", date: "2026-03-01", categoryId: bobFood });
    expect(put.status).toBe(404);
    expect((await request(app).delete(`/api/expenses/${secret.body.id}`).set(bearer(bob.token))).status).toBe(404);

    const still = await request(app).get(`/api/expenses/${secret.body.id}`).set(bearer(alice.token));
    expect(still.body.description).toBe("Alice private");
  });

  it("does not let a user attach an expense to another user's category", async () => {
    const app = makeApp();
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const aliceFood = await categoryId(app, alice.token, "Food");
    const res = await addExpense(app, bob.token, { categoryId: aliceFood });
    expect(res.status).toBe(400);
  });

  it("keeps summaries separate per user", async () => {
    const app = makeApp();
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    await addExpense(app, alice.token, { amountCents: 5000 });
    const res = await request(app).get("/api/summary?month=2026-03").set(bearer(bob.token));
    expect(res.body).toEqual({ month: "2026-03", totalCents: 0, categories: [] });
  });
});

describe("filtering", () => {
  async function seeded() {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const transport = await categoryId(app, token, "Transport");
    await addExpense(app, token, { description: "a", date: "2026-02-28" });
    await addExpense(app, token, { description: "b", date: "2026-03-01" });
    await addExpense(app, token, { description: "c", date: "2026-03-15", categoryId: transport });
    await addExpense(app, token, { description: "d", date: "2026-04-01" });
    return { app, token, transport };
  }
  const names = (res: request.Response) => (res.body as { description: string }[]).map((e) => e.description);

  it("lists newest first", async () => {
    const { app, token } = await seeded();
    expect(names(await request(app).get("/api/expenses").set(bearer(token)))).toEqual(["d", "c", "b", "a"]);
  });

  it("filters by an inclusive date range", async () => {
    const { app, token } = await seeded();
    const res = await request(app).get("/api/expenses?from=2026-03-01&to=2026-03-31").set(bearer(token));
    expect(names(res)).toEqual(["c", "b"]);
    expect(names(await request(app).get("/api/expenses?from=2026-03-15").set(bearer(token)))).toEqual(["d", "c"]);
    expect(names(await request(app).get("/api/expenses?to=2026-02-28").set(bearer(token)))).toEqual(["a"]);
  });

  it("filters by category and combines filters", async () => {
    const { app, token, transport } = await seeded();
    expect(names(await request(app).get(`/api/expenses?categoryId=${transport}`).set(bearer(token)))).toEqual(["c"]);
    const none = await request(app).get(`/api/expenses?categoryId=${transport}&to=2026-03-01`).set(bearer(token));
    expect(none.body).toEqual([]);
  });

  it("rejects bad or inverted ranges", async () => {
    const { app, token } = await seeded();
    expect((await request(app).get("/api/expenses?from=nope").set(bearer(token))).status).toBe(400);
    expect((await request(app).get("/api/expenses?from=2026-04-01&to=2026-03-01").set(bearer(token))).status).toBe(400);
  });
});

describe("categories", () => {
  it("seeds defaults and lets users add their own", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const list = await request(app).get("/api/categories").set(bearer(token));
    expect(list.body.map((c: { name: string }) => c.name)).toEqual(["Entertainment", "Food", "Housing", "Other", "Transport"]);

    const created = await request(app).post("/api/categories").set(bearer(token)).send({ name: "Health" });
    expect(created.status).toBe(201);
    const dup = await request(app).post("/api/categories").set(bearer(token)).send({ name: "health" });
    expect(dup.status).toBe(409);
  });

  it("blocks deleting a category that has expenses", async () => {
    const app = makeApp();
    const { token } = await register(app, "a@example.com");
    const food = await categoryId(app, token, "Food");
    await addExpense(app, token);
    const blocked = await request(app).delete(`/api/categories/${food}`).set(bearer(token));
    expect(blocked.status).toBe(409);
    const housing = await categoryId(app, token, "Housing");
    expect((await request(app).delete(`/api/categories/${housing}`).set(bearer(token))).status).toBe(204);
  });

  it("does not let users delete someone else's category", async () => {
    const app = makeApp();
    const alice = await register(app, "alice@example.com");
    const bob = await register(app, "bob@example.com");
    const aliceFood = await categoryId(app, alice.token, "Food");
    expect((await request(app).delete(`/api/categories/${aliceFood}`).set(bearer(bob.token))).status).toBe(404);
  });
});
