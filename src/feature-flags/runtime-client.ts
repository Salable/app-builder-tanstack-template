import {
  FeatureFlagEvaluationContextSchema,
  RuntimeFeatureFlagResponseSchema,
  type FeatureFlagEvaluationContext,
  type RuntimeFeatureFlagValue,
} from "./contracts";
import { z } from "zod";

const RegisteredSubjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().startsWith("project_"),
    subjectId: z.string().startsWith("flagsubject_"),
    externalKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
  })
  .strict();
const RegisteredOrganizationSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().startsWith("project_"),
    organizationId: z.string().startsWith("flagorganization_"),
    externalKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
  })
  .strict();

export interface FeatureFlagRuntimeClient {
  evaluate(
    keys: readonly string[],
    context?: FeatureFlagEvaluationContext,
  ): Promise<RuntimeFeatureFlagValue[]>;
}

export class AppBuilderFeatureFlagRuntimeClient implements FeatureFlagRuntimeClient {
  constructor(
    private readonly endpoint: URL,
    private readonly projectId: string,
    private readonly environmentId: string,
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    assertRuntimeConfiguration(endpoint, projectId, environmentId, token);
  }

  async evaluate(
    keys: readonly string[],
    rawContext?: FeatureFlagEvaluationContext,
  ): Promise<RuntimeFeatureFlagValue[]> {
    const context = FeatureFlagEvaluationContextSchema.parse(rawContext ?? {});
    const path = `/api/runtime/v1/projects/${encodeURIComponent(this.projectId)}/environments/${encodeURIComponent(this.environmentId)}/feature-flags/evaluate`;
    const response = await this.transport(new URL(path, this.endpoint), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keys: [...new Set(keys)].sort(), context }),
    });
    if (!response.ok) throw new Error("Feature flag control plane is unavailable.");
    return RuntimeFeatureFlagResponseSchema.parse(await response.json()).values;
  }

  registerSubject(externalKey: string, label: string | null = null) {
    return this.register("subjects", { externalKey, label }, RegisteredSubjectSchema);
  }

  registerOrganization(externalKey: string, label: string | null = null) {
    return this.register(
      "organizations",
      { externalKey, label },
      RegisteredOrganizationSchema,
    );
  }

  async addOrganizationMember(
    organizationId: string,
    subjectId: string,
  ): Promise<void> {
    const response = await this.request(`organizations/${organizationId}/members`, {
      method: "PUT",
      body: JSON.stringify({ subjectId }),
    });
    if (!response.ok) throw new Error("Feature flag access registration failed.");
  }

  private async register<Schema extends z.ZodType>(
    path: string,
    body: unknown,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    const response = await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Feature flag access registration failed.");
    return schema.parse(await response.json());
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    const base = `/api/runtime/v1/projects/${encodeURIComponent(this.projectId)}/environments/${encodeURIComponent(this.environmentId)}/feature-flags/`;
    return this.transport(new URL(`${base}${path}`, this.endpoint), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
  }
}

export function createFeatureFlagRuntimeClient(
  environment: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
): AppBuilderFeatureFlagRuntimeClient {
  const endpoint = required(environment, "APP_BUILDER_CONTROL_PLANE_URL");
  const projectId = required(environment, "APP_BUILDER_PROJECT_ID");
  const environmentId = required(environment, "APP_ENVIRONMENT_ID");
  const token = required(environment, "APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN");
  return new AppBuilderFeatureFlagRuntimeClient(
    new URL(endpoint),
    projectId,
    environmentId,
    token,
    transport,
  );
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for feature flag evaluation.`);
  }
  return value;
}

function assertRuntimeConfiguration(
  endpoint: URL,
  projectId: string,
  environmentId: string,
  token: string,
): void {
  const developmentLoopback =
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !developmentLoopback) {
    throw new Error("Feature flag control-plane URL must use HTTPS.");
  }
  if (!projectId.startsWith("project_") || !environmentId.startsWith("environment_")) {
    throw new Error("Feature flag runtime identity is invalid.");
  }
  if (!token.startsWith("ffrt_flagcredential_") || token.length < 64) {
    throw new Error("Feature flag runtime credential is invalid.");
  }
}
