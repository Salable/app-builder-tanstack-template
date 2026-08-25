import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import openApiDocument from "../../openapi/openapi.json" with { type: "json" };
import {
  ApiVersionHeaderSchema,
  ApiVersionRequestHeadersSchema,
  CreateProjectRequestSchema,
  HealthResponseSchema,
  OrganizationRequestHeadersSchema,
  ProblemDetailSchema,
  ProjectPathParametersSchema,
  ProjectResponseSchema,
  ProtectedFeatureResponseSchema,
  type HealthResponse,
} from "./contracts";
import { getProjectAccessRepository } from "../authorization/project-access";
import {
  getEntitlementProvider,
  PROTECTED_INSIGHTS_CAPABILITY,
} from "../entitlements/entitlement-provider";
import {
  getIdentityProvider,
  IdentityConfigurationError,
} from "../identity/identity-provider";
import { getProjectRepository } from "../projects/repository-provider";
import {
  ProjectNameConflictError,
  ProjectOrganizationAccessError,
} from "../projects/project-repository";

const API_VERSION_HEADER = "API-Version";
const CORRELATION_ID_HEADER = "X-Correlation-ID";
const PROBLEM_BASE = "https://generated-app.salable.dev/problems";

type ApiVariables = {
  correlationId: string;
};

export const healthResponse: HealthResponse = {
  service: "generated-app",
  status: "ok",
  version: 1,
};

export const publicApi = new OpenAPIHono<{ Variables: ApiVariables }>({
  defaultHook: (result, context) => {
    if (result.success) return;
    return problem(context, {
      detail: "The request did not match the published contract.",
      status: 400,
      title: "Invalid request",
      type: `${PROBLEM_BASE}/invalid-request`,
    });
  },
});

publicApi.use("/api/v1/*", async (context, next) => {
  const correlationId =
    normalizeCorrelationId(context.req.header(CORRELATION_ID_HEADER)) ??
    `corr_${crypto.randomUUID()}`;
  context.set("correlationId", correlationId);
  context.header(CORRELATION_ID_HEADER, correlationId);
  context.header(API_VERSION_HEADER, "1");
  context.header("Vary", API_VERSION_HEADER);

  const requestedVersion = context.req.header(API_VERSION_HEADER);
  if (
    requestedVersion === undefined ||
    !ApiVersionHeaderSchema.safeParse(requestedVersion.trim()).success
  ) {
    return problem(context, {
      detail: `API-Version must be exactly 1; received ${JSON.stringify(requestedVersion ?? null)}.`,
      status: 400,
      title: "Unsupported API version",
      type: `${PROBLEM_BASE}/unsupported-api-version`,
    });
  }

  await next();
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/v1/health",
  request: {
    headers: ApiVersionRequestHeadersSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
      description: "Generated application API health.",
    },
    400: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The requested API version is unsupported.",
    },
  },
  tags: ["system"],
});

publicApi.openapi(healthRoute, (context) =>
  context.json(HealthResponseSchema.parse(healthResponse), 200),
);

const createProjectRoute = createRoute({
  method: "post",
  path: "/api/v1/projects",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateProjectRequestSchema,
        },
      },
      required: true,
    },
    headers: OrganizationRequestHeadersSchema,
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: ProjectResponseSchema,
        },
      },
      description: "The project was created transactionally.",
    },
    400: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The request or API version is invalid.",
    },
    401: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "A database-backed session is required.",
    },
    403: {
      content: { "application/problem+json": { schema: ProblemDetailSchema } },
      description: "The user is not a member of the requested organization.",
    },
    409: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "A project with the normalized name already exists.",
    },
    500: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The transaction failed without exposing internal details.",
    },
    503: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The identity boundary is not configured.",
    },
  },
  tags: ["projects"],
});

publicApi.openapi(createProjectRoute, async (context) => {
  try {
    const identity = await getIdentityProvider().authenticate(context.req.raw.headers);
    if (identity === null) {
      return problem(context, {
        detail: "A valid session is required.",
        status: 401,
        title: "Unauthorized",
        type: `${PROBLEM_BASE}/unauthorized`,
      });
    }
    const organizationId = context.req.valid("header")["X-Organization-ID"];
    const project = await getProjectRepository().create(
      context.req.valid("json"),
      organizationId,
      identity.userId,
    );
    return context.json(ProjectResponseSchema.parse(project), 201);
  } catch (error) {
    if (error instanceof ProjectNameConflictError) {
      return problem(context, {
        detail: "A project with that name already exists.",
        status: 409,
        title: "Project name conflict",
        type: `${PROBLEM_BASE}/project-name-conflict`,
      });
    }
    if (error instanceof ProjectOrganizationAccessError) {
      return problem(context, {
        detail: "The user is not a member of the requested organization.",
        status: 403,
        title: "Forbidden",
        type: `${PROBLEM_BASE}/forbidden`,
      });
    }
    throw error;
  }
});

const protectedFeatureRoute = createRoute({
  method: "get",
  path: "/api/v1/projects/{projectId}/protected-feature",
  request: {
    headers: ApiVersionRequestHeadersSchema,
    params: ProjectPathParametersSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ProtectedFeatureResponseSchema,
        },
      },
      description:
        "An owner-only, organization-scoped feature backed by an entitlement.",
    },
    400: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The project identifier or API version is invalid.",
    },
    401: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "A database-backed session is required.",
    },
    403: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The owning organization lacks the required entitlement.",
    },
    404: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description:
        "The project does not exist or is concealed by its ownership boundary.",
    },
    500: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "Authorization failed without exposing internal details.",
    },
    503: {
      content: {
        "application/problem+json": {
          schema: ProblemDetailSchema,
        },
      },
      description: "The identity boundary is not configured.",
    },
  },
  tags: ["projects"],
});

publicApi.openapi(protectedFeatureRoute, async (context) => {
  const identity = await getIdentityProvider().authenticate(context.req.raw.headers);
  if (identity === null) {
    return problem(context, {
      detail: "A valid session is required.",
      status: 401,
      title: "Unauthorized",
      type: `${PROBLEM_BASE}/unauthorized`,
    });
  }

  const { projectId } = context.req.valid("param");
  const access = await getProjectAccessRepository().findOwnedProject(
    projectId,
    identity.userId,
  );
  if (access === null) {
    return problem(context, {
      detail: "The requested project does not exist.",
      status: 404,
      title: "Not Found",
      type: `${PROBLEM_BASE}/not-found`,
    });
  }

  const entitled = await getEntitlementProvider().hasEntitlement({
    capability: PROTECTED_INSIGHTS_CAPABILITY,
    organizationId: access.organizationId,
    userId: identity.userId,
  });
  if (!entitled) {
    return problem(context, {
      detail: "The project does not include this capability.",
      status: 403,
      title: "Entitlement required",
      type: `${PROBLEM_BASE}/entitlement-required`,
    });
  }

  return context.json(
    ProtectedFeatureResponseSchema.parse({
      capability: PROTECTED_INSIGHTS_CAPABILITY,
      projectId: access.projectId,
      status: "available",
    }),
    200,
  );
});

publicApi.notFound((context) =>
  problem(context, {
    detail: "The requested API route does not exist.",
    status: 404,
    title: "Not Found",
    type: `${PROBLEM_BASE}/not-found`,
  }),
);

publicApi.onError((error, context) => {
  if (error instanceof IdentityConfigurationError) {
    return problem(context, {
      detail: "The identity service is not available.",
      status: 503,
      title: "Service Unavailable",
      type: `${PROBLEM_BASE}/identity-unavailable`,
    });
  }
  console.error(
    `Public API request failed correlationId=${context.get("correlationId") ?? "unassigned"} error=${error.name}`,
  );
  return problem(context, {
    detail: "The server could not complete the request.",
    status: 500,
    title: "Internal Server Error",
    type: `${PROBLEM_BASE}/internal`,
  });
});

const openApiConfig = {
  info: {
    description: "Strict current API for an App Builder generated application.",
    title: "Generated Application API",
    version: "1.0.0",
  },
  openapi: "3.1.0" as const,
  servers: [{ url: "/" }],
};

publicApi.get("/api/v1/openapi.json", (context) => context.json(openApiDocument));

publicApi.get("/api/v1/test/network-deny-proof", async (context) => {
  const environment = globalThis.process.env;
  if (
    environment.NODE_ENV !== "test" ||
    environment.APP_BUILDER_TEST_NETWORK_DENY_PROOF !== "1"
  ) {
    return context.notFound();
  }
  try {
    await fetch("https://api.example.test/should-not-run");
    return context.text("outbound request unexpectedly succeeded", 500);
  } catch (error) {
    return context.text(String(error));
  }
});

export function getOpenApiDocument() {
  return publicApi.getOpenAPI31Document(openApiConfig);
}

function normalizeCorrelationId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) return undefined;
  return normalized;
}

function problem<Status extends 400 | 401 | 403 | 404 | 409 | 500 | 503>(
  context: Context<{ Variables: ApiVariables }>,
  details: {
    detail: string;
    status: Status;
    title: string;
    type: string;
  },
) {
  const body = {
    correlationId: context.get("correlationId") ?? `corr_${crypto.randomUUID()}`,
    detail: details.detail,
    instance: new URL(context.req.url).pathname,
    status: details.status,
    title: details.title,
    type: details.type,
  };

  context.header(CORRELATION_ID_HEADER, body.correlationId);
  context.header(API_VERSION_HEADER, "1");
  context.header("Vary", API_VERSION_HEADER);
  return context.json(body, details.status, {
    "Content-Type": "application/problem+json",
  });
}
