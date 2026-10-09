import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { db } from "../lib/db";
import { saveBackup, loadBackup, restoreEmpty, capture } from "../lib/backup";
async function main() {
  const schema = "recovery_" + randomBytes(6).toString("hex"),
    path = `.local/${schema}.backup`,
    key = randomBytes(32),
    target = new URL(process.env.DATABASE_URL!);
  target.searchParams.set("schema", schema);
  const restored = new PrismaClient({ datasourceUrl: target.toString() }),
    started = performance.now();
  await mkdir(".local", { recursive: true });
  try {
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const folder of (await readdir("prisma/migrations"))
      .filter((n) => /^\d/.test(n))
      .sort()) {
      const sql = await readFile(
        `prisma/migrations/${folder}/migration.sql`,
        "utf8",
      );
      await restored.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          for (const statement of sql
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean))
            await tx.$executeRawUnsafe(statement);
        },
        { timeout: 120000 },
      );
    }
    const backup = await saveBackup(db, path, key),
      snapshot = await loadBackup(path, key),
      fingerprint = await restoreEmpty(restored, snapshot, schema);
    if (fingerprint !== backup.fingerprint) throw new Error("Mismatch");
    let refused = false;
    try {
      await restoreEmpty(restored, snapshot, schema);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error("Nonempty target was not rejected");
    if (await restored.session.count())
      throw new Error("Restored sessions still active");
    if ((await restored.marketingConfig.findFirst())?.deliveryEnabled)
      throw new Error("Restored delivery enabled");
    const report = {
      status: "passed",
      rows: backup.rows,
      models: Object.keys(snapshot.tables).length,
      fingerprint,
      restoreAndVerificationSeconds: Number(
        ((performance.now() - started) / 1000).toFixed(2),
      ),
      encrypted: true,
      sessionsRevoked: true,
      deliveryDisabled: true,
      nonemptyRestoreRejected: true,
      scope:
        "Isolated schema in local PostgreSQL; not production host/PITR recovery",
    };
    await writeFile(
      ".local/phase6-restore.json",
      JSON.stringify(report, null, 2),
    );
    console.log(report);
  } finally {
    await restored.$disconnect();
    await db.$executeRawUnsafe("SET search_path TO public");
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await unlink(path).catch(() => {});
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Recovery drill failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
