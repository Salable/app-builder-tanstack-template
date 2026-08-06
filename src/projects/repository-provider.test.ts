import { describe, expect, it } from "vitest";
import { readPersistenceFaultName } from "./repository-provider";

describe("project persistence fault configuration", () => {
  it("cannot be enabled in production", () => {
    expect(
      readPersistenceFaultName({
        APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME: "rollback proof",
        NODE_ENV: "production",
      }),
    ).toBeUndefined();
  });

  it("remains available to explicit test processes", () => {
    expect(
      readPersistenceFaultName({
        APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME: "rollback proof",
        NODE_ENV: "test",
      }),
    ).toBe("rollback proof");
  });
});
