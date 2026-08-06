import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("PostgreSQL integration database admission", () => {
  it("requires an explicit disposable database marker", () => {
    const result = run({
      APP_BUILDER_TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:1/test",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("APP_BUILDER_TEST_DISPOSABLE_DATABASE=1");
  });

  it("rejects connection-string host overrides", () => {
    const result = run({
      APP_BUILDER_TEST_DATABASE_URL:
        "postgresql://postgres@127.0.0.1:1/test?host=database.example.test",
      APP_BUILDER_TEST_DISPOSABLE_DATABASE: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("host override parameters");
  });
});

function run(environment: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/run-postgres-integration.ts"],
    {
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
}
