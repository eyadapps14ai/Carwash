import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { hashPassword, tokenHash } from "../lib/auth";
import { allowLogin } from "../lib/login-security";
import { D, round } from "../lib/finance";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.APP_ORIGIN!;
async function main() {
  const suffix = randomUUID(),
    email = `p6-${suffix}@example.test`,
    password = randomUUID() + randomUUID();
  let userId = "";
  try {
    const attempts = await Promise.all(
      Array.from({ length: 25 }, () => allowLogin(email, "p6-" + suffix)),
    );
    assert.equal(attempts.filter(Boolean).length, 10);
    assert.equal(
      (
        await db.loginAttempt.findUniqueOrThrow({
          where: { key: tokenHash(email) },
        })
      ).count,
      10,
    );
    const [branch] = await db.branch.findMany({ take: 1 });
    const user = await db.user.create({
      data: {
        name: "Phase 6 security fixture",
        email,
        role: "CASHIER",
        passwordHash: hashPassword(password),
        branches: { create: { branchId: branch.id } },
      },
    });
    userId = user.id;
    const routes = [
      "/api/finance",
      "/api/crm",
      "/api/operations",
      "/api/marketing",
      "/api/export",
    ];
    for (const path of routes)
      assert.equal((await fetch(origin + path)).status, 401, path);
    assert.equal(
      (
        await fetch(origin + "/api/action", {
          method: "POST",
          headers: {
            origin: "https://evil.example.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/login", {
          method: "POST",
          headers: {
            origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "password=" + "x".repeat(9000),
        })
      ).status,
      413,
    );
    await db.loginAttempt.deleteMany({ where: { key: tokenHash(email) } });
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }),
      redirect: "manual",
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
    assert.match(cookie, /Secure/i);
    const sessionCookie = cookie.split(";")[0];
    assert.equal(
      (
        await fetch(origin + "/api/action", {
          method: "POST",
          headers: {
            origin,
            cookie: sessionCookie,
            "Content-Type": "application/json",
          },
          body: '{"action":"settings","data":{}}',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(origin + "/api/action", {
          method: "POST",
          headers: {
            origin,
            cookie: sessionCookie,
            "Content-Type": "application/json",
          },
          body: '{"x":"' + "x".repeat(270000) + '"}',
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(origin + "/api/action", {
          method: "POST",
          headers: {
            origin,
            cookie: sessionCookie,
            "Content-Type": "application/json",
          },
          body: "{",
        })
      ).status,
      400,
    );
    const dashboard = await fetch(origin, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.headers.get("content-security-policy")!, /nonce-/);
    assert.match(dashboard.headers.get("cache-control")!, /no-store/);
    assert.equal(dashboard.headers.get("x-frame-options"), "DENY");
    const html = await dashboard.text();
    assert.ok(!html.includes(user.passwordHash));
    assert.ok(!html.includes(process.env.DATABASE_URL!));
    await db.user.update({ where: { id: userId }, data: { active: false } });
    assert.equal(
      (
        await fetch(origin + "/api/marketing", {
          headers: { cookie: sessionCookie },
        })
      ).status,
      401,
    );
    await db.user.update({ where: { id: userId }, data: { active: true } });
    const token = sessionCookie.split("=")[1];
    await db.session.update({
      where: { tokenHash: tokenHash(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(
      (
        await fetch(origin + "/api/marketing", {
          headers: { cookie: sessionCookie },
        })
      ).status,
      401,
    );
    const sales = await db.sale.findMany({
      include: { payments: true, lines: true },
    });
    for (const s of sales) {
      assert.equal(
        D(s.subtotal.toString()).minus(s.discount.toString()).toFixed(2),
        s.net.toFixed(2),
      );
      assert.equal(
        round(D(s.net.toString()).mul(s.vatRate.toString()).div(100)).toFixed(
          2,
        ),
        s.vat.toFixed(2),
      );
      assert.equal(
        D(s.net.toString()).plus(s.vat.toString()).toFixed(2),
        s.total.toFixed(2),
      );
      assert.ok(
        s.payments
          .reduce((n, p) => n.plus(p.amount.toString()), D(0))
          .lte(s.total.toString()),
      );
    }
    await mkdir(".local", { recursive: true });
    const result = {
      status: "passed",
      atomicLoginAttemptsAllowed: 10,
      concurrentAttempts: 25,
      salesChecked: sales.length,
      checks: [
        "anonymous routes",
        "CSRF",
        "bounded bodies",
        "invalid JSON",
        "secure cookies",
        "CSP",
        "cache privacy",
        "hash/credential exclusion",
        "inactive/expired sessions",
        "ledger arithmetic and no overpayment",
      ],
    };
    await writeFile(
      ".local/phase6-security.json",
      JSON.stringify(result, null, 2),
    );
    console.log(result);
  } finally {
    await db.session.deleteMany({ where: { userId } });
    await db.assignment.deleteMany({ where: { userId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.loginAttempt.deleteMany({
      where: {
        key: { in: [tokenHash(email), tokenHash("client:p6-" + suffix)] },
      },
    });
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
