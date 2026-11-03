import { reportError } from "./error-logger";

const reported = new WeakSet<object>();
const installations = new WeakMap<Window, () => void>();

/** One record per error, whether a UI owner catches it or it reaches the root. */
export function reportBrowserError(
  error: unknown,
  context: {
    operation: string;
    code: string;
    correlationId?: string;
    status?: number;
  },
): void {
  if (error !== null && typeof error === "object") {
    if (reported.has(error)) return;
    reported.add(error);
  }
  reportError(error, { source: "browser", ...context });
}

/** Registers before routing starts; does not suppress the browser's own errors. */
export function installBrowserErrorLogging(target: Window): () => void {
  const existing = installations.get(target);
  if (existing) return existing;
  const onError = (event: ErrorEvent) => {
    reportBrowserError(event.error, {
      operation: "browser.uncaught",
      code: "UNHANDLED_BROWSER_ERROR",
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportBrowserError(event.reason, {
      operation: "browser.promise",
      code: "UNHANDLED_REJECTION",
    });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  const uninstall = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    installations.delete(target);
  };
  installations.set(target, uninstall);
  return uninstall;
}
