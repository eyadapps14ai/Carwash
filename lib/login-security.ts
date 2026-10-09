import { db } from "./db";
import { tokenHash } from "./auth";
export async function allowLogin(
  email: string,
  client: string,
  now = new Date(),
) {
  const buckets = [
    { key: tokenHash("client:" + client), limit: 300 },
    { key: tokenHash(email), limit: 10 },
  ].sort((a, b) => a.key.localeCompare(b.key));
  return db.$transaction(async (tx) => {
    for (const b of buckets) {
      await tx.loginAttempt.upsert({
        where: { key: b.key },
        create: {
          key: b.key,
          count: 0,
          resetAt: new Date(now.getTime() + 900000),
        },
        update: {},
      });
      await tx.$queryRaw`SELECT key FROM "LoginAttempt" WHERE key=${b.key} FOR UPDATE`;
    }
    for (const b of buckets) {
      const row = await tx.loginAttempt.findUniqueOrThrow({
        where: { key: b.key },
      });
      if (row.resetAt > now && row.count >= b.limit) return false;
    }
    for (const b of buckets) {
      const row = await tx.loginAttempt.findUniqueOrThrow({
        where: { key: b.key },
      });
      await tx.loginAttempt.update({
        where: { key: b.key },
        data:
          row.resetAt <= now
            ? { count: 1, resetAt: new Date(now.getTime() + 900000) }
            : { count: { increment: 1 } },
      });
    }
    return true;
  });
}
export function loginClient(req: Request) {
  if (process.env.TRUST_PROXY !== "true") return "shared";
  const value = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return value && /^[a-fA-F0-9:.]{3,64}$/.test(value) ? value : "shared";
}
