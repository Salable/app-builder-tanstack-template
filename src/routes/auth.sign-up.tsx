import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "../identity/auth-form";
export const Route = createFileRoute("/auth/sign-up")({
  component: () => <AuthForm mode="sign-up" />,
});
