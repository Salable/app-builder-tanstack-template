import { Button } from "@base-ui/react/button";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../identity/auth-client";
import { getProtectedRouteIdentity } from "../identity/protected-route.functions";

export const Route = createFileRoute("/protected")({
  component: ProtectedRoute,
  loader: () => getProtectedRouteIdentity(),
});

function ProtectedRoute() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError("Sign-out failed. Please try again.");
        return;
      }
      await router.invalidate();
    } catch {
      setSignOutError("Sign-out failed. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

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
            <Button
              className="mt-5 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white"
              disabled={signingOut}
              onClick={() => {
                void signOut();
              }}
              type="button"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
            {signOutError && (
              <p role="alert" className="mt-3 text-red-700">
                {signOutError}
              </p>
            )}
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
              Sign-in is not configured for this deployment. Please try again later.
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
