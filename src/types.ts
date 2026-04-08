export interface ResolvedMilkyAccount {
  accountId: string;
  baseURL: string;
  token: string;
  enabled: boolean;
  dmPolicy: "allowlist" | "open";
  allowedUserIds: string[];
  connectionKind: "sse" | "websocket" | "auto";
  botQQ: number | null;
}
