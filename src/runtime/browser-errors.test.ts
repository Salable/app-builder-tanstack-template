// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserErrorLogging, reportBrowserError } from "./browser-errors";
import { apiFetch } from "../api/fetch-mutator";

afterEach(() => {
  installBrowserErrorLogging(window)();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser error ownership", () => {
  it("captures uncaught errors and rejected promises once, without private contents", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dispose = installBrowserErrorLogging(window);
    expect(installBrowserErrorLogging(window)).toBe(dispose);
    const error = new TypeError("private email, token and URL");
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: error });
    window.dispatchEvent(rejection);
    reportBrowserError(error, {
      operation: "router.render",
      code: "ROUTE_RENDER_FAILED",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      source: "browser",
      code: "UNHANDLED_BROWSER_ERROR",
      error: { type: "TypeError" },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    dispose();
    window.dispatchEvent(new ErrorEvent("error", { message: "after disposal" }));
    expect(log).toHaveBeenCalledOnce();
  });

  it("captures an otherwise unhandled promise and preserves behavior when the console fails", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installBrowserErrorLogging(window);
    const rejection = new Event("unhandledrejection", { cancelable: true });
    Object.defineProperty(rejection, "reason", {
      value: new Error("private rejection"),
    });
    expect(window.dispatchEvent(rejection)).toBe(true);
    expect(rejection.defaultPrevented).toBe(false);
    expect(JSON.parse(log.mock.calls[0]![0]).code).toBe("UNHANDLED_REJECTION");
    log.mockImplementation(() => {
      throw new Error("sink failure");
    });
    expect(() =>
      reportBrowserError(new Error("failure"), {
        operation: "browser.promise",
        code: "UNHANDLED_REJECTION",
      }),
    ).not.toThrow();
  });

  it("records a caught API failure with the same server reference without logging its public detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const problem = {
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      detail: "private example detail",
      code: "PROVIDER_UNAVAILABLE",
      instance: "/api/v1/projects/private-user",
      correlationId: "corr_test",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(problem, { status: 503 })),
    );
    const result = apiFetch("/api/v1/projects/private-user?token=private", {});
    await expect(result).rejects.toMatchObject({ status: 503, problem });
    const error = await result.catch((value: unknown) => value);
    reportBrowserError(error, {
      operation: "router.render",
      code: "ROUTE_RENDER_FAILED",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      source: "browser",
      operation: "api.request",
      code: "PROVIDER_UNAVAILABLE",
      correlationId: "corr_test",
      status: 503,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("keeps successful API requests quiet and retains transport causes on failed requests", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "ok" }))
      .mockRejectedValueOnce(new TypeError("private connection URL"));
    vi.stubGlobal("fetch", fetch);
    await expect(apiFetch("/api/v1/health", {})).resolves.toEqual({ status: "ok" });
    expect(log).not.toHaveBeenCalled();
    await expect(apiFetch("/api/v1/health", {})).rejects.toMatchObject({
      problem: { code: "TRANSPORT_UNAVAILABLE" },
    });
    expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({
      code: "TRANSPORT_UNAVAILABLE",
      error: { type: "ApiError", cause: { type: "TypeError" } },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
});
