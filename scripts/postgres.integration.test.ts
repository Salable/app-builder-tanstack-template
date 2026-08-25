import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import {
  ProblemDetailSchema,
  ProjectResponseSchema,
  ProtectedFeatureResponseSchema,
} from "../src/api/contracts";
import { PostgresDatabase } from "../src/persistence/database";
import { migrateToLatest, rollbackLastMigration } from "../src/persistence/migrator";
import { PostgresProjectAccessRepository } from "../src/authorization/project-access";
import { installExternalNetworkDeny } from "./network-deny";
import {
  FoundationPersistenceConflictError,
  PostgresInvitationSeatRepository,
} from "../src/foundation/seat-management/postgres.ts";

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
       foundation_seat_assignments,
       foundation_seat_reservations,
       foundation_organization_invitations,
       foundation_seat_ledgers,
       projects,
       organization_memberships,
       organizations,
       "verification",
       "account",
       "session",
       "user"
     CASCADE`,
  );

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts.migrate, "node --import tsx scripts/migrate.ts");
  const previewDeployment = spawnSync("npm", ["run", "deploy:vercel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      APP_BUILDER_DELIVERY_STAGE: "PREVIEW",
      DATABASE_URL: databaseUrl,
    },
  });
  assert.equal(
    previewDeployment.status,
    0,
    previewDeployment.stderr || previewDeployment.stdout,
  );
  const deployedTables = await database.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'app_builder_migrations',
          'foundation_seat_ledgers',
          'projects',
          'user'
        )
      ORDER BY table_name`,
  );
  assert.deepEqual(
    deployedTables.rows.map(({ table_name }) => table_name),
    ["app_builder_migrations", "foundation_seat_ledgers", "projects", "user"],
  );
  const deploymentEnvironment = { ...process.env };
  delete deploymentEnvironment.DATABASE_URL;
  deploymentEnvironment.APP_BUILDER_DELIVERY_STAGE = "PRODUCTION";
  const deployment = spawnSync("npm", ["run", "deploy:vercel"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: deploymentEnvironment,
  });
  assert.equal(deployment.status, 0, deployment.stderr || deployment.stdout);
  const runtimeBuild = spawnSync("npm", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: deploymentEnvironment,
  });
  assert.equal(runtimeBuild.status, 0, runtimeBuild.stderr || runtimeBuild.stdout);
  await database.query(
    `DROP TABLE IF EXISTS
       app_builder_migrations,
       foundation_seat_assignments,
       foundation_seat_reservations,
       foundation_organization_invitations,
       foundation_seat_ledgers,
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
    ["0001"],
  );
  await database.query(
    `INSERT INTO "user" (id, name, email, "emailVerified")
       VALUES ('recovery-user', 'Recovery Owner', 'recovery@example.test', true);
     INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId")
       VALUES ('recovery-session', now() + interval '1 day', 'recovery-token', now(), 'recovery-user');
     INSERT INTO "account" (id, "accountId", "providerId", "userId", "updatedAt")
       VALUES ('recovery-account', 'recovery-provider-account', 'credential', 'recovery-user', now());
     INSERT INTO "verification" (id, identifier, value, "expiresAt")
       VALUES ('recovery-verification', 'recovery@example.test', 'proof', now() + interval '1 day');
     INSERT INTO organizations (id, name, slug)
       VALUES ('55555555-5555-4555-8555-555555555555', 'Recovery Organization', 'recovery-organization');
     INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ('55555555-5555-4555-8555-555555555555', 'recovery-user', 'OWNER');
     INSERT INTO projects (id, name, normalized_name, organization_id, owner_user_id)
       VALUES ('66666666-6666-4666-8666-666666666666', 'Recovery Proof', 'recovery proof',
         '55555555-5555-4555-8555-555555555555', 'recovery-user')`,
  );

  const currentRelationships = await database.query<{
    user_id: string;
    session_user_id: string;
    account_user_id: string;
    verification_id: string;
    organization_id: string;
    membership_user_id: string;
    owner_user_id: string;
  }>(
    `SELECT u.id AS user_id, s."userId" AS session_user_id,
            a."userId" AS account_user_id, v.id AS verification_id,
            o.id AS organization_id, m.user_id AS membership_user_id,
            p.owner_user_id
     FROM "user" u
     JOIN "session" s ON s."userId" = u.id
     JOIN "account" a ON a."userId" = u.id
     JOIN "verification" v ON v.identifier = u.email
     JOIN organization_memberships m ON m.user_id = u.id
     JOIN organizations o ON o.id = m.organization_id
     JOIN projects p ON p.organization_id = o.id AND p.owner_user_id = u.id
     WHERE u.id = 'recovery-user'`,
  );
  assert.deepEqual(currentRelationships.rows[0], {
    user_id: "recovery-user",
    session_user_id: "recovery-user",
    account_user_id: "recovery-user",
    verification_id: "recovery-verification",
    organization_id: "55555555-5555-4555-8555-555555555555",
    membership_user_id: "recovery-user",
    owner_user_id: "recovery-user",
  });
  const currentAccess = await new PostgresProjectAccessRepository(
    database,
  ).findOwnedProject("66666666-6666-4666-8666-666666666666", "recovery-user");
  assert.deepEqual(currentAccess, {
    organizationId: "55555555-5555-4555-8555-555555555555",
    projectId: "66666666-6666-4666-8666-666666666666",
  });

  assert.equal((await rollbackLastMigration(database))?.version, "0001");
  const rolledBackSchema = await database.query<{ projects: string | null }>(
    "SELECT to_regclass('public.projects')::text AS projects",
  );
  assert.equal(rolledBackSchema.rows[0]?.projects, null);
  assert.deepEqual(
    (await migrateToLatest(database)).map(({ version }) => version),
    ["0001"],
  );

  server = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./scripts/network-deny-preload.ts",
      ".output/server/index.mjs",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_BUILDER_TEST_FAULT_AFTER_INSERT_NAME: "rollback proof",
        APP_BUILDER_TEST_NETWORK_DENY_PROOF: "1",
        APP_BUILDER_TEST_AUTH: "email-password",
        APP_BUILDER_TEST_ENTITLED_ORGANIZATION_IDS: entitledOrganizationId,
        APP_ENVIRONMENT_ID: "environment_preview_integration",
        BETTER_AUTH_SECRET: "postgres-integration-secret-with-32-characters",
        BETTER_AUTH_URL: origin,
        DATABASE_URL: databaseUrl,
        HOST: host,
        NODE_ENV: "test",
        PORT: port,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
      ["0001"],
    );
  });

  it("serializes invitation acceptance, revocation, removal, and provider reconciliation", async () => {
    const organisationId = "55555555-5555-4555-8555-555555555555";
    const ownerUserId = "foundation-owner";
    const memberUserId = "foundation-member";
    await database.query(
      `INSERT INTO "user" (
         "id", "name", "email", "emailVerified", "createdAt", "updatedAt"
       ) VALUES
         ($1, 'Foundation Owner', 'foundation-owner@example.test', true, now(), now()),
         ($2, 'Foundation Member', 'foundation-member@example.test', true, now(), now())`,
      [ownerUserId, memberUserId],
    );
    await database.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, 'Foundation proof', 'foundation-proof')`,
      [organisationId],
    );
    await database.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'OWNER')`,
      [organisationId, ownerUserId],
    );

    const repository = new PostgresInvitationSeatRepository(database);
    assert.equal((await repository.createSeatLedger(organisationId, 1)).revision, 0);
    const acceptedCandidate = await repository.createInvitation({
      invitationId: "invitation_postgres_accept",
      organisationId,
      invitedEmail: " Foundation-Member@Example.Test ",
      role: "member",
      tokenSha256: "7".repeat(64),
      expiresAtEpochMs: Date.now() + 60_000,
      nowEpochMs: Date.now(),
      actorUserId: ownerUserId,
      expectedLedgerRevision: 0,
    });
    assert.equal(acceptedCandidate.ledger.revision, 1);

    const acceptanceInput = {
      identity: { userId: memberUserId },
      verifiedEmail: "foundation-member@example.test",
      tokenSha256: "7".repeat(64),
      expectedInvitationRevision: 0,
      expectedLedgerRevision: 1,
      nowEpochMs: Date.now(),
    } as const;
    const competingAcceptances = await Promise.allSettled([
      repository.acceptInvitation(acceptanceInput),
      repository.acceptInvitation(acceptanceInput),
    ]);
    const accepted = competingAcceptances.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = competingAcceptances.filter(
      (result) => result.status === "rejected",
    );
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0]?.status === "rejected" &&
        rejected[0].reason instanceof FoundationPersistenceConflictError,
    );
    assert.equal(
      accepted[0]?.status === "fulfilled"
        ? accepted[0].value.ledger.revision
        : undefined,
      2,
    );
    const allocation = await database.query<{
      reservations: string;
      assignments: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM foundation_seat_reservations
          WHERE organization_id = $1) AS reservations,
         (SELECT count(*)::text FROM foundation_seat_assignments
          WHERE organization_id = $1) AS assignments`,
      [organisationId],
    );
    assert.deepEqual(allocation.rows[0], {
      reservations: "0",
      assignments: "1",
    });

    const afterRemoval = await repository.removeMembership({
      organisationId,
      actorUserId: ownerUserId,
      memberUserId,
      expectedLedgerRevision: 2,
    });
    assert.equal(afterRemoval.revision, 3);
    assert.deepEqual(afterRemoval.assignments, []);

    const revokedCandidate = await repository.createInvitation({
      invitationId: "invitation_postgres_revoke",
      organisationId,
      invitedEmail: "unused@example.test",
      role: "member",
      tokenSha256: "8".repeat(64),
      expiresAtEpochMs: Date.now() + 60_000,
      nowEpochMs: Date.now(),
      actorUserId: ownerUserId,
      expectedLedgerRevision: 3,
    });
    assert.equal(revokedCandidate.ledger.revision, 4);
    const revoked = await repository.revokeInvitation({
      organisationId,
      invitationId: revokedCandidate.invitation.invitationId,
      actorUserId: ownerUserId,
      expectedInvitationRevision: 0,
      expectedLedgerRevision: 4,
    });
    assert.equal(revoked.invitation.status, "REVOKED");
    assert.equal(revoked.ledger.revision, 5);

    await assert.rejects(
      repository.reconcilePurchased({
        organisationId,
        purchased: -1,
        expectedLedgerRevision: 5,
      }),
      FoundationPersistenceConflictError,
    );
    const reconciled = await repository.reconcilePurchased({
      organisationId,
      purchased: 0,
      expectedLedgerRevision: 5,
    });
    assert.equal(reconciled.purchased, 0);
    assert.equal(reconciled.revision, 6);
  });

  it("covers every documented health and project outcome through HTTP", async () => {
    const health = await fetch(`${origin}/api/v1/health`, {
      headers: {
        "API-Version": "1",
        "X-Correlation-ID": "corr_postgres",
      },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("API-Version"), "1");
    assert.equal(health.headers.get("X-Correlation-ID"), "corr_postgres");

    const unsupported = await postProject({ name: "Unsupported" }, "2");
    await assertProblem(unsupported, 400, "unsupported-api-version");

    const invalid = await postProject({ name: "x", unexpected: true });
    await assertProblem(invalid, 400, "invalid-request");
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

    await assertProblem(
      await postProject({ name: "No session" }, "1", entitledOrganizationId),
      401,
      "unauthorized",
    );
    await assertProblem(
      await postProject(
        { name: "Wrong tenant" },
        "1",
        unentitledOrganizationId,
        alice.cookie,
      ),
      403,
      "forbidden",
    );

    const created = await postProject(
      { name: "Alpha Project" },
      "1",
      entitledOrganizationId,
      alice.cookie,
    );
    assert.equal(created.status, 201);
    const project = ProjectResponseSchema.parse(await created.json());
    const persisted = await database.query<{
      organization_id: string;
      owner_user_id: string;
    }>("SELECT organization_id, owner_user_id FROM projects WHERE id = $1", [
      project.id,
    ]);
    assert.deepEqual(persisted.rows[0], {
      organization_id: entitledOrganizationId,
      owner_user_id: alice.userId,
    });
    const newlyCreatedFeature = await getProtectedFeature(project.id, alice.cookie);
    assert.equal(newlyCreatedFeature.status, 200);

    for (const name of ["   ", "Trailing spaces   "]) {
      const whitespaceName = await postProject(
        { name },
        "1",
        entitledOrganizationId,
        alice.cookie,
      );
      assert.equal(whitespaceName.status, 201);
      const whitespaceProject = ProjectResponseSchema.parse(
        await whitespaceName.json(),
      );
      assert.equal(whitespaceProject.name, name);
      const persistedWhitespaceName = await database.query<{ name: string }>(
        "SELECT name FROM projects WHERE id = $1",
        [whitespaceProject.id],
      );
      assert.equal(persistedWhitespaceName.rows[0]?.name, name);
    }

    await assertProblem(
      await postProject(
        { name: "alpha project" },
        "1",
        entitledOrganizationId,
        alice.cookie,
      ),
      409,
      "project-name-conflict",
    );
    const sameNameInOtherOrganization = await postProject(
      { name: "ALPHA PROJECT" },
      "1",
      unentitledOrganizationId,
      carol.cookie,
    );
    assert.equal(sameNameInOtherOrganization.status, 201);
    ProjectResponseSchema.parse(await sameNameInOtherOrganization.json());

    const failed = await postProject(
      { name: "Rollback Proof" },
      "1",
      entitledOrganizationId,
      alice.cookie,
    );
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

  it("denies undeclared third-party network access in the application process", async () => {
    const response = await fetch(`${origin}/api/v1/test/network-deny-proof`, {
      headers: { "API-Version": "1" },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /External network access denied/);
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
  organizationId?: string,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({
    "API-Version": apiVersion,
    "Content-Type": "application/json",
  });
  if (organizationId !== undefined) headers.set("X-Organization-ID", organizationId);
  if (cookie !== undefined) headers.set("Cookie", cookie);
  return fetch(`${origin}/api/v1/projects`, {
    body: JSON.stringify(body),
    headers,
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
      const response = await fetch(`${origin}/api/v1/health`, {
        headers: { "API-Version": "1" },
      });
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
