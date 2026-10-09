import { join, resolve } from "node:path";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { db } from "../lib/db";
import { saveBackup } from "../lib/backup";
async function main() {
  const folder = process.env.BACKUP_DIR,
    key = Buffer.from(process.env.BACKUP_KEY ?? "", "base64"),
    days = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
  if (!folder || !Number.isInteger(days) || days < 7 || key.length !== 32)
    throw new Error("Invalid backup settings");
  const destination = resolve(folder);
  if (
    destination.startsWith(resolve("public")) ||
    destination.startsWith(resolve(".next"))
  )
    throw new Error("Backups must be outside served directories");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const filename =
    "protune-" + new Date().toISOString().replaceAll(":", "-") + ".backup";
  const result = await saveBackup(db, join(destination, filename), key);
  for (const name of await readdir(destination)) {
    if (!/^protune-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.backup$/.test(name)) continue;
    const path = join(destination, name),
      info = await stat(path);
    if (info.isFile() && info.mtimeMs < Date.now() - days * 86400000)
      await unlink(path);
  }
  console.log({ status: "backup complete", ...result });
}
main()
  .catch(() => {
    console.error(
      "Scheduled backup failed; check storage, database and protected backup key.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
