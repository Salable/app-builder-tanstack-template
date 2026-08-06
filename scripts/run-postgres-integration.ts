import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const IMAGE =
  "postgres@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7";
const suppliedDatabaseUrl = process.env.APP_BUILDER_TEST_DATABASE_URL;
const containerName = `app-builder-postgres-${process.pid}`;
let startedContainer = false;

try {
  if (suppliedDatabaseUrl !== undefined) {
    if (process.env.APP_BUILDER_TEST_DISPOSABLE_DATABASE !== "1") {
      throw new Error(
        "APP_BUILDER_TEST_DISPOSABLE_DATABASE=1 is required for a supplied database.",
      );
    }
    const parsed = new URL(suppliedDatabaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error("APP_BUILDER_TEST_DATABASE_URL must be a PostgreSQL URL.");
    }
    for (const key of parsed.searchParams.keys()) {
      if (["host", "hostaddr"].includes(key.toLowerCase())) {
        throw new Error("PostgreSQL host override parameters are not allowed.");
      }
    }
    if (decodeURIComponent(parsed.hostname).includes("/")) {
      throw new Error("PostgreSQL Unix socket hosts are not allowed.");
    }
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isLoopback(address))
    ) {
      throw new Error(
        "APP_BUILDER_TEST_DATABASE_URL must identify a disposable loopback database.",
      );
    }
  }
  const databaseUrl = suppliedDatabaseUrl ?? (await startContainer());
  const exitCode = await run(
    process.execPath,
    ["--import", "tsx", "--test", "scripts/postgres.integration.test.ts"],
    { DATABASE_URL: databaseUrl },
  );
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  if (startedContainer) {
    await run("docker", ["stop", "--timeout", "5", containerName]);
  }
}

function isLoopback(address: string): boolean {
  if (isIP(address) === 4) return address.startsWith("127.");
  return address === "::1" || address.toLowerCase().startsWith("::ffff:127.");
}

async function startContainer(): Promise<string> {
  const exitCode = await run("docker", [
    "run",
    "--rm",
    "--detach",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql",
    "--env",
    "POSTGRES_DB=generated_app",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    IMAGE,
  ]);
  if (exitCode !== 0) throw new Error("Could not start disposable PostgreSQL");
  startedContainer = true;

  const output = await capture("docker", ["port", containerName, "5432/tcp"]);
  const port = output.trim().match(/:(\d+)$/)?.[1];
  if (port === undefined) {
    throw new Error(`Could not resolve the PostgreSQL port: ${output}`);
  }
  return `postgresql://postgres@127.0.0.1:${port}/generated_app`;
}

function run(
  command: string,
  arguments_: string[],
  environment: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function capture(command: string, arguments_: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}
