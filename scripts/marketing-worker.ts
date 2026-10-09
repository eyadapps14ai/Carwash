import { db } from "../lib/db";
import { runMarketing } from "../lib/marketing-engine";
import { dispatchMarketing } from "../lib/marketing-delivery";
let stopping = false,
  wake: (() => void) | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
async function tick() {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.loginAttempt.deleteMany({
    where: { resetAt: { lt: new Date(Date.now() - 86400000) } },
  });
  await db.$transaction((tx) => runMarketing(tx), { timeout: 120000 });
  const results = await dispatchMarketing();
  console.log(
    `Marketing cycle completed: ${results.length} delivery records processed`,
  );
}
async function main() {
  do {
    await tick();
    if (stopping || process.argv.includes("--once")) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!stopping);
}
main()
  .catch(() => {
    console.error(
      "Marketing worker failed; inspect configuration and database availability.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
