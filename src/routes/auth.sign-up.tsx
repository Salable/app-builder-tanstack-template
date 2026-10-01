import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../identity/auth-page";
export const Route = createFileRoute("/auth/sign-up")({
  component: () => <AuthPage mode="sign-up" />,
});
