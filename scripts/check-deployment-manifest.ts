import { readFile } from "node:fs/promises";
import { z } from "zod";

const EnvironmentVariableSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    required: z.boolean(),
    secret: z.boolean(),
    source: z.enum(["deployment-url", "generated", "user", "vercel-marketplace:neon"]),
    phase: z.literal("runtime"),
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
        buildCommand: z.literal("npm run build:vercel"),
        outputDirectory: z.literal(".vercel/output"),
      })
      .strict(),
    environment: z.array(EnvironmentVariableSchema).min(3),
    database: z
      .object({
        provider: z.literal("neon"),
        integration: z.literal("neon"),
        migrationCommand: z.literal("npm run migrate"),
      })
      .strict(),
    routes: z
      .object({
        application: z.literal("/"),
        publicApi: z.literal("/api/v1"),
        health: z.literal("/api/v1/health"),
        openapi: z.literal("/api/v1/openapi.json"),
        identityCallback: z.literal("/api/auth/callback/github"),
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
  })
  .strict();

const manifest = DeploymentManifestSchema.parse(
  JSON.parse(await readFile("deployment/vercel.v1.json", "utf8")),
);
const packageJson = z
  .object({
    dependencies: z.record(z.string(), z.string()),
  })
  .parse(JSON.parse(await readFile("package.json", "utf8")));

if (packageJson.dependencies.nitro !== manifest.adapter.version) {
  throw new Error("Deployment manifest must pin the installed Nitro version.");
}

const variableNames = manifest.environment.map(({ name }) => name);
if (new Set(variableNames).size !== variableNames.length) {
  throw new Error("Deployment manifest environment names must be unique.");
}

for (const requiredName of ["DATABASE_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET"]) {
  const variable = manifest.environment.find(({ name }) => name === requiredName);
  if (!variable?.required) {
    throw new Error(`Deployment manifest must require ${requiredName}.`);
  }
}

if (process.argv.includes("--built")) {
  const buildOutput = z
    .object({ version: z.literal(manifest.adapter.buildOutputApiVersion) })
    .passthrough()
    .parse(JSON.parse(await readFile(".vercel/output/config.json", "utf8")));
  if (buildOutput.version !== 3) {
    throw new Error("Vercel Build Output API version must be 3.");
  }
}

console.log(
  `Verified Vercel deployment manifest v${manifest.schemaVersion} (${manifest.adapter.name}@${manifest.adapter.version}).`,
);
