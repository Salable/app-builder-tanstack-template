import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyReleaseCutover } from "./verify-release-cutover";

const commit = "a".repeat(40);
const checksums = Object.fromEntries(
  readdirSync("migrations")
    .filter((name) => /^\d+_.+\.up\.sql$/.test(name))
    .map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(`migrations/${name}`))
        .digest("hex"),
    ]),
);
const now = new Date("2026-08-01T12:00:00.000Z");

function receiptPath(overrides: Record<string, unknown> = {}): string {
  const directory = mkdtempSync(join(tmpdir(), "release-receipt-"));
  const path = join(directory, "receipt.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      exactCommit: commit,
      migrationChecksums: checksums,
      completedAt: "2026-08-01T11:00:00.000Z",
      ...overrides,
    }),
  );
  return path;
}

describe("trusted production release cutover", () => {
  it("accepts a current receipt for the exact commit and migration set", async () => {
    await expect(
      verifyReleaseCutover({ expectedCommit: commit, now, receiptPath: receiptPath() }),
    ).resolves.toBeUndefined();
  });

  it("rejects a missing receipt", async () => {
    await expect(
      verifyReleaseCutover({
        expectedCommit: commit,
        now,
        receiptPath: "/missing/release-receipt.json",
      }),
    ).rejects.toThrow();
  });

  it("rejects a receipt for another commit", async () => {
    await expect(
      verifyReleaseCutover({
        expectedCommit: "b".repeat(40),
        now,
        receiptPath: receiptPath(),
      }),
    ).rejects.toThrow("does not match the promoted commit");
  });

  it("rejects a migration checksum mismatch", async () => {
    const changedChecksums = { ...checksums };
    const firstMigration = Object.keys(changedChecksums)[0];
    if (!firstMigration) throw new Error("Expected at least one forward migration.");
    changedChecksums[firstMigration] = "0".repeat(64);
    await expect(
      verifyReleaseCutover({
        expectedCommit: commit,
        now,
        receiptPath: receiptPath({ migrationChecksums: changedChecksums }),
      }),
    ).rejects.toThrow("Migration checksum mismatch");
  });

  it("rejects a stale receipt", async () => {
    await expect(
      verifyReleaseCutover({
        expectedCommit: commit,
        now,
        receiptPath: receiptPath({ completedAt: "2026-07-30T11:00:00.000Z" }),
      }),
    ).rejects.toThrow("stale");
  });
});
