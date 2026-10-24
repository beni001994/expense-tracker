import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `salt:hash`, both hex encoded. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await derive(password, Buffer.from(saltHex, "hex"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Token format: base64url(JSON{sub,exp}).base64url(HMAC-SHA256). */
export function createToken(userId: number, secret: string, ttlSeconds: number, now = Date.now()): string {
  const payload = JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + ttlSeconds });
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the user id, or null if the token is malformed, tampered with or expired. */
export function verifyToken(token: string, secret: string, now = Date.now()): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(now / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
