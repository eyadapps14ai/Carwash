import { PrismaClient } from "@prisma/client";
import { saveBackup, loadBackup, restoreEmpty } from "../lib/backup";
async function main() {
  const mode = process.argv[2],
    path = process.argv[3],
    key = Buffer.from(process.env.BACKUP_KEY ?? "", "base64");
  if (!path || key.length !== 32)
    throw new Error("Specify a backup path and a base64 32-byte BACKUP_KEY");
  if (mode === "create") {
    const db = new PrismaClient();
    try {
      console.log(await saveBackup(db, path, key));
    } finally {
      await db.$disconnect();
    }
  } else if (mode === "restore") {
    const target = process.env.RESTORE_DATABASE_URL;
    if (
      !target ||
      target === process.env.DATABASE_URL ||
      process.env.RESTORE_CONFIRM !== "EMPTY_ISOLATED_DATABASE"
    )
      throw new Error(
        "Restore requires a distinct target and explicit EMPTY_ISOLATED_DATABASE guard",
      );
    const db = new PrismaClient({ datasourceUrl: target });
    try {
      console.log({
        fingerprint: await restoreEmpty(
          db,
          await loadBackup(path, key),
          new URL(target).searchParams.get("schema") ?? "public",
        ),
        sessionsRevoked: true,
        deliveryDisabled: true,
      });
    } finally {
      await db.$disconnect();
    }
  } else throw new Error("Use create or restore");
}
main().catch(() => {
  console.error(
    "Backup operation failed. Check key, path, schema, database access and restore guards; no database credentials are printed.",
  );
  process.exitCode = 1;
});
