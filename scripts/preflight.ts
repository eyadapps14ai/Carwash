import { db } from "../lib/db";
async function main() {
  const failures: string[] = [];
  let origin: URL | undefined, database: URL | undefined;
  try {
    origin = new URL(process.env.APP_ORIGIN!);
  } catch {
    failures.push("APP_ORIGIN is invalid");
  }
  try {
    database = new URL(process.env.DATABASE_URL!);
  } catch {
    failures.push("DATABASE_URL is invalid");
  }
  if (
    origin &&
    (origin.protocol !== "https:" ||
      ["localhost", "127.0.0.1"].includes(origin.hostname))
  )
    failures.push("Use the approved public HTTPS application origin");
  if (
    database &&
    database.protocol !== "postgresql:" &&
    database.protocol !== "postgres:"
  )
    failures.push(
      "Use production PostgreSQL, not Prisma development transport",
    );
  if (database && ["localhost", "127.0.0.1"].includes(database.hostname))
    failures.push("Use a separate production database");
  if (
    database &&
    !["require", "verify-full", "verify-ca"].includes(
      database.searchParams.get("sslmode") ?? "",
    )
  )
    failures.push("Database TLS must be enabled");
  const settings = await db.settings.findUnique({ where: { id: "company" } });
  if (!settings || settings.sampleMode)
    failures.push(
      "Bootstrap an empty production database; sample mode must be off",
    );
  if (!(await db.user.count({ where: { role: "OWNER", active: true } })))
    failures.push("Create the active owner account");
  if (process.env.SEED_OWNER_PASSWORD)
    failures.push("Remove bootstrap password from runtime configuration");
  if (failures.length) {
    console.log({ ready: false, failures });
    process.exitCode = 1;
  } else
    console.log({
      ready: true,
      note: "Configuration gate passed; staging load, recovery, provider and business sign-off remain deployment checks",
    });
}
main()
  .catch(() => {
    console.error(
      "Preflight could not inspect the database; no credentials printed.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
