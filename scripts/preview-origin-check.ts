import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { get, type IncomingMessage } from "node:http";
import { createServer } from "node:net";

/** Exercises Vercel URL inputs against a local built server, never a deployment. */
export async function verifyPreviewOrigins() {
  for (const deployment of [
    "app-build-a-team.vercel.app",
    "app-build-b-team.vercel.app",
  ]) {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    assert.ok(address && typeof address === "object");
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const origin = `http://127.0.0.1:${address.port}`;
    const output: string[] = [];
    const child = spawn(process.execPath, [".output/server/index.mjs"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(address.port),
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_URL: deployment,
        VERCEL_BRANCH_URL: "app-git-develop-team.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "production.example.test",
        NEON_AUTH_BASE_URL: undefined,
        VITE_NEON_AUTH_URL: undefined,
        DATABASE_URL: undefined,
        BETTER_AUTH_SECRET: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        assert.equal(child.exitCode, null, output.join(""));
        try {
          const health = await fetch(`${origin}/api/v1/health`, {
            headers: { "API-Version": "1" },
          });
          ready = health.ok;
          if (ready) break;
        } catch {
          /* Only wait for this local child to listen. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, output.join(""));
      const alias = await fetch(`${origin}/?next=%2Fprotected`, {
        redirect: "manual",
        headers: { accept: "text/html" },
      });
      assert.equal(alias.status, 307);
      assert.equal(
        alias.headers.get("location"),
        `https://${deployment}/?next=%2Fprotected`,
      );
      assert.equal(alias.headers.get("cache-control"), "private, no-store");
      // Vercel terminates HTTPS before Nitro's Node adapter. Its internal HTTP
      // request for the canonical host must render instead of redirecting again.
      // Node's fetch replaces a supplied Host header, so use the HTTP client to
      // send the deployment host while connecting only to the loopback server.
      const canonical = await new Promise<IncomingMessage>((resolve, reject) => {
        get(
          origin,
          {
            headers: {
              accept: "text/html",
              host: deployment,
              "x-forwarded-proto": "https",
            },
          },
          (response) => {
            response.resume();
            resolve(response);
          },
        ).on("error", reject);
      });
      assert.equal(
        canonical.statusCode,
        200,
        `Canonical ${deployment} must not redirect repeatedly: ${canonical.headers.location}`,
      );
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  }
  console.log(
    "Verified local navigation for two simulated Vercel Preview URLs without redirect loops",
  );
}
