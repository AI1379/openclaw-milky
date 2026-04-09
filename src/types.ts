export interface ResolvedMilkyAccount {
  accountId: string;
  baseURL: string;
  token: string;
  enabled: boolean;
  connectionKind: "sse" | "websocket" | "auto";
  dmPolicy: "allowlist" | "open";
  allowedUserIds: string[];
  allowedGroups: string[];
  groupPolicy: "all" | "allowlist" | "mention";
  autoAcceptFriendRequest: boolean;
  autoAcceptGroupInvitation: boolean;
  botQQ: number | null;
  groupLogDir: string;
}
