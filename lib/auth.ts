import {
  randomBytes,
  scryptSync,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
export function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function verifyPassword(value: string, hash: string) {
  const [salt, h] = hash.split(":");
  if (!salt || !h) return false;
  const actual = scryptSync(value, salt, 64),
    expected = Buffer.from(h, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function currentUser() {
  const token = (await cookies()).get("protune_session")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          active: true,
          branches: true,
        },
      },
    },
  });
  return session && session.expiresAt > new Date() && session.user.active
    ? session.user
    : null;
}
export function canBranch(
  user: { role: string; branches: { branchId: string }[] },
  branchId: string,
) {
  return (
    user.role === "OWNER" || user.branches.some((b) => b.branchId === branchId)
  );
}
export function assertAccess(
  user: { role: string; branches: { branchId: string }[] },
  roles: string[],
  branchId?: string,
) {
  if (!roles.includes(user.role) || (branchId && !canBranch(user, branchId)))
    throw new Error("Access denied");
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return origin === process.env.APP_ORIGIN;
}

export async function verifyPasswordAsync(value: string, hash: string) {
  const [salt, h] = hash.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(h ?? ""))
    return false;
  const expected = Buffer.from(h, "hex"),
    actual = await new Promise<Buffer>((resolve, reject) =>
      scrypt(value, salt, 64, (error, key) =>
        error ? reject(error) : resolve(key),
      ),
    );
  return timingSafeEqual(actual, expected);
}
