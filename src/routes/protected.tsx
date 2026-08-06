import { Button } from "@base-ui/react/button";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { authClient } from "../identity/auth-client";
import { getProtectedRouteIdentity } from "../identity/protected-route.functions";

export const Route = createFileRoute("/protected")({
  component: ProtectedRoute,
  loader: () => getProtectedRouteIdentity(),
});

function ProtectedRoute() {
  const result = Route.useLoaderData();
  const router = useRouter();

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-700">
            Server authorization proof
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Protected account</h1>
        </header>

        {result.status === "authenticated" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Authenticated identity</h2>
            <p className="mt-3 text-slate-700">
              Signed in as {result.identity.name} ({result.identity.email}).
            </p>
            <Button
              className="mt-5 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white"
              onClick={() => {
                void authClient.signOut().then(() => router.invalidate());
              }}
              type="button"
            >
              Sign out
            </Button>
          </section>
        ) : result.status === "unauthenticated" ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Authentication required</h2>
            <p className="mt-3 text-slate-700">
              Protected account details are resolved on the server from a
              database-backed session.
            </p>
            {result.providers.github ? (
              <Button
                className="mt-5 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white"
                onClick={() => {
                  void authClient.signIn.social({
                    callbackURL: "/protected",
                    provider: "github",
                  });
                }}
                type="button"
              >
                Sign in with GitHub
              </Button>
            ) : (
              <p className="mt-5 text-sm text-slate-600">
                GitHub sign-in is not configured for this deployment.
              </p>
            )}
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
              Sign-in is not configured for this deployment. Please try again later.
            </p>
          </section>
        )}

        <Link className="font-semibold text-violet-700 underline" to="/">
          Return to foundation
        </Link>
      </div>
    </main>
  );
}
