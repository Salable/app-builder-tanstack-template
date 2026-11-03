import { afterEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresDatabase } from "./database";
import { createBetterAuthRuntime } from "../identity/better-auth-runtime";

afterEach(() => vi.restoreAllMocks());

describe("database background diagnostics", () => {
  it.each(["application", "identity"] as const)(
    "reports a %s idle connection error and preserves lifecycle when logging fails",
    async (owner) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const on = vi.spyOn(Pool.prototype, "on");
      const runtime =
        owner === "application"
          ? new PostgresDatabase("postgresql://example.invalid/test")
          : createBetterAuthRuntime({
              databaseUrl: "postgresql://example.invalid/test",
              secret: "test-secret-with-at-least-32-characters",
              baseUrl: "http://127.0.0.1:3000",
              secureCookies: false,
            });
      try {
        const pool = on.mock.instances.find(
          (instance, index) => on.mock.calls[index]?.[0] === "error",
        ) as Pool;
        expect(pool).toBeInstanceOf(Pool);
        const cause = Object.assign(new Error("private postgres credentials"), {
          code: "08006",
        });
        pool.emit("error", cause);
        expect(log).toHaveBeenCalledOnce();
        expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
          code: "DATABASE_CONNECTION_FAILED",
          source: "server",
          error: {
            diagnostic: { category: "database", dependency: "postgres" },
            cause: { type: "Error", code: "08006" },
          },
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain("private");
        log.mockImplementation(() => {
          throw new Error("sink failure");
        });
        expect(() => pool.emit("error", cause)).not.toThrow();
      } finally {
        await runtime.close();
      }
    },
  );
});
