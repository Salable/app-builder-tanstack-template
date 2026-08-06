import http, { type ClientRequest } from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function installExternalNetworkDeny(): () => void {
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalNetConnect = net.connect;
  const originalNetCreateConnection = net.createConnection;
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalTlsConnect = tls.connect;

  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assertAllowed(input);
    return originalFetch(input, init);
  }) as typeof fetch;
  http.request = guardedRequest(originalHttpRequest);
  http.get = guardedRequest(originalHttpGet) as typeof http.get;
  https.request = guardedRequest(originalHttpsRequest);
  https.get = guardedRequest(originalHttpsGet) as typeof https.get;
  net.connect = guardedConnect(originalNetConnect);
  net.createConnection = guardedConnect(originalNetCreateConnection);
  net.Socket.prototype.connect = guardedConnect(originalSocketConnect);
  tls.connect = guardedConnect(originalTlsConnect);

  return () => {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    net.connect = originalNetConnect;
    net.createConnection = originalNetCreateConnection;
    net.Socket.prototype.connect = originalSocketConnect;
    tls.connect = originalTlsConnect;
  };
}

function guardedConnect<T extends (...arguments_: never[]) => unknown>(original: T): T {
  return function guarded(this: unknown, ...arguments_: unknown[]) {
    assertAllowedConnection(arguments_);
    return Reflect.apply(original, this, arguments_);
  } as unknown as T;
}

function assertAllowedConnection(arguments_: unknown[]): void {
  const first = arguments_[0];
  if (typeof first === "number" && typeof arguments_[1] === "string") {
    assertAllowed({ hostname: arguments_[1] });
    return;
  }
  assertAllowed(first);
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
  if (Array.isArray(target)) return targetHostname(target[0]);
  return undefined;
}

function normalizeHostname(host: string): string {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0] ?? host;
}
