import { Link, createFileRoute } from "@tanstack/react-router";
import { SignOutButton } from "../identity/sign-out-button";
import { getProtectedRouteIdentity } from "../identity/protected-route.functions";

export const Route = createFileRoute("/protected")({
  component: ProtectedRoute,
  loader: () => getProtectedRouteIdentity(),
});

function ProtectedRoute() {
  const result = Route.useLoaderData();
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-700">
            Account
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Account access</h1>
        </header>

        {result.status === "authenticated" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Authenticated identity</h2>
            <p className="mt-3 text-slate-700">
              Signed in as {result.identity.name} ({result.identity.email}).
            </p>
            <SignOutButton className="mt-5 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white" />
          </section>
        ) : result.status === "unauthenticated" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Authentication required</h2>
            <p className="mt-3 text-slate-700">Sign in to view your account.</p>
            <Link
              className="mt-5 inline-block font-semibold text-violet-700 underline"
              to="/auth/sign-in"
            >
              Sign in
            </Link>
          </section>
        ) : (
          <section
            aria-labelledby="identity-unavailable-heading"
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold" id="identity-unavailable-heading">
              Identity service unavailable
            </h2>
            <p className="mt-3 text-slate-700">
              {result.detail} Reference: {result.correlationId}.
            </p>
          </section>
        )}

        <Link className="font-semibold text-violet-700 underline" to="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
