# Generated application agent guidance

Follow the repository README and preserve unrelated user changes. Implement the
smallest coherent ticket outcome with meaningful tests, then finish with the
repository's complete `npm run check` aggregate green.

## Application URLs

Server code must use `resolveApplicationOrigin` or `resolveApplicationUrl` from
`src/runtime/application-origin.ts` whenever it needs an absolute application URL,
including authentication callbacks, checkout returns, webhook instructions, and
email links.

- Vercel Preview resolves from the trusted `VERCEL_URL` system variable.
- Vercel Production resolves from the trusted
  `VERCEL_PROJECT_PRODUCTION_URL` system variable.
- Local development and tests resolve from the loopback `HOST` and `PORT`.

Vercel's **Automatically expose System Environment Variables** project setting
must remain enabled. A missing Vercel system variable is deployment-configuration
evidence; report it explicitly instead of adding another origin source.

The complete Vercel system-variable set is available to this project at the build
and runtime phases documented by Vercel. Use those variables directly in
server/build code when a feature needs Vercel deployment metadata; do not ask App
Builder to copy or rename them. They are not automatically browser configuration:
expose only an intentionally public, framework-prefixed value when the accepted
requirements need it.

Do not add `APP_BASE_URL`, `BETTER_AUTH_URL`, or another mirrored origin variable.
Do not derive an origin from `Host`, `Forwarded`, or `X-Forwarded-*` request
headers. Do not duplicate the resolver in feature code. Test URL-producing
features in their applicable local, Preview, and Production modes.

## Platform boundaries

Vercel owns deployments and supplies its system URL variables. Its native Neon
product owns generated-application database credentials. Agents never request or
receive Vercel, Neon, Preview-database, Production-database, production-merge, or
feature-flag management credentials.

The recorded Neon Auth or self-hosted Better Auth choice is authoritative. Never
add a social sign-in provider unless the accepted requirements explicitly name it,
and do not invent an email provider or verification flow. Salable entitlements are
the source of truth for access; webhooks are optional and user-requested only.

Applied migration files are immutable. Add a new paired forward/rollback migration
for schema changes and prove clean installation plus upgrade from the prior head.
