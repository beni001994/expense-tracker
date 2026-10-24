import request from "supertest";
import { describe, expect, it } from "vitest";
import { createToken, hashPassword, verifyPassword, verifyToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { bearer, makeApp, register, testConfig } from "./helpers.js";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash).not.toContain("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    expect(await verifyPassword("wrong-pass", hash)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    expect(await hashPassword("same-password")).not.toBe(await hashPassword("same-password"));
  });
});

describe("tokens", () => {
  const secret = "unit-test-secret";

  it("round-trips a user id", () => {
    expect(verifyToken(createToken(42, secret, 60), secret)).toBe(42);
  });

  it("rejects expired tokens", () => {
    const token = createToken(1, secret, 60, 1_000_000);
    expect(verifyToken(token, secret, 1_000_000 + 59_000)).toBe(1);
    expect(verifyToken(token, secret, 1_000_000 + 61_000)).toBeNull();
  });

  it("rejects a wrong secret, tampered payloads and garbage", () => {
    const token = createToken(1, secret, 60);
    expect(verifyToken(token, "other-secret")).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: 2, exp: 9_999_999_999 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyToken("garbage", secret)).toBeNull();
    expect(verifyToken("a.b.c", secret)).toBeNull();
  });
});

describe("config", () => {
  it("allows the dev default secret outside production", () => {
    expect(loadConfig({ NODE_ENV: "development" }).secret).toBeTruthy();
  });

  it("refuses to start in production without a strong secret", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow(/32/);
    expect(loadConfig({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(40) }).secret).toHaveLength(40);
  });
});

describe("auth endpoints", () => {
  it("registers, logs in and returns the current user", async () => {
    const app = makeApp();
    const reg = await register(app, "Ada@Example.com");
    expect(reg.res.status).toBe(201);
    expect(reg.res.body.user.email).toBe("ada@example.com");
    expect(JSON.stringify(reg.res.body)).not.toMatch(/hash|password/i);

    const login = await request(app).post("/api/auth/login").send({ email: "ada@example.com", password: "correct-horse-battery" });
    expect(login.status).toBe(200);
    const me = await request(app).get("/api/auth/me").set(bearer(login.body.token));
    expect(me.body.email).toBe("ada@example.com");
  });

  it("rejects duplicate emails with 409", async () => {
    const app = makeApp();
    await register(app, "a@example.com");
    const again = await register(app, "A@example.com");
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.code).toBe("email_taken");
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const app = makeApp();
    await register(app, "a@example.com");
    const wrongPw = await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "not-the-password" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "nobody@example.com", password: "not-the-password" });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrongPw.body);
  });

  it("validates credentials", async () => {
    const app = makeApp();
    const badEmail = await request(app).post("/api/auth/register").send({ email: "nope", password: "long-enough-pw" });
    const shortPw = await request(app).post("/api/auth/register").send({ email: "a@example.com", password: "short" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.code).toBe("validation_error");
    expect(shortPw.status).toBe(400);
  });

  it("requires a valid token on protected routes", async () => {
    const app = makeApp();
    for (const path of ["/api/auth/me", "/api/expenses", "/api/categories", "/api/summary?month=2026-03"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    }
    const bad = await request(app).get("/api/expenses").set(bearer("not.a-token"));
    expect(bad.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const app = makeApp();
    const { userId } = await register(app, "a@example.com");
    const expired = createToken(userId, testConfig.secret, 60, Date.now() - 3_600_000);
    const res = await request(app).get("/api/auth/me").set(bearer(expired));
    expect(res.status).toBe(401);
  });

  it("rejects tokens signed with a different secret", async () => {
    const app = makeApp();
    const { userId } = await register(app, "a@example.com");
    const res = await request(app).get("/api/auth/me").set(bearer(createToken(userId, "other-secret", 60)));
    expect(res.status).toBe(401);
  });

  it("returns consistent JSON errors for malformed bodies and unknown routes", async () => {
    const app = makeApp();
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("malformed_json");
    const missing = await request(app).get("/api/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });
});
