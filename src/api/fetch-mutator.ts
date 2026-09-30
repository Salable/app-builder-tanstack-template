import type { ProblemDetail } from "./generated/models";
import { createProblemDetail, ProblemDetailSchema } from "./problem-detail";

export class ApiError<TProblem = ProblemDetail> extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: TProblem,
  ) {
    super(ProblemDetailSchema.safeParse(problem).data?.detail ?? "API request failed");
    this.name = "ApiError";
  }
}

export type ErrorType<TError> = ApiError<TError>;

export async function apiFetch<T>(url: string, options: RequestInit): Promise<T> {
  const headers = new Headers(options.headers);
  const version = /(?:^|\/)api\/v([1-9]\d*)(?:\/|$)/.exec(url)?.[1];
  if (version !== undefined && !headers.has("API-Version")) {
    headers.set("API-Version", version);
  }
  const response = await send(url, { ...options, headers });
  const body = await readBody(response);
  if (response.ok) return body as T;
  const problem = ProblemDetailSchema.safeParse(body);
  if (problem.success && problem.data.status === response.status) {
    throw new ApiError(response.status, problem.data);
  }
  throw responseFailure(response.status);
}

async function send(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch {
    throw new ApiError(
      503,
      createProblemDetail({
        correlationId: crypto.randomUUID(),
        instance: "/",
        status: 503,
        detail: "The API could not be reached.",
        code: "TRANSPORT_UNAVAILABLE",
      }),
    );
  }
}

async function readBody(response: Response): Promise<unknown> {
  if ([204, 205, 304].includes(response.status)) return undefined;
  try {
    const text = await response.text();
    return text === "" ? undefined : (JSON.parse(text) as unknown);
  } catch {
    throw responseFailure(response.status);
  }
}

function responseFailure(httpStatus: number): ApiError {
  const status = httpStatus >= 400 && httpStatus <= 599 ? httpStatus : 502;
  return new ApiError(
    status,
    createProblemDetail({
      correlationId: crypto.randomUUID(),
      instance: "/",
      status,
      detail: "The API returned an invalid response.",
      code: "INVALID_RESPONSE",
    }),
  );
}
