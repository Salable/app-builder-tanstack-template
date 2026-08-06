import { z } from "zod";
import manifestDocument from "../../feature-flags/manifest.v1.json" with { type: "json" };
import {
  FeatureFlagExposureSchema,
  FeatureFlagKeySchema,
  FeatureFlagLifecycleSchema,
  FeatureFlagValueKindSchema,
  FeatureFlagValueSchema,
  valueKind,
} from "./contracts";

export const FeatureFlagManifestDefinitionSchema = z
  .object({
    key: FeatureFlagKeySchema,
    valueKind: FeatureFlagValueKindSchema,
    safeFallback: FeatureFlagValueSchema,
    description: z.string().trim().min(1).max(2_000),
    owner: z.string().trim().min(1).max(200),
    capability: z.string().trim().min(1).max(500),
    exposure: FeatureFlagExposureSchema,
    lifecycle: FeatureFlagLifecycleSchema,
    removalCondition: z.string().trim().min(1).max(2_000).nullable(),
    removalTaskReference: z.string().trim().min(1).max(200).nullable(),
    introducedVersion: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export const FeatureFlagManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    manifestVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    definitions: z.array(FeatureFlagManifestDefinitionSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    manifest.definitions.forEach((definition, index) => {
      if (seen.has(definition.key)) {
        context.addIssue({
          code: "custom",
          message: "flag keys must be unique",
          path: ["definitions", index, "key"],
        });
      }
      seen.add(definition.key);
      if (valueKind(definition.safeFallback) !== definition.valueKind) {
        context.addIssue({
          code: "custom",
          message: "safe fallback must match value kind",
          path: ["definitions", index, "safeFallback"],
        });
      }
      if (
        definition.lifecycle !== "FULLY_ENABLED" &&
        (definition.removalCondition === null ||
          definition.removalTaskReference === null)
      ) {
        context.addIssue({
          code: "custom",
          message: "unfinished flags require retirement ownership",
          path: ["definitions", index, "removalCondition"],
        });
      }
      if (
        definition.valueKind === "BOOLEAN" &&
        definition.lifecycle !== "FULLY_ENABLED" &&
        definition.safeFallback !== false
      ) {
        context.addIssue({
          code: "custom",
          message: "unfinished boolean flags must fail safely to false",
          path: ["definitions", index, "safeFallback"],
        });
      }
    });
  });

export const featureFlagManifest = FeatureFlagManifestSchema.parse(manifestDocument);
