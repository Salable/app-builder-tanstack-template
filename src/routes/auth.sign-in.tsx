import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "../identity/auth-form";
export const Route = createFileRoute("/auth/sign-in")({
  component: () => <AuthForm mode="sign-in" />,
});
