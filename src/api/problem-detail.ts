import { z } from "zod";

export const ProblemDetailSchema = z
  .object({
    correlationId: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    detail: z.string().min(1),
    instance: z.string().min(1),
    status: z.number().int().min(400).max(599),
    title: z.string().min(1),
    type: z.literal("about:blank"),
  })
  .strict();

export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;

export function createProblemDetail(
  input: Omit<ProblemDetail, "type" | "title">,
): ProblemDetail {
  const titles: Readonly<Record<number, string>> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Content Too Large",
    422: "Unprocessable Content",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  return ProblemDetailSchema.parse({
    ...input,
    type: "about:blank",
    title: titles[input.status] ?? "Request Failed",
  });
}

/** Deliberately excludes exception messages, credentials and provider response bodies. */
export function reportProblem(problem: ProblemDetail): void {
  if (problem.status < 500) return;
  try {
    console.error(
      "Application request failed",
      JSON.stringify({
        code: problem.code,
        status: problem.status,
        correlationId: problem.correlationId,
        instance: problem.instance,
      }),
    );
  } catch {
    // A failed diagnostic sink cannot replace the application response.
  }
}
