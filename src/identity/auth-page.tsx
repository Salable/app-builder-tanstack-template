import { AuthForm } from "./auth-form";

// Product tasks replace this presentation; the form retains tested auth behavior.
export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const signingUp = mode === "sign-up";
  return (
    <section className="card auth-card">
      <p className="eyebrow">Account access</p>
      <h1>{signingUp ? "Create your account" : "Sign in"}</h1>
      <p>
        {signingUp
          ? "Use this form to create an account."
          : "Use this form to access the application."}
      </p>
      <AuthForm
        mode={mode}
        onAuthenticated={() => window.location.assign("/protected")}
      />
      <p>
        {signingUp ? "Already have an account? " : "Need an account? "}
        <a href={signingUp ? "/auth/sign-in" : "/auth/sign-up"}>
          {signingUp ? "Sign in" : "Create an account"}
        </a>
      </p>
      <a href="/">Return home</a>
    </section>
  );
}
