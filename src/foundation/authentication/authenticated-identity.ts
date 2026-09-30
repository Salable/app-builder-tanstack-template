export type AuthenticatedIdentity = Readonly<{
  userId: string;
}>;

export type AuthenticationDecision =
  | Readonly<{ allowed: true; identity: AuthenticatedIdentity }>
  | Readonly<{ allowed: false; reason: "unauthenticated" }>;

export function requireAuthenticatedIdentity(
  identity: AuthenticatedIdentity | null,
): AuthenticationDecision {
  if (identity === null || identity.userId.trim().length === 0) {
    return { allowed: false, reason: "unauthenticated" };
  }
  return { allowed: true, identity };
}
