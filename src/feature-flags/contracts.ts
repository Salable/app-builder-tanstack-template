import { z } from "zod";

export const FeatureFlagKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
export const FeatureFlagValueKindSchema = z.enum([
  "BOOLEAN",
  "STRING",
  "NUMBER",
  "JSON",
]);
export const FeatureFlagExposureSchema = z.enum(["SERVER_ONLY", "CLIENT_EXPOSED"]);
export const FeatureFlagLifecycleSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "ROLLING_OUT",
  "FULLY_ENABLED",
  "RETIRING",
  "RETIRED",
]);
export const FeatureFlagValueSchema = z.union([
  z.boolean(),
  z.string().max(10_000),
  z.number().finite(),
  z.json(),
]);
export const FeatureFlagEvaluationContextSchema = z
  .object({
    subjectId: z.string().trim().min(1).max(500).optional(),
    organizationId: z.string().trim().min(1).max(500).optional(),
    attributes: z.record(z.string().max(100), z.string().max(500)).default({}),
  })
  .strict();
export const RuntimeFeatureFlagValueSchema = z
  .object({
    key: FeatureFlagKeySchema,
    valueKind: FeatureFlagValueKindSchema,
    value: FeatureFlagValueSchema,
    exposure: FeatureFlagExposureSchema,
    revision: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const RuntimeFeatureFlagResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().startsWith("project_"),
    environmentId: z.string().startsWith("environment_"),
    values: z.array(RuntimeFeatureFlagValueSchema),
    evaluatedAt: z.iso.datetime(),
  })
  .strict();

export type FeatureFlagValue = z.infer<typeof FeatureFlagValueSchema>;
export type FeatureFlagValueKind = z.infer<typeof FeatureFlagValueKindSchema>;
export type FeatureFlagEvaluationContext = z.input<
  typeof FeatureFlagEvaluationContextSchema
>;
export type RuntimeFeatureFlagValue = z.infer<typeof RuntimeFeatureFlagValueSchema>;

export function valueKind(value: FeatureFlagValue): FeatureFlagValueKind {
  return typeof value === "boolean"
    ? "BOOLEAN"
    : typeof value === "string"
      ? "STRING"
      : typeof value === "number"
        ? "NUMBER"
        : "JSON";
}
