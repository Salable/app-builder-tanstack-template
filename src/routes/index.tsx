import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <section className="hero">
      <p className="eyebrow">Public view</p>
      <h1>Landing page</h1>
      <p className="intro">
        This is the public entry point for your application. App Builder will replace
        this page with your product's content and design.
      </p>
      <div className="actions">
        <Link className="button" to="/auth/sign-up">
          Create an account
        </Link>
        <Link to="/auth/sign-in">Sign in</Link>
      </div>
    </section>
  );
}
