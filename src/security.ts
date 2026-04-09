export type DmAuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: "allowlist-empty" | "not-allowlisted" };

/**
 * Check whether a user is authorized to DM the bot.
 * NOTE: Both `userId` and entries in `allowedUserIds` must be strings.
 * Callers should ensure String() conversion (e.g. QQ number 123456 → "123456").
 */
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
