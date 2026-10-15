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
    <section className="workspace">
      <p className="eyebrow">Signed-in view</p>
      <h1>Application</h1>
      {result.status === "authenticated" ? (
        <section className="card">
          <p>
            This is the signed-in area of your application. App Builder will replace
            this shell with the features defined in your project.
          </p>
          <p>
            Signed in as {result.identity.name} ({result.identity.email}).
          </p>
          <SignOutButton />
        </section>
      ) : result.status === "unauthenticated" ? (
        <section className="card">
          <h2>Sign in required</h2>
          <p>Sign in to open the application.</p>
          <Link to="/auth/sign-in">Sign in</Link>
        </section>
      ) : (
        <section className="error" role="alert">
          <h2>Sign-in service unavailable</h2>
          <p>
            {result.detail} Reference: {result.correlationId}.
          </p>
        </section>
      )}
    </section>
  );
}
