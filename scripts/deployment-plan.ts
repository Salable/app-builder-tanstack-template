export type AppBuilderDeliveryStage = "DEVELOPMENT" | "PREVIEW" | "PRODUCTION";
export type DeploymentScript = "migrate" | "build:vercel" | "check:deployment:built";

/**
 * Development and Preview migrations run inside Vercel's provider-owned build.
 * The phase-one production command is a source merge only, so Production builds
 * deliberately do not receive database-migration authority.
 */
export function deploymentScripts(
  value: string | undefined,
): readonly DeploymentScript[] {
  if (value === "DEVELOPMENT" || value === "PREVIEW") {
    return ["migrate", "build:vercel", "check:deployment:built"];
  }
  if (value === "PRODUCTION") {
    return ["build:vercel", "check:deployment:built"];
  }
  throw new Error(
    "APP_BUILDER_DELIVERY_STAGE must be DEVELOPMENT, PREVIEW, or PRODUCTION for a Vercel deployment.",
  );
}
