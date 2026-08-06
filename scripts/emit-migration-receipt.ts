import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const exactCommit = argument("--commit");
if (!/^[0-9a-f]{40}$/.test(exactCommit)) {
  throw new Error("--commit must be a full lowercase Git commit SHA.");
}
const output = argument("--output");
const migrationsDirectory = "migrations";
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_.+\.up\.sql$/.test(name))
  .sort();
const migrationChecksums = Object.fromEntries(
  await Promise.all(
    migrationFiles.map(async (name) => [
      name,
      createHash("sha256")
        .update(await readFile(join(migrationsDirectory, name)))
        .digest("hex"),
    ]),
  ),
);

await writeFile(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      exactCommit,
      migrationChecksums,
      completedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(`Emitted migration receipt for ${exactCommit} at ${output}.`);
