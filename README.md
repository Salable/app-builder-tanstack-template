# TanStack Start generated-application template

This isolated workspace is the generated customer-application golden-path
spike. It uses TanStack Start SSR, Hono for every public API route, Tailwind,
Base UI wrappers, React Hook Form/Zod, TanStack Query, bounded client-only
Zustand state, Better Auth, OpenAPI 3.1, and an Orval-generated fetch/Query
client.

The deployed root page is intentionally a neutral readiness shell. It contains no
sample product, editable demo form, seeded customer data, or domain-specific call to
action. App Builder plans against this repository after connection and replaces that
shell with the requested product. The API, identity, organization, entitlement,
feature-flag, PostgreSQL, and deployment code below are reusable implementation seams,
not an example application presented to the end user.

In a generated standalone repository, run:

```sh
npm ci
npm run check
npm run dev
```

Within the App Builder Platform source workspace, append
`--workspace @app-builder/generated-tanstack-start` to package commands.

`npm run check` is the single authoritative local aggregate. It runs quality,
unit, integration, build, deployment-output, and SSR checks sequentially. The
named constituent scripts are useful for focused diagnosis and isolated CI jobs,
but must not run concurrently with `npm run check` or with another command that
shares generated files, build output, caches, ports, or the disposable database.
A focused diagnosis runs one constituent for one observed failure; do not rebuild
the aggregate by manually chaining several constituents. After the final change,
run `npm run check` once by itself and do not repeat its constituents after it
passes.

The public API is rooted at `/api/v1`. A missing `API-Version` header defaults
to version 1; unsupported versions return RFC 9457 Problem Details. Regenerate
the checked-in OpenAPI and TypeScript/TanStack Query client with:

```sh
npm run generate
```

## PostgreSQL

The provider-neutral persistence adapter uses `DATABASE_URL`. Apply paired,
checksum-protected migrations under a transaction-scoped advisory lock with:

```sh
npm run migrate
```

`migrate:rollback` reverses only the latest migration and is intended for a
reviewed recovery rehearsal, followed by the normal forward migration. Identity
migration 0003 cannot safely return to schema 0002, so its rollback retains the
identity schema and data while removing only its migration-ledger entry; its
idempotent forward migration restores that entry. The repository gate starts an
immutable-digest PostgreSQL 18.3 container, proves that identity, organization,
project ownership, invitation, seat, and authorization relationships survive
recovery, and exercises the built HTTP server against that database. No live
managed database is contacted.

The starter contains its runnable organization, invitation, and seat foundation
under `src/foundation`; it never imports source from the App Builder Platform
monorepo. The platform boundary check rejects any relative import that escapes the
standalone template root.

## Identity and authorization

Better Auth 1.6.24 is mounted at `/api/auth` behind an application-owned
identity contract. It uses PostgreSQL session rows, disables cookie session
caching so revocation is authoritative, and configures secure HTTP-only
cookies. Configure:

```sh
DATABASE_URL=postgresql://...
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=at-least-32-random-characters
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

The GitHub OAuth callback is `/api/auth/callback/github`. Authentication only
establishes identity: protected application routes independently verify
organization membership, resource ownership, and entitlement. Provider IDs
are not trusted as authorization decisions.

The integration suite enables Better Auth email/password endpoints only when
both `NODE_ENV=test` and `APP_BUILDER_TEST_AUTH=email-password` are set in its
isolated server process. Production configuration cannot activate that
fixture.

## App Builder-owned feature flags

Feature flag definitions, environment values, revisions, and immutable mutation
history live in App Builder's DynamoDB control plane. This generated product has
no feature-flag tables, management dashboard, or writable flag-management
endpoint. Runtime evaluation returns the caller's declared safe fallback if the
control plane is unavailable, the flag is missing, or its type has drifted.
Authentication, authorization, tenant isolation, validation, and Salable
entitlement checks must remain outside flag evaluation.

The versioned declaration is `feature-flags/manifest.v1.json`. Every new flag
must be added there so trusted deployment automation can reconcile it into App
Builder. `npm run check:feature-flags` rejects unknown code references, type
drift, unsafe unfinished defaults, missing retirement ownership, and runtime
credentials leaking into browser assets. Temporary or unfinished boolean work
defaults to `false`.

Server code evaluates flags through `ProductFeatureFlagEvaluator`. Client code
receives only server-evaluated values explicitly classified as
`CLIENT_EXPOSED`; it never receives definitions, rules, server-only values, or
runtime credentials.

App Builder provisions a distinct read-only runtime credential for each deployed
environment:

```sh
APP_BUILDER_CONTROL_PLANE_URL=https://builder.example.com
APP_BUILDER_PROJECT_ID=project_example
APP_ENVIRONMENT_ID=environment_preview_example
APP_BUILDER_FEATURE_FLAG_RUNTIME_TOKEN=provisioned-by-app-builder
```

The runtime credential is server-only and cannot mutate flags. Preview values
are never copied to production implicitly. All management occurs in the App
Builder dashboard with exact revisions, actor identity, reason, and correlation
ID; the generated product's `DATABASE_URL` is never used for flag operations.

## Vercel deployment

`deployment/vercel.v1.json` is the versioned deployment contract. It records
the native Deploy Button repository ownership, required App Builder integration,
Neon product, pinned Nitro adapter, required environment-variable names, public
routes, and post-deploy checks without embedding any values. Vercel creates the
repository and project from the maintained public template; Neon injects
`DATABASE_URL`, and the App Builder Vercel integration supplies generated runtime
configuration. Agent workers receive no managed database credentials.

`npm run deploy:vercel` runs the maintained stage-aware deployment plan.
Development and explicit Preview builds first run `npm run migrate` against their
isolated branch, then build and verify the Build Output API v3 package. This
applies accepted `develop` migrations to shared preview and applies the exact release source migrations to the
production-derived candidate branch before either environment can become
healthy. A failed migration fails the Vercel build.

Production builds deliberately skip that preview migration step because App
Builder's separate trusted release worker has already applied and receipted the
exact migration artifact. The remaining build commands are:

```sh
npm run build:vercel
npm run check:deployment:built
```

Before application cutover, a separate trusted release job uses `DATABASE_URL`,
runs `npm run migrate`, and emits the exact-commit, migration-checksum, and
completion receipt required by `deployment/release-migration.v1.json`. Connect
that job to the production promotion controller in the exact command order
declared by the manifest: migrate, emit the receipt for the reviewed Git commit,
verify that receipt and every migration checksum, then deploy. The verifier
accepts the manifest's `--commit` and `--receipt` arguments (or the equivalent
`RELEASE_COMMIT_SHA` and `RELEASE_MIGRATION_RECEIPT_PATH` trusted-job variables).
The receipt and its verification are deliberately absent from the Vercel build
environment; the build cannot authorize its own promotion.

The Deploy Button requires the Vercel Marketplace Neon product so the deployed
runtime receives its scoped `DATABASE_URL`; do not paste a Neon API key into App
Builder. Before the first deployment, the required App Builder Vercel integration
configures `BETTER_AUTH_URL` as Vercel's production-URL reference, supplies
`BETTER_AUTH_SECRET`, and installs the environment-scoped App Builder runtime
values. GitHub OAuth values are
optional until sign-in is enabled. To enable protected insights, set
the optional `APP_BUILDER_ENTITLED_ORGANIZATION_IDS` variable to a comma-separated
list of organization UUIDs; omission grants that capability to no organization.
