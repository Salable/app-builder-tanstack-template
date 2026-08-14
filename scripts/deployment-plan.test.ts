import { describe, expect, it } from "vitest";
import { deploymentScripts } from "./deployment-plan";

describe("Vercel deployment plan", () => {
  it("migrates an isolated preview database before building", () => {
    expect(deploymentScripts("PREVIEW")).toEqual([
      "migrate",
      "build:vercel",
      "check:deployment:built",
    ]);
  });

  it("treats staged Development delivery as a preview deployment", () => {
    expect(deploymentScripts("DEVELOPMENT")).toEqual([
      "migrate",
      "build:vercel",
      "check:deployment:built",
    ]);
  });

  it("never repeats the separately receipted Production migration", () => {
    expect(deploymentScripts("PRODUCTION")).toEqual([
      "build:vercel",
      "check:deployment:built",
    ]);
  });

  it("fails closed without an App Builder deployment stage", () => {
    expect(() => deploymentScripts(undefined)).toThrow(/APP_BUILDER_DELIVERY_STAGE/);
  });
});
