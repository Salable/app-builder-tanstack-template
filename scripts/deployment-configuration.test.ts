import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEntitlementProvider } from "../src/entitlements/entitlement-provider";

describe("deployment environment contract", () => {
  it("declares native Deploy Button ownership and Neon provisioning", () => {
    const manifest = JSON.parse(readFileSync("deployment/vercel.v1.json", "utf8")) as {
      installation: {
        method: string;
        repositoryOwnership: string;
        databaseCredentialOwner: string;
        requiredIntegrations: Array<Record<string, string>>;
      };
    };

    expect(manifest.installation).toEqual({
      method: "vercel-deploy-button",
      repositoryOwnership: "vercel-created",
      requiredIntegrations: [
        { type: "connectable", slug: "app-builder" },
        {
          type: "native-product",
          slug: "neon",
          productSlug: "neon",
          protocol: "storage",
        },
      ],
      databaseCredentialOwner: "vercel-marketplace:neon",
    });
  });

  it("runs migrations only for isolated preview builds", () => {
    const manifest = JSON.parse(readFileSync("deployment/vercel.v1.json", "utf8")) as {
      environment: Array<{ name: string; phase: string }>;
    };
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(manifest.environment).not.toContainEqual(
      expect.objectContaining({ name: "RELEASE_MIGRATION_RECEIPT" }),
    );
    expect(
      manifest.environment.find(({ name }) => name === "DATABASE_URL")?.phase,
    ).toBe("build-runtime");
    expect(packageJson.scripts["deploy:vercel"]).toBe(
      "node --import tsx scripts/deploy-vercel.ts",
    );
    expect(packageJson.scripts.build).toBe(
      "npm run generate && NODE_ENV=production vite build",
    );
    expect(manifest.environment).toContainEqual(
      expect.objectContaining({
        name: "APP_BUILDER_DELIVERY_STAGE",
        phase: "build-runtime",
        source: "generated",
      }),
    );
  });

  it("declares an environment-bound server-only flag evaluation credential", () => {
    const manifest = JSON.parse(readFileSync("deployment/vercel.v1.json", "utf8")) as {
      environment: Array<{
        name: string;
        phase: string;
        required: boolean;
        secret: boolean;
        source: string;
      }>;
    };
    expect(manifest.environment).toContainEqual({
      name: "APP_ENVIRONMENT_ID",
      phase: "runtime",
      required: true,
      secret: false,
      source: "generated",
    });
    expect(manifest.environment).toContainEqual({
      name: "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN",
      phase: "runtime",
      required: true,
      secret: true,
      source: "generated",
    });
    expect(manifest.environment).toContainEqual({
      name: "APP_BUILDER_CONTROL_PLANE_URL",
      phase: "runtime",
      required: true,
      secret: false,
      source: "generated",
    });
    expect(manifest.environment).toContainEqual({
      name: "APP_BUILDER_PROJECT_ID",
      phase: "runtime",
      required: true,
      secret: false,
      source: "generated",
    });
  });

  it("can enable protected insights using only a declared production variable", async () => {
    const manifest = JSON.parse(readFileSync("deployment/vercel.v1.json", "utf8")) as {
      environment: Array<{ name: string; required: boolean }>;
    };
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const declaredEnvironment: Record<string, string | undefined> = Object.fromEntries(
      manifest.environment.map(({ name }) => [name, undefined]),
    );
    declaredEnvironment.APP_BUILDER_ENTITLED_ORGANIZATION_IDS = organizationId;

    expect(
      await createEntitlementProvider({
        ...declaredEnvironment,
      }).hasEntitlement({
        capability: "protected-insights",
        organizationId,
        userId: "deployment-test-user",
      }),
    ).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["malformed", JSON.stringify({ version: 2 })],
  ])("rejects %s built Vercel output", (_name, contents) => {
    const configPath = join(
      mkdtempSync(join(tmpdir(), "vercel-output-")),
      "config.json",
    );
    if (contents !== undefined) writeFileSync(configPath, contents);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/check-deployment-manifest.ts",
        "--built",
        configPath,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
  });
});
