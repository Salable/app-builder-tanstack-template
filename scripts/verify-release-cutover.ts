import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    exactCommit: z.string().regex(/^[0-9a-f]{40}$/),
    migrationChecksums: z.record(
      z.string().regex(/^\d+_.+\.up\.sql$/),
      z.string().regex(/^[0-9a-f]{64}$/),
    ),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;

export type ReleaseCutoverInput = {
  expectedCommit: string;
  migrationsDirectory?: string;
  now?: Date;
  receiptPath: string;
};

export async function verifyReleaseCutover({
  expectedCommit,
  migrationsDirectory = "migrations",
  now = new Date(),
  receiptPath,
}: ReleaseCutoverInput): Promise<void> {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error("RELEASE_COMMIT_SHA must be an exact 40-character Git SHA.");
  }

  const receipt = ReceiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  if (receipt.exactCommit !== expectedCommit) {
    throw new Error("Migration receipt commit does not match the promoted commit.");
  }

  const age = now.getTime() - new Date(receipt.completedAt).getTime();
  if (age < 0 || age > MAX_RECEIPT_AGE_MS) {
    throw new Error("Migration receipt is stale or has a future completion timestamp.");
  }

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.up\.sql$/.test(name))
    .sort();
  if (
    Object.keys(receipt.migrationChecksums).sort().join("\n") !==
    migrationFiles.join("\n")
  ) {
    throw new Error("Migration receipt does not cover the exact migration set.");
  }

  for (const migrationFile of migrationFiles) {
    const contents = await readFile(join(migrationsDirectory, migrationFile));
    const checksum = createHash("sha256").update(contents).digest("hex");
    if (receipt.migrationChecksums[migrationFile] !== checksum) {
      throw new Error(`Migration checksum mismatch for ${migrationFile}.`);
    }
  }
}

if (process.argv[1]?.endsWith("verify-release-cutover.ts")) {
  const argument = (name: string): string | undefined => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const expectedCommit = argument("--commit") ?? process.env.RELEASE_COMMIT_SHA;
  const receiptPath =
    argument("--receipt") ?? process.env.RELEASE_MIGRATION_RECEIPT_PATH;
  if (!expectedCommit) throw new Error("--commit or RELEASE_COMMIT_SHA is required.");
  if (!receiptPath) {
    throw new Error("--receipt or RELEASE_MIGRATION_RECEIPT_PATH is required.");
  }
  await verifyReleaseCutover({ expectedCommit, receiptPath });
  console.log(`Verified trusted production cutover receipt for ${expectedCommit}.`);
}
