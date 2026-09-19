import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { CookieJar } from "tough-cookie";
import { startNeonAuthTestService } from "./neon-auth-test-service";

let provider: Awaited<ReturnType<typeof startNeonAuthTestService>>;
let application: ChildProcess;
let origin: string;
let providerOrigin: string;
const output: string[] = [];
before(async () => {
  provider = await startNeonAuthTestService();
  providerOrigin = provider.origin;
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const appAddress = probe.address();
  assert.ok(appAddress && typeof appAddress === "object");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  origin = `http://127.0.0.1:${appAddress.port}`;
  application = spawn(process.execPath, [".output/server/index.mjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(appAddress.port),
      NODE_ENV: "test",
      VERCEL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_URL: undefined,
      DATABASE_URL: undefined,
      BETTER_AUTH_SECRET: undefined,
      NEON_AUTH_BASE_URL: `${providerOrigin}/auth`,
      VITE_NEON_AUTH_URL: `${providerOrigin}/auth`,
      NEON_AUTH_COOKIE_SECRET: "isolated-managed-auth-cookie-secret-for-tests",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  application.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  application.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assert.equal(application.exitCode, null, output.join(""));
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* Wait for this exact child to listen. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Managed auth test application did not start: ${output.join("")}`);
});

after(async () => {
  if (application && application.exitCode === null) {
    const exited = once(application, "exit");
    application.kill("SIGTERM");
    await exited;
  }
  await provider?.close();
});

describe("managed Neon authentication through the built application", () => {
  it("renders standard auth views and carries a real registration cookie into protected SSR", async () => {
    for (const [path, heading] of [
      ["/auth/sign-in", "Sign in"],
      ["/auth/sign-up", "Create your account"],
    ]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(heading!));
    }
    const jar = new CookieJar();
    await jar.setCookie("analytics=private-application-cookie; Path=/", origin);
    const response = await call(jar, "/api/auth/sign-up/email", {
      name: "Alice Example",
      email: "alice@example.test",
      password: "password-for-test",
    });
    assert.equal(response.status, 200, output.join(""));
    assert.equal(
      ((await response.json()) as { user: { name: string } }).user.name,
      "Alice Example",
    );
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(
      await jar.getCookieString(origin),
      /__Secure-neon-auth\.session_token=/,
    );
    assert.equal(
      await jar.getCookieString(providerOrigin),
      "",
      "Provider cookies must belong to the application origin",
    );
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const page = await call(jar, "/protected");
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Alice Example/);
    }
    assert.ok(
      provider.receivedCookies.every(
        (cookie) =>
          !cookie.includes("analytics") &&
          !cookie.includes("private-application-cookie"),
      ),
    );
  });

  it("isolates two signed-in users, invalidates old sessions, and signs out through the same origin", async () => {
    const alice = new CookieJar(),
      bob = new CookieJar();
    assert.equal(
      (
        await call(alice, "/api/auth/sign-in/email", {
          email: "alice@example.test",
          password: "password-for-test",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(bob, "/api/auth/sign-up/email", {
          name: "Bob Example",
          email: "bob@example.test",
          password: "password-for-test",
        })
      ).status,
      200,
    );
    const pages = await Promise.all([
      call(alice, "/protected"),
      call(bob, "/protected"),
    ]);
    const [alicePage, bobPage] = await Promise.all(pages.map((page) => page.text()));
    assert.match(alicePage!, /Alice Example/);
    assert.doesNotMatch(alicePage!, /Bob Example/);
    assert.match(bobPage!, /Bob Example/);
    assert.doesNotMatch(bobPage!, /Alice Example/);
    const stale = await CookieJar.deserialize(await alice.serialize());
    const signedOut = await call(alice, "/api/auth/sign-out", {});
    assert.equal(signedOut.status, 200);
    assert.doesNotMatch(await alice.getCookieString(origin), /neon-auth/);
    assert.match(
      await (await call(alice, "/protected")).text(),
      /Authentication required/,
    );
    // A still-signed cache cookie cannot revive the now-revoked server session.
    assert.equal(await (await call(stale, "/api/auth/get-session")).json(), null);
    assert.match(
      await (await call(stale, "/protected")).text(),
      /Authentication required/,
    );
    const privateApi = await call(
      stale,
      "/api/v1/projects/550e8400-e29b-41d4-a716-446655440000/protected-feature",
    );
    assert.equal(privateApi.status, 401);
    assert.match(await (await call(bob, "/protected")).text(), /Bob Example/);
  });

  it("keeps rejected credentials signed out and rejects cross-origin mutations", async () => {
    const jar = new CookieJar();
    const rejected = await call(jar, "/api/auth/sign-in/email", {
      email: "alice@example.test",
      password: "wrong-password",
    });
    assert.equal(rejected.status, 401);
    assert.equal(await jar.getCookieString(origin), "");
    const foreign = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        Origin: "https://unrelated.example.test",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
  });
});

async function call(jar: CookieJar, path: string, body?: Record<string, string>) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: await jar.getCookieString(origin),
      Origin: origin,
      "Content-Type": "application/json",
      "API-Version": "1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const cookie of response.headers.getSetCookie())
    await jar.setCookie(cookie, origin);
  return response;
}
