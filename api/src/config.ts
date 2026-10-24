const DEV_SECRET = "dev-only-insecure-secret-do-not-use-in-production";

export interface Config {
  secret: string;
  port: number;
  dbPath: string;
  tokenTtlSeconds: number;
}

/** Reads configuration from the environment. The dev default secret is only allowed outside production. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  let secret = env.SESSION_SECRET;
  if (!secret) {
    if (production) throw new Error("SESSION_SECRET must be set when NODE_ENV=production");
    secret = DEV_SECRET;
  }
  if (production && secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
  }
  return {
    secret,
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? "expenses.db",
    tokenTtlSeconds: 60 * 60 * 12,
  };
}
