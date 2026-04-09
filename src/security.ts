export type DmAuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: "allowlist-empty" | "not-allowlisted" };

export function authorizeUserForDm(
  userId: string,
  dmPolicy: "open" | "allowlist",
  allowedUserIds: string[],
): DmAuthorizationResult {
  if (dmPolicy === "open") {
    return { allowed: true };
  }
  if (allowedUserIds.length === 0) {
    return { allowed: false, reason: "allowlist-empty" };
  }
  if (!allowedUserIds.includes(userId)) {
    return { allowed: false, reason: "not-allowlisted" };
  }
  return { allowed: true };
}
