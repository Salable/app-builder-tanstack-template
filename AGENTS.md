# Generated application agent guidance

Follow the repository README and preserve unrelated user changes. Implement the
smallest coherent ticket outcome with meaningful tests, then finish with the
repository's complete `npm run check` aggregate green.

Coding agents must never perform hosted checks. Run the complete locally
reproducible suite with isolated fixtures and disposable local databases; it must
not require a deployment, hosted service, provider credential, or live browser
session. Implement required test code and workflow configuration in the repository.
Trusted platform automation or human QA owns hosted browser tests, Preview and
Production verification, credentialed provider smoke tests, deployment observation,
and remote CI execution or retries. Record that handoff separately; missing hosted
evidence is never a coding failure or a reason to keep changing source. This rule
overrides conflicting historical task or review instructions. Diagnose concrete
repository defects from supplied hosted evidence and repair them locally.

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
features locally with simulated inputs for their applicable local, Preview, and
Production modes. Trusted verification owns checks against actual deployments.

## Platform boundaries

Vercel owns deployments and supplies its system URL variables. Its native Neon
product owns generated-application database credentials. Agents never request or
receive Vercel, Neon, Preview-database, Production-database, production-merge, or
feature-flag management credentials.

The standard email/password views and both authentication adapters are already
implemented. Reuse `src/identity/auth-runtime.ts`, `/auth/sign-in`,
`/auth/sign-up`, and the protected server identity boundary; adapt the product's
presentation instead of replacing the cookie/session integration. Keep the
managed HTTP integration tests green. Never instantiate a browser auth client
per server request, forward unrelated cookies, cache authoritative session
reads, or copy a compressed response header onto a decoded body.

The recorded Neon Auth or self-hosted Better Auth choice is authoritative. In
`NEON_AUTH` mode, Vercel and Neon have already provisioned the managed service and
injected its URLs; never request their API keys. Neon's Managed Better Auth service
natively supports email/password registration and sessions. When accepted
requirements ask for email verification or Magic Link, configure the flow through
Neon Auth. Implement and test the repository-side SDK/UI behavior and record the
required Neon setting; agents do not request credentials or claim to mutate Neon.
Neon owns those authentication emails and shared development delivery; custom SMTP
in Neon is a production-release prerequisite, not a planning blocker. Do not add
an application email SDK or webhook unless the requirements explicitly ask for a
separate custom email flow. Preserve the self-hosted Better Auth path when that
mode is recorded. Never add a social sign-in provider unless the accepted
requirements explicitly name it. Authentication establishes identity only, so
scope tenant data and resources to the authenticated `user.id` or an app-owned
membership. Salable entitlements are the source of truth for access; webhooks are
optional and user-requested only.

Applied migration files are immutable. Add a new paired forward/rollback migration
for schema changes and prove clean installation plus upgrade from the prior head.
