import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const host = "127.0.0.1";
const port = await reserveLoopbackPort();
const origin = `http://${host}:${port}`;
const output: string[] = [];
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: host,
    PORT: port,
    DATABASE_URL: undefined,
    BETTER_AUTH_SECRET: undefined,
    NODE_PG_FORCE_NATIVE: undefined,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
server.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
const startupError = new Promise<never>((_resolve, reject) => {
  server.once("error", (error) => {
    reject(
      new Error(
        `Generated-app server could not start: ${error.message}\n${output.join("")}`,
      ),
    );
  });
});

try {
  const page = await waitForResponse("/");
  assert.equal(page.status, 200, output.join(""));
  assert.match(await page.text(), /TanStack Starter/);

  const health = await waitForResponse("/api/v1/health", {
    headers: { "API-Version": "1" },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("API-Version"), "1");
  assert.match(health.headers.get("X-Correlation-ID") ?? "", /^corr_/);
  assert.deepEqual(await health.json(), {
    service: "generated-app",
    status: "ok",
    version: 1,
  });

  const openApi = await waitForResponse("/api/v1/openapi.json", {
    headers: { "API-Version": "1" },
  });
  assert.equal(openApi.status, 200);
  assert.equal(((await openApi.json()) as { openapi: string }).openapi, "3.1.0");

  const protectedPage = await waitForResponse("/protected");
  assert.equal(protectedPage.status, 200);
  const protectedMarkup = await protectedPage.text();
  assert.match(protectedMarkup, /Authentication required/);
  assert.doesNotMatch(protectedMarkup, /Sign in with/);

  const staleCookiePage = await waitForResponse("/protected", {
    headers: { Cookie: "generated-app.session_token=stale" },
  });
  assert.equal(staleCookiePage.status, 200);
  assert.match(await staleCookiePage.text(), /Identity service unavailable/);

  const unconfiguredAuth = await waitForResponse("/api/auth/get-session");
  assert.equal(unconfiguredAuth.status, 503);
  assert.match(
    unconfiguredAuth.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
  );

  console.log(
    "Verified generated-app SSR, public API, OpenAPI, and protected identity routes",
  );
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

async function waitForResponse(
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(
        `Generated-app server exited with ${server.exitCode}:\n${output.join("")}`,
      );
    }
    try {
      return await Promise.race([fetch(`${origin}${pathname}`, init), startupError]);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(
    `Generated-app server did not become ready: ${String(lastError)}\n${output.join("")}`,
  );
}

async function reserveLoopbackPort(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, host, resolve);
  });
  const address = probe.address();
  assert(address !== null && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return String(address.port);
}
