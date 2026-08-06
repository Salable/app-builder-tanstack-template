import type { ProblemDetail } from "./generated/models";

export class ApiError<TProblem = ProblemDetail> extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: TProblem,
  ) {
    super(isProblemDetail(problem) ? problem.detail : "API request failed");
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
  const response = await fetch(url, { ...options, headers });
  const text = [204, 205, 304].includes(response.status) ? "" : await response.text();
  const body: unknown = text === "" ? undefined : JSON.parse(text);
  if (!response.ok) throw new ApiError(response.status, body as ProblemDetail);
  return body as T;
}

function isProblemDetail(value: unknown): value is ProblemDetail {
  return typeof value === "object" && value !== null && "detail" in value;
}
