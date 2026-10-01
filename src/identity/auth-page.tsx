import { AuthForm } from "./auth-form";

// Product presentation and the destination after sign-in belong here. The form
// owns credential submission, hydration, pending state and recoverable errors.
export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const signingUp = mode === "sign-up";
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight">
          {signingUp ? "Create your account" : "Sign in"}
        </h1>
        <AuthForm
          mode={mode}
          className="mt-6 space-y-5"
          onAuthenticated={() => window.location.assign("/protected")}
        />
        <p className="mt-6 text-slate-700">
          {signingUp ? "Already have an account? " : "Need an account? "}
          <a
            className="font-semibold text-violet-700 underline"
            href={signingUp ? "/auth/sign-in" : "/auth/sign-up"}
          >
            {signingUp ? "Sign in" : "Create an account"}
          </a>
        </p>
        <a className="mt-4 inline-block text-violet-700 underline" href="/">
          Return home
        </a>
      </section>
    </main>
  );
}
