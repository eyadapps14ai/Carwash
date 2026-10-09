import { dubaiDate } from "../lib/finance";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin = process.env.APP_ORIGIN!;
async function main() {
  const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: process.env.SEED_OWNER_EMAIL!,
        password: process.env.SEED_OWNER_PASSWORD!,
      }),
      redirect: "manual",
    }),
    cookie = login.headers.get("set-cookie")!.split(";")[0],
    paths = [
      "/",
      `/api/finance?start=${dubaiDate().slice(0, 7)}-01&end=${dubaiDate()}`,
      "/api/operations",
      "/api/crm",
      "/api/marketing",
    ],
    times: { path: string; ms: number; bytes: number }[] = [];
  for (const path of paths) {
    await fetch(origin + path, { headers: { cookie } });
    const batches = Array.from({ length: 20 }, () => path);
    for (let i = 0; i < batches.length; i += 4)
      await Promise.all(
        batches.slice(i, i + 4).map(async (path) => {
          const start = performance.now(),
            r = await fetch(origin + path, { headers: { cookie } }),
            bytes = (await r.arrayBuffer()).byteLength;
          assert.equal(r.status, 200, path);
          times.push({ path, ms: performance.now() - start, bytes });
        }),
      );
  }
  const result = {
    scope:
      "Local sample workspace, 100 authenticated reads, concurrency 4; not production capacity certification",
    results: paths.map((path) => {
      const rows = times.filter((t) => t.path === path),
        sorted = rows.map((t) => t.ms).sort((a, b) => a - b);
      return {
        path,
        p50ms: Math.round(sorted[9]),
        p95ms: Math.round(sorted[18]),
        maxBytes: Math.max(...rows.map((r) => r.bytes)),
      };
    }),
  };
  await writeFile(".local/phase6-load.json", JSON.stringify(result, null, 2));
  console.log(result);
  for (const r of result.results)
    assert.ok(
      r.p95ms < 5000,
      `${r.path} exceeds local 5s responsiveness budget`,
    );
  await fetch(origin + "/api/logout", {
    method: "POST",
    headers: { origin, cookie },
    redirect: "manual",
  });
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
