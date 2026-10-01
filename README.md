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

Run `npm ci` and `npm run check` for the complete local suite, or `npm run dev`
for local development. See the [development guide](docs/development-guide.md)
for architecture, checks, authentication, migrations and deployment.

App Builder replaces this README with the accepted product outline before coding
starts. The development guide and [agent guidance](AGENTS.md) remain available;
subsequent tickets update the product documentation within their own scope.
