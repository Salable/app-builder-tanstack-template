import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  ProblemDetailSchema,
  ProjectResponseSchema,
  ProtectedFeatureResponseSchema,
} from "../src/api/contracts";
import { PostgresDatabase } from "../src/persistence/database";
import { migrateToLatest, rollbackLastMigration } from "../src/persistence/migrator";
import { installExternalNetworkDeny } from "./network-deny";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required for the PostgreSQL integration suite.");
}

const host = "127.0.0.1";
const port = "4312";
const origin = `http://${host}:${port}`;
const database = new PostgresDatabase(databaseUrl);
const serverOutput: string[] = [];
const restoreNetwork = installExternalNetworkDeny();
const entitledOrganizationId = "11111111-1111-4111-8111-111111111111";
const unentitledOrganizationId = "22222222-2222-4222-8222-222222222222";
const ownedProjectId = "33333333-3333-4333-8333-333333333333";
const unentitledProjectId = "44444444-4444-4444-8444-444444444444";
let server: ChildProcess | undefined;

before(async () => {
  await waitForDatabase();
  await database.query(
    `DROP TABLE IF EXISTS
       app_builder_migrations,
       projects,
       organization_memberships,
       organizations,
       "verification",
       "account",
       "session",
       "user"
     CASCADE`,
  );

  assert.deepEqual(
    (await migrateToLatest(database)).map(({ version }) => version),
    ["0001", "0002", "0003"],
  );
  await database.query(
    `INSERT INTO projects (id, name, normalized_name)
     VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), "Recovery Proof", "recovery proof"],
  );

  assert.equal((await rollbackLastMigration(database))?.version, "0003");
  const afterIdentityRollback = await database.query<{ name: string }>(
    "SELECT name FROM projects WHERE normalized_name = $1",
    ["recovery proof"],
  );
  assert.equal(afterIdentityRollback.rows[0]?.name, "Recovery Proof");

  assert.equal((await rollbackLastMigration(database))?.version, "0002");
  const beforeRecovery = await database.query<{ name: string }>(
    "SELECT name FROM projects WHERE normalized_name = $1",
    ["recovery proof"],
  );
  assert.equal(beforeRecovery.rows[0]?.name, "Recovery Proof");

  assert.deepEqual(
    (await migrateToLatest(database)).map(({ version }) => version),
    ["0001", "0002", "0003"],
  );
  const afterRecovery = await database.query<{ revision: number }>(
    "SELECT revision FROM projects WHERE normalized_name = $1",
    ["recovery proof"],
  );
  assert.equal(afterRecovery.rows[0]?.revision, 1);
  await database.query("TRUNCATE projects");

  server = spawn(process.execPath, [".output/server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME: "rollback proof",
      APP_BUILDER_TEST_AUTH: "email-password",
      APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS: entitledOrganizationId,
      BETTER_AUTH_SECRET: "postgres-integration-secret-with-32-characters",
      BETTER_AUTH_URL: origin,
      DATABASE_URL: databaseUrl,
      HOST: host,
      NODE_ENV: "test",
      PORT: port,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString()));
  server.stderr?.on("data", (chunk: Buffer) => serverOutput.push(chunk.toString()));
  await waitForServer();
});

after(async () => {
  server?.kill("SIGTERM");
  if (server !== undefined) {
    await Promise.race([
      new Promise<void>((resolve) => server?.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await database.close();
  restoreNetwork();
});

describe("generated application PostgreSQL boundary", () => {
  it("rehearses transactional rollback and forward recovery", async () => {
    const migrations = await database.query<{ version: string }>(
      "SELECT version FROM app_builder_migrations ORDER BY version",
    );
    assert.deepEqual(
      migrations.rows.map(({ version }) => version),
      ["0001", "0002", "0003"],
    );
  });

  it("covers every documented health and project outcome through HTTP", async () => {
    const health = await fetch(`${origin}/api/v1/health`, {
      headers: { "X-Correlation-ID": "corr_postgres" },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("API-Version"), "1");
    assert.equal(health.headers.get("X-Correlation-ID"), "corr_postgres");

    const unsupported = await postProject({ name: "Unsupported" }, "2");
    await assertProblem(unsupported, 400, "unsupported-api-version");

    const invalid = await postProject({ name: "x", unexpected: true });
    await assertProblem(invalid, 400, "invalid-request");

    const created = await postProject({ name: "Alpha Project" });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("API-Version"), "1");
    const project = ProjectResponseSchema.parse(await created.json());
    assert.equal(project.name, "Alpha Project");
    assert.equal(project.revision, 1);

    const persisted = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM projects WHERE id = $1",
      [project.id],
    );
    assert.equal(persisted.rows[0]?.count, "1");

    const conflict = await postProject({ name: "alpha project" });
    await assertProblem(conflict, 409, "project-name-conflict");

    const failed = await postProject({ name: "Rollback Proof" });
    const failureBody = await assertProblem(failed, 500, "internal");
    assert.doesNotMatch(
      JSON.stringify(failureBody),
      /postgres|sql|insert|transaction|failure/i,
    );
    const rolledBack = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM projects WHERE normalized_name = $1",
      ["rollback proof"],
    );
    assert.equal(rolledBack.rows[0]?.count, "0");
  });

  it("proves database sessions and owner/tenant/entitlement isolation", async () => {
    const alice = await signUp(
      "Alice Owner",
      "alice@example.test",
      "correct horse battery staple",
    );
    const bob = await signUp(
      "Bob Member",
      "bob@example.test",
      "correct horse battery staple",
    );
    const carol = await signUp(
      "Carol Other Tenant",
      "carol@example.test",
      "correct horse battery staple",
    );

    await database.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES
         ($1, 'Entitled organization', 'entitled-organization'),
         ($2, 'Unentitled organization', 'unentitled-organization')`,
      [entitledOrganizationId, unentitledOrganizationId],
    );
    await database.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES
         ($1, $3, 'OWNER'),
         ($1, $4, 'MEMBER'),
         ($2, $5, 'OWNER')`,
      [
        entitledOrganizationId,
        unentitledOrganizationId,
        alice.userId,
        bob.userId,
        carol.userId,
      ],
    );
    await database.query(
      `INSERT INTO projects (
         id,
         name,
         normalized_name,
         organization_id,
         owner_user_id
       )
       VALUES
         ($1, 'Alice project', 'alice project', $3, $5),
         ($2, 'Carol project', 'carol project', $4, $6)`,
      [
        ownedProjectId,
        unentitledProjectId,
        entitledOrganizationId,
        unentitledOrganizationId,
        alice.userId,
        carol.userId,
      ],
    );

    await assertProblem(await getProtectedFeature(ownedProjectId), 401, "unauthorized");
    await assertProblem(
      await getProtectedFeature(ownedProjectId, bob.cookie),
      404,
      "not-found",
    );
    await assertProblem(
      await getProtectedFeature(ownedProjectId, carol.cookie),
      404,
      "not-found",
    );
    await assertProblem(
      await getProtectedFeature(unentitledProjectId, carol.cookie),
      403,
      "entitlement-required",
    );

    const allowed = await getProtectedFeature(ownedProjectId, alice.cookie);
    assert.equal(allowed.status, 200);
    assert.deepEqual(ProtectedFeatureResponseSchema.parse(await allowed.json()), {
      capability: "protected-insights",
      projectId: ownedProjectId,
      status: "available",
    });

    const protectedPage = await fetch(`${origin}/protected`, {
      headers: { Cookie: alice.cookie },
    });
    assert.equal(protectedPage.status, 200);
    const protectedMarkup = await protectedPage.text();
    assert.match(protectedMarkup, /Authenticated identity/);
    assert.match(protectedMarkup, /Alice Owner/);
    assert.doesNotMatch(protectedMarkup, /Authentication required/);

    await database.query(`DELETE FROM "session" WHERE "userId" = $1`, [alice.userId]);
    await assertProblem(
      await getProtectedFeature(ownedProjectId, alice.cookie),
      401,
      "unauthorized",
    );

    const signOut = await fetch(`${origin}/api/auth/sign-out`, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: bob.cookie,
        Origin: origin,
      },
      method: "POST",
    });
    assert.equal(signOut.status, 200);
    await assertProblem(
      await getProtectedFeature(ownedProjectId, bob.cookie),
      401,
      "unauthorized",
    );
  });

  it("actively denies undeclared third-party network access", () => {
    assert.throws(
      () => fetch("https://api.example.test/should-not-run"),
      /External network access denied/,
    );
  });
});

type TestIdentity = {
  cookie: string;
  userId: string;
};

async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<TestIdentity> {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, {
    body: JSON.stringify({ email, name, password }),
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    method: "POST",
  });
  if (response.status !== 200) {
    assert.fail(`Sign-up failed with ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { user?: { id?: unknown } };
  const userId = body.user?.id;
  if (typeof userId !== "string") {
    assert.fail("Better Auth sign-up response did not contain a user ID.");
  }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter((value): value is string => value !== undefined)
    .join("; ");
  assert.match(cookie, /generated-app\.session_token=/);
  return { cookie, userId };
}

function getProtectedFeature(projectId: string, cookie?: string): Promise<Response> {
  const headers = new Headers({ "API-Version": "1" });
  if (cookie !== undefined) headers.set("Cookie", cookie);
  return fetch(`${origin}/api/v1/projects/${projectId}/protected-feature`, {
    headers,
  });
}

async function postProject(
  body: Record<string, unknown>,
  apiVersion = "1",
): Promise<Response> {
  return fetch(`${origin}/api/v1/projects`, {
    body: JSON.stringify(body),
    headers: {
      "API-Version": apiVersion,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function assertProblem(
  response: Response,
  status: number,
  typeSuffix: string,
): Promise<unknown> {
  assert.equal(response.status, status);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
  );
  return response.json().then((body) => {
    const problem = ProblemDetailSchema.parse(body);
    assert.match(problem.type, new RegExp(`/${typeSuffix}$`));
    assert.equal(problem.status, status);
    return problem;
  });
}

async function waitForDatabase(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await database.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${String(lastError)}`);
}

async function waitForServer(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server?.exitCode !== null) {
      throw new Error(
        `Generated-app server exited with ${String(server?.exitCode)}:\n${serverOutput.join("")}`,
      );
    }
    try {
      const response = await fetch(`${origin}/api/v1/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Generated-app server did not become ready: ${String(lastError)}\n${serverOutput.join("")}`,
  );
}
