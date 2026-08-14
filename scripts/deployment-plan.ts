export type AppBuilderDeliveryStage = "DEVELOPMENT" | "PREVIEW" | "PRODUCTION";
export type DeploymentScript = "migrate" | "build:vercel" | "check:deployment:built";

/**
 * Preview databases are isolated Neon branches, so their migrations run inside
 * trusted Vercel build execution before the application build. Production
 * migrations remain a separately receipted App Builder release operation.
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
