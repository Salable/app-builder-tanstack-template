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

The public API is rooted at `/api/v1` and requires `API-Version: 1`. Missing or
unsupported versions return RFC 9457 Problem Details; no alias or default-version
path exists. Regenerate
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

`migrate:rollback` reverses the current migration and is intended for a reviewed
recovery rehearsal followed by the normal forward migration. The starter is
greenfield: one initial migration creates the complete current schema, and no
upgrade, compatibility, or old-schema data path exists. The repository gate
starts an immutable-digest PostgreSQL 18.3 container, proves clean rollback and
reapplication, then exercises identity, organization, project ownership,
invitation, seat, and authorization relationships against the built HTTP server.
No live managed database is contacted.

The starter contains its runnable organization, invitation, and seat foundation
under `src/foundation`; it never imports source from the App Builder Platform
monorepo. The platform boundary check rejects any relative import that escapes the
standalone template root.

## Identity and authorization

The Vercel-installed Neon authentication choice is authoritative for generated
application work. If Neon Auth was enabled, planning and delivery replace the
starter's self-hosted adapter with the provisioned Neon Auth service; they never
run both. If Neon Auth was disabled, Better Auth 1.6.24 remains mounted at
`/api/auth` behind the application-owned identity contract. Its PostgreSQL
sessions disable cookie caching so revocation is authoritative and use secure
HTTP-only cookies. Configure the self-hosted mode with:

```sh
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=at-least-32-random-characters
```

The server-only `src/runtime/application-origin.ts` resolver supplies Better
Auth and every other absolute application URL. It uses the loopback `HOST` and
`PORT` in local development, the exact `VERCEL_URL` in Preview, and
`VERCEL_PROJECT_PRODUCTION_URL` in Production. Vercel's **Automatically expose
System Environment Variables** setting must remain enabled. Do not add a
mirrored `APP_BASE_URL` or `BETTER_AUTH_URL`, and never derive this origin from
request headers.

That setting exposes Vercel's complete documented system-variable set to the
project at each variable's stated build/runtime phase. Server and build code can
use those names directly without App Builder aliases. This does not make every
value browser configuration; client exposure remains an explicit, public-data
decision.

In `NEON_AUTH` mode, Vercel's native Neon product has already provisioned Managed
Neon Auth and injected its application URLs. App Builder and its agents never ask
for a Vercel or Neon API key. Neon's Managed Better Auth service natively supports
email/password registration and sessions. When accepted requirements include
email verification or Magic Link, configure that flow through Neon Auth. Neon owns
those authentication emails and provides shared development delivery. Agents
implement and test the repository-side SDK/UI behavior and record the required
Neon setting without requesting credentials or claiming to mutate Neon. Custom
SMTP is configured in Neon before a production release and does not block a brief,
plan, or development. Do not add an application email SDK, webhook, or second
delivery service unless the requirements explicitly ask for a separate custom
email flow.

Self-hosted Better Auth does not inherit Neon's managed email delivery, so its
email flows and delivery integration remain explicit product requirements. The
starter contains no third-party or social sign-in provider in either mode. GitHub,
Google, Microsoft, and other external identity providers are added only when the
user explicitly requests the named provider. Authentication only establishes
identity: protected application routes independently verify organization
membership, authenticated `user.id`, resource ownership, tenant scope, and
entitlement.

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
provider-owned Neon branch, then build and verify the Build Output API v3 package.
A failed Preview migration fails that Vercel build.

The phase-one production command only merges an exact reviewed `develop` source
into `main`; it does not receive a production database credential or run a
production migration. Vercel then builds Production from `main` with:

```sh
npm run build:vercel
npm run check:deployment:built
```

Tickets that require a Production schema change must remain out of the phase-one
promotion until a separate trusted production-migration boundary is designed and
approved. The starter intentionally contains no hidden release worker, cutover
receipt script, deployment-promotion command, or production migration fallback.

The Deploy Button requires the Vercel Marketplace Neon product so the deployed
runtime receives its scoped `DATABASE_URL`; do not paste a Neon API key into App
Builder. Before the first deployment, the required App Builder Vercel integration
supplies `BETTER_AUTH_SECRET` and the environment-scoped App Builder runtime
values. Application origins come directly from Vercel's exposed system variables,
not integration-owned aliases. The Better Auth secret does not override a verified
Neon Auth selection or authorize a sign-in method. To enable protected insights, set
the optional `APP_BUILDER_ENTITLED_ORGANIZATION_IDS` variable to a comma-separated
list of organization UUIDs; omission grants that capability to no organization.
