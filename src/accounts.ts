import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { ResolvedMilkyAccount } from "./types.js";

const CHANNEL_ID = "milky";

export function listAccountIds(cfg: any): string[] {
  const accounts = cfg?.channels?.[CHANNEL_ID]?.accounts;
  if (!accounts || typeof accounts !== "object") return [DEFAULT_ACCOUNT_ID];
  return Object.keys(accounts);
}

export function resolveAccount(cfg: any, accountId?: string | null): ResolvedMilkyAccount {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const accounts = cfg?.channels?.[CHANNEL_ID]?.accounts;
  const acct = accounts?.[id] || {};

  return {
    accountId: id,
    baseURL: acct.baseURL || "http://127.0.0.1:3000",
    token: acct.token || "",
    enabled: acct.enabled !== false,
    connectionKind: acct.connectionKind || "websocket",
    dmPolicy: acct.dmPolicy || "allowlist",
    allowedUserIds: (acct.allowedUserIds || []).map(String),
    allowedGroups: (acct.allowedGroups || []).map(String),
    groupPolicy: acct.groupPolicy || "all",
    autoAcceptFriendRequest: acct.autoAcceptFriendRequest !== false,
    autoAcceptGroupInvitation: acct.autoAcceptGroupInvitation !== false,
    botQQ: acct.botQQ || null,
  };
}
