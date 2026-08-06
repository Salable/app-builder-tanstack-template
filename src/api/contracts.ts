import { z } from "@hono/zod-openapi";

export const ApiVersionHeaderSchema = z.literal("1").openapi({
  example: "1",
  param: {
    in: "header",
    name: "API-Version",
  },
});

export const ApiVersionRequestHeadersSchema = z.object({
  "API-Version": ApiVersionHeaderSchema.optional(),
});

export const OrganizationRequestHeadersSchema = ApiVersionRequestHeadersSchema.extend({
  "X-Organization-ID": z.uuid().openapi({
    param: { in: "header", name: "X-Organization-ID" },
  }),
});

export const HealthResponseSchema = z
  .object({
    service: z.literal("generated-app"),
    status: z.literal("ok"),
    version: z.literal(1),
  })
  .strict()
  .openapi("HealthResponse");

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().min(3).max(100),
  })
  .strict()
  .openapi("CreateProjectRequest");

export const ProjectResponseSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    name: z.string().min(3).max(100),
    revision: z.number().int().positive(),
  })
  .strict()
  .openapi("ProjectResponse");

export const ProjectPathParametersSchema = z.object({
  projectId: z.uuid().openapi({
    param: {
      in: "path",
      name: "projectId",
    },
  }),
});

export const ProtectedFeatureResponseSchema = z
  .object({
    capability: z.literal("protected-insights"),
    projectId: z.uuid(),
    status: z.literal("available"),
  })
  .strict()
  .openapi("ProtectedFeatureResponse");

export const ProblemDetailSchema = z
  .object({
    correlationId: z.string().min(1),
    detail: z.string().min(1),
    instance: z.string().min(1),
    status: z.number().int().min(400).max(599),
    title: z.string().min(1),
    type: z.string().url(),
  })
  .strict()
  .openapi("ProblemDetail");
