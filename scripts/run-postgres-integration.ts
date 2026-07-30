import { spawn } from "node:child_process";

const IMAGE =
  "postgres@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7";
const suppliedDatabaseUrl = process.env.APP_BUILDER_TEST_DATABASE_URL;
const containerName = `app-builder-postgres-${process.pid}`;
let startedContainer = false;

try {
  if (suppliedDatabaseUrl !== undefined) {
    const hostname = new URL(suppliedDatabaseUrl).hostname;
    if (!["127.0.0.1", "::1", "localhost"].includes(hostname)) {
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
