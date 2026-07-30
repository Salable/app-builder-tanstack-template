# TanStack Start generated-application template

This isolated workspace is the generated customer-application golden-path
spike. It uses TanStack Start SSR, Hono for every public API route, Tailwind,
Base UI wrappers, React Hook Form/Zod, TanStack Query, bounded client-only
Zustand state, Better Auth, OpenAPI 3.1, and an Orval-generated fetch/Query
client.

In a generated standalone repository, run:

```sh
npm ci
npm run check
npm run dev
```

Within the App Builder Platform source workspace, append
`--workspace @app-builder/generated-tanstack-start` to package commands.

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
reviewed recovery rehearsal, followed by the normal forward migration. The
repository gate starts an immutable-digest PostgreSQL 18.3 container, proves
rollback/forward recovery preserves existing data, and exercises the built
HTTP server against that database. No live managed database is contacted.

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
