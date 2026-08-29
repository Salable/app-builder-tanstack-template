import { readFile } from "node:fs/promises";
import { z } from "zod";

const EnvironmentVariableSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    required: z.boolean(),
    secret: z.boolean(),
    source: z.enum(["generated", "user", "vercel-marketplace:neon"]),
    phase: z.enum(["runtime", "build-runtime"]),
  })
  .strict();

const DeploymentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal("vercel"),
    adapter: z
      .object({
        name: z.literal("nitro"),
        version: z.string().min(1),
        preset: z.literal("vercel"),
        buildOutputApiVersion: z.literal(3),
      })
      .strict(),
    build: z
      .object({
        installCommand: z.literal("npm ci"),
        buildCommand: z.literal("npm run deploy:vercel"),
        outputDirectory: z.literal(".vercel/output"),
      })
      .strict(),
    installation: z
      .object({
        method: z.literal("vercel-deploy-button"),
        repositoryOwnership: z.literal("vercel-created"),
        requiredIntegrations: z.tuple([
          z
            .object({
              type: z.literal("connectable"),
              slug: z.literal("app-builder"),
            })
            .strict(),
          z
            .object({
              type: z.literal("native-product"),
              slug: z.literal("neon"),
              productSlug: z.literal("neon"),
              protocol: z.literal("storage"),
            })
            .strict(),
        ]),
        databaseCredentialOwner: z.literal("vercel-marketplace:neon"),
      })
      .strict(),
    applicationOrigin: z
      .object({
        resolver: z.literal(
          "src/runtime/application-origin.ts#resolveApplicationOrigin",
        ),
        systemVariablesMustBeExposed: z.literal(true),
        validateBeforeBuild: z.literal(true),
        previewSystemVariable: z.literal("VERCEL_URL"),
        productionSystemVariable: z.literal("VERCEL_PROJECT_PRODUCTION_URL"),
        requestHeaderFallback: z.literal(false),
      })
      .strict(),
    environment: z.array(EnvironmentVariableSchema).min(3),
    routes: z
      .object({
        application: z.literal("/"),
        publicApi: z.literal("/api/v1"),
        health: z.literal("/api/v1/health"),
        openapi: z.literal("/api/v1/openapi.json"),
      })
      .strict(),
    runtime: z
      .object({
        node: z.literal("24.x"),
        regions: z.array(z.string()),
      })
      .strict(),
    securityHeaders: z.array(z.string()).min(1),
    verification: z
      .object({
        requireExactCommit: z.literal(true),
        checks: z.array(z.string()).min(1),
      })
      .strict(),
    previewMigration: z
      .object({
        command: z.literal("npm run migrate"),
        stageVariable: z.literal("APP_BUILDER_DELIVERY_STAGE"),
        runWhen: z.literal("PREVIEW"),
      })
      .strict(),
  })
  .strict();

const manifest = DeploymentManifestSchema.parse(
  JSON.parse(await readFile("deployment/vercel.v1.json", "utf8")),
);

if (
  manifest.installation.requiredIntegrations[1].slug !== "neon" ||
  manifest.installation.databaseCredentialOwner !== "vercel-marketplace:neon"
) {
  throw new Error("Vercel installation must provision the native Neon product.");
}
const packageJson = z
  .object({
    dependencies: z.record(z.string(), z.string()),
    scripts: z.record(z.string(), z.string()),
  })
  .parse(JSON.parse(await readFile("package.json", "utf8")));

if (packageJson.dependencies.nitro !== manifest.adapter.version) {
  throw new Error("Deployment manifest must pin the installed Nitro version.");
}

if (
  packageJson.scripts["deploy:vercel"] !== "node --import tsx scripts/deploy-vercel.ts"
) {
  throw new Error("The Vercel deployment command must use the stage-aware runner.");
}

const vercelConfig = z
  .object({ buildCommand: z.literal(manifest.build.buildCommand) })
  .passthrough()
  .parse(JSON.parse(await readFile("vercel.json", "utf8")));
if (vercelConfig.buildCommand !== manifest.build.buildCommand) {
  throw new Error("vercel.json must execute the bounded deployment command.");
}

const variableNames = manifest.environment.map(({ name }) => name);
if (new Set(variableNames).size !== variableNames.length) {
  throw new Error("Deployment manifest environment names must be unique.");
}
for (const forbiddenEnvironmentVariable of [
  "APP_BASE_URL",
  "BETTER_AUTH_URL",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
]) {
  if (variableNames.includes(forbiddenEnvironmentVariable)) {
    throw new Error(
      `Deployment manifest must not configure redundant or unrequested variable ${forbiddenEnvironmentVariable}.`,
    );
  }
}

const databaseVariable = manifest.environment.find(
  ({ name }) => name === "DATABASE_URL",
);
if (
  databaseVariable?.required !== true ||
  databaseVariable.secret !== true ||
  databaseVariable.source !== "vercel-marketplace:neon" ||
  databaseVariable.phase !== "build-runtime"
) {
  throw new Error(
    "Deployment manifest must declare DATABASE_URL as a required build/runtime Neon secret.",
  );
}

for (const requiredName of [
  "BETTER_AUTH_SECRET",
  "APP_ENVIRONMENT_ID",
  "APP_BUILDER_CONTROL_PLANE_URL",
  "APP_BUILDER_PROJECT_ID",
  "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN",
  "APP_BUILDER_DELIVERY_STAGE",
]) {
  const variable = manifest.environment.find(({ name }) => name === requiredName);
  if (!variable?.required) {
    throw new Error(`Deployment manifest must require ${requiredName}.`);
  }
}

const flagCredential = manifest.environment.find(
  ({ name }) => name === "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN",
);
if (flagCredential?.secret !== true || flagCredential.source !== "generated") {
  throw new Error("Feature flag evaluation must use a generated runtime-only secret.");
}
const flagEnvironment = manifest.environment.find(
  ({ name }) => name === "APP_ENVIRONMENT_ID",
);
if (flagEnvironment?.secret !== false || flagEnvironment.source !== "generated") {
  throw new Error("Feature flags require a generated non-secret environment identity.");
}
for (const name of ["APP_BUILDER_CONTROL_PLANE_URL", "APP_BUILDER_PROJECT_ID"]) {
  const variable = manifest.environment.find((candidate) => candidate.name === name);
  if (variable?.secret !== false || variable.source !== "generated") {
    throw new Error(`${name} must be a generated non-secret runtime identity.`);
  }
}
const deliveryStage = manifest.environment.find(
  ({ name }) => name === manifest.previewMigration.stageVariable,
);
if (
  deliveryStage?.secret !== false ||
  deliveryStage.source !== "generated" ||
  deliveryStage.phase !== "build-runtime"
) {
  throw new Error(
    "Preview migration requires a generated non-secret build/runtime stage.",
  );
}

const entitlementVariable = manifest.environment.find(
  ({ name }) => name === "APP_BUILDER_ENTITLED_ORGANIZATION_IDS",
);
if (
  entitlementVariable?.required !== false ||
  entitlementVariable.secret !== false ||
  entitlementVariable.source !== "user"
) {
  throw new Error(
    "Deployment manifest must declare optional APP_BUILDER_ENTITLED_ORGANIZATION_IDS user configuration.",
  );
}

if (process.argv.includes("--built")) {
  const builtIndex = process.argv.indexOf("--built");
  const configPath = process.argv[builtIndex + 1] ?? ".vercel/output/config.json";
  const buildOutput = z
    .object({ version: z.literal(manifest.adapter.buildOutputApiVersion) })
    .passthrough()
    .parse(JSON.parse(await readFile(configPath, "utf8")));
  if (buildOutput.version !== 3) {
    throw new Error("Vercel Build Output API version must be 3.");
  }
}

console.log(
  `Verified Vercel deployment manifest v${manifest.schemaVersion} (${manifest.adapter.name}@${manifest.adapter.version}).`,
);
