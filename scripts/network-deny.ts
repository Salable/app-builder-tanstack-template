import http, { type ClientRequest } from "node:http";
import https from "node:https";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function installExternalNetworkDeny(): () => void {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;

  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assertAllowed(input);
    return originalFetch(input, init);
  }) as typeof fetch;
  http.request = guardedRequest(originalHttpRequest);
  https.request = guardedRequest(originalHttpsRequest);

  return () => {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  };
}

function guardedRequest(original: typeof http.request): typeof http.request {
  return function guarded(this: unknown, ...arguments_: unknown[]): ClientRequest {
    assertAllowed(arguments_[0]);
    return Reflect.apply(original, this, arguments_) as ClientRequest;
  } as typeof http.request;
}

function assertAllowed(target: unknown): void {
  const hostname = targetHostname(target);
  if (hostname === undefined || LOOPBACK_HOSTS.has(hostname)) return;
  throw new Error(
    `External network access denied during integration tests: ${hostname}`,
  );
}

function targetHostname(target: unknown): string | undefined {
  if (target instanceof URL) return target.hostname;
  if (typeof target === "string") return new URL(target).hostname;
  if (target instanceof Request) return new URL(target.url).hostname;
  if (typeof target === "object" && target !== null) {
    if ("hostname" in target && typeof target.hostname === "string") {
      return normalizeHostname(target.hostname);
    }
    if ("host" in target && typeof target.host === "string") {
      return normalizeHostname(target.host);
    }
  }
  return undefined;
}

function normalizeHostname(host: string): string {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0] ?? host;
}
