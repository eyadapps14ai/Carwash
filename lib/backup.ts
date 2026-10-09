import { PrismaClient, Prisma } from "@prisma/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
const magic = Buffer.from("PROTUNE6"),
  models = Prisma.dmmf.datamodel.models;
export function encryptBackup(data: unknown, key: Buffer) {
  if (key.length !== 32) throw new Error("Use a 32-byte backup key");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackup(data: Buffer, key: Buffer) {
  if (
    key.length !== 32 ||
    !data.subarray(0, 8).equals(magic) ||
    data.length < 37
  )
    throw new Error("Invalid encrypted backup");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(8, 20));
  decipher.setAAD(magic);
  decipher.setAuthTag(data.subarray(20, 36));
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(36)),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export type Snapshot = {
  version: number;
  createdAt: string;
  schemaHash: string;
  tables: Record<string, any[]>;
  fingerprint: string;
};
export function fingerprint(tables: Snapshot["tables"]) {
  const stable = Object.fromEntries(
    Object.keys(tables)
      .sort()
      .filter(
        (k) => !["Session", "LoginAttempt", "MarketingConfig"].includes(k),
      )
      .map((k) => [k, tables[k].map((row) => JSON.stringify(row)).sort()]),
  );
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
export async function capture(db: PrismaClient): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  await db.$transaction(
    async (tx) => {
      for (const model of models)
        tables[model.name] = JSON.parse(
          JSON.stringify(
            await (tx as any)[
              model.name[0].toLowerCase() + model.name.slice(1)
            ].findMany(),
          ),
        );
    },
    { isolationLevel: "RepeatableRead", timeout: 120000 },
  );
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    schemaHash: createHash("sha256")
      .update(JSON.stringify(models))
      .digest("hex"),
    tables,
    fingerprint: fingerprint(tables),
  };
}
export async function saveBackup(db: PrismaClient, path: string, key: Buffer) {
  const data = await capture(db);
  await writeFile(path, encryptBackup(data, key), { mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
  return {
    createdAt: data.createdAt,
    fingerprint: data.fingerprint,
    rows: Object.values(data.tables).reduce((n, rows) => n + rows.length, 0),
  };
}
export async function loadBackup(path: string, key: Buffer) {
  const data = decryptBackup(await readFile(path), key) as Snapshot;
  if (
    data.version !== 1 ||
    data.schemaHash !==
      createHash("sha256").update(JSON.stringify(models)).digest("hex") ||
    fingerprint(data.tables) !== data.fingerprint
  )
    throw new Error("Backup version, schema, or fingerprint mismatch");
  return data;
}
export function restoreOrder() {
  const ordered: string[] = [],
    remaining = [...models];
  while (remaining.length) {
    const index = remaining.findIndex((m) =>
      m.fields
        .filter((f) => f.kind === "object" && f.relationFromFields?.length)
        .every((f) => ordered.includes(f.type)),
    );
    if (index < 0) throw new Error("Unresolved schema dependency");
    ordered.push(remaining.splice(index, 1)[0].name);
  }
  return ordered;
}
export async function restoreEmpty(
  db: PrismaClient,
  data: Snapshot,
  schema = "public",
) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema))
    throw new Error("Invalid restore schema");
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(610006)::text`;
      for (const m of models)
        if (
          await (tx as any)[m.name[0].toLowerCase() + m.name.slice(1)].count()
        )
          throw new Error(
            "Restore requires an empty, migrated, isolated database",
          );
      for (const name of restoreOrder()) {
        if (["Session", "LoginAttempt"].includes(name)) continue;
        const model = models.find((m) => m.name === name)!;
        const rows = data.tables[name].map((row) => {
          const value = { ...row };
          for (const field of model.fields) {
            if (field.type === "DateTime" && value[field.name] !== null)
              value[field.name] = new Date(value[field.name]);
            if (field.type === "Json" && value[field.name] === null)
              value[field.name] = Prisma.DbNull;
          }
          if (name === "MarketingConfig") value.deliveryEnabled = false;
          return value;
        });
        for (let i = 0; i < rows.length; i += 200)
          await (tx as any)[name[0].toLowerCase() + name.slice(1)].createMany({
            data: rows.slice(i, i + 200),
          });
      }
      // Keep future generated revision IDs above all restored IDs.
      await tx.$executeRaw`SELECT setval(pg_get_serial_sequence('"ExpenseRevision"','id'), COALESCE((SELECT MAX(id) FROM "ExpenseRevision"),1), EXISTS(SELECT 1 FROM "ExpenseRevision"))`;
    },
    { timeout: 120000 },
  );
  const restored = await capture(db);
  if (restored.fingerprint !== data.fingerprint)
    throw new Error("Restore fingerprint did not match");
  return restored.fingerprint;
}
