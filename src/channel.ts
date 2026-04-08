import {
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import { createClient, extractText } from "./client.js";
import { getMilkyRuntime } from "./runtime.js";
import { authorizeUserForDm } from "./security.js";
import type { ResolvedMilkyAccount } from "./types.js";

const CHANNEL_ID = "milky";
const MilkyConfigSchema = buildChannelConfigSchema(z.object({}).passthrough());

/** Cache of known group IDs per account, for routing outbound messages. */
const knownGroups = new Map<string, Set<string>>();

export function createMilkyPlugin() {
  return {
    id: CHANNEL_ID,

    meta: {
      id: CHANNEL_ID,
      label: "Milky (QQ)",
      selectionLabel: "Milky QQ Bot (Lagrange)",
      detailLabel: "Milky QQ Bot (Lagrange)",
      docsPath: "/channels/milky",
      blurb: "QQ Bot via Milky protocol (LagrangeV2.Milky)",
      aliases: ["qq", "milky"],
      order: 25,
    },

    capabilities: {
      chatTypes: ["direct" as const, "group" as const],
      media: true,
      threads: false,
      reactions: true,
      edit: false,
      unsend: false,
      reply: true,
      effects: false,
      blockStreaming: false,
    },

    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },

    configSchema: MilkyConfigSchema,

    config: {
      listAccountIds: (cfg: any) => listAccountIds(cfg),
      resolveAccount: (cfg: any, accountId?: string | null) => resolveAccount(cfg, accountId),
      defaultAccountId: (_cfg: any) => DEFAULT_ACCOUNT_ID,
      setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
        return setAccountEnabledInConfigSection({
          cfg, sectionKey: `channels.${CHANNEL_ID}`, accountId, enabled,
        });
      },
    },

    security: {
      resolveDmPolicy: ({ cfg, accountId, account }: any) => {
        const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
        const channelCfg = (cfg as any).channels?.[CHANNEL_ID];
        const useAccountPath = Boolean(channelCfg?.accounts?.[resolvedAccountId]);
        const basePath = useAccountPath
          ? `channels.${CHANNEL_ID}.accounts.${resolvedAccountId}.`
          : `channels.${CHANNEL_ID}.`;
        return {
          policy: account.dmPolicy ?? "allowlist",
          allowFrom: account.allowedUserIds ?? [],
          policyPath: `${basePath}dmPolicy`,
          allowFromPath: basePath,
          approveHint: `openclaw pairing approve ${CHANNEL_ID} <code>`,
          normalizeEntry: (raw: string) => raw.trim(),
        };
      },
      collectWarnings: ({ account }: any) => {
        const warnings: string[] = [];
        if (!account.baseURL) warnings.push("- Milky: baseURL is not configured.");
        if (account.dmPolicy === "open") warnings.push('- Milky: dmPolicy="open" allows any user to message the bot.');
        if (account.dmPolicy === "allowlist" && account.allowedUserIds.length === 0) warnings.push("- Milky: allowlist is empty, all DMs blocked.");
        return warnings;
      },
    },

    messaging: {
      normalizeTarget: (target: string) => {
        const trimmed = target.trim();
        if (!trimmed) return undefined;
        return trimmed.replace(/^milky[:_\-]?/i, "").replace(/^qq[:_\-]?/i, "").trim();
      },
      targetResolver: {
        looksLikeId: (id: string) => {
          const trimmed = id?.trim();
          if (!trimmed) return false;
          return /^\d+$/.test(trimmed) || /^milky[:_\-]?/i.test(trimmed) || /^qq[:_\-]?/i.test(trimmed);
        },
        hint: "<qqNumber>",
      },
    },

    directory: {
      self: async () => null,
      listPeers: async () => [],
      listGroups: async () => [],
    },

    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 2000,

      sendText: async ({ to, text, accountId, account: ctxAccount }: any) => {
        const account: ResolvedMilkyAccount = ctxAccount ?? resolveAccount({}, accountId);
        const client = createClient(account.baseURL, account.token);
        const target = String(to).trim();
        const isGroup = knownGroups.get(account.accountId)?.has(target);
        const segments = [{ type: "text" as const, data: { text } }];
        if (isGroup) {
          const result = await client.message.sendGroupMessage({ group_id: Number(target), message: segments });
          return { channel: CHANNEL_ID, messageId: String(result.message_seq), chatId: target };
        } else {
          const result = await client.message.sendPrivateMessage({ user_id: Number(target), message: segments });
          return { channel: CHANNEL_ID, messageId: String(result.message_seq), chatId: target };
        }
      },

      sendMedia: async ({ to, mediaUrl, accountId, account: ctxAccount }: any) => {
        const account: ResolvedMilkyAccount = ctxAccount ?? resolveAccount({}, accountId);
        const client = createClient(account.baseURL, account.token);
        const target = String(to).trim();
        const isGroup = knownGroups.get(account.accountId)?.has(target);
        const segments = [{ type: "image" as const, data: { uri: mediaUrl } }];
        if (isGroup) {
          const result = await client.message.sendGroupMessage({ group_id: Number(target), message: segments });
          return { channel: CHANNEL_ID, messageId: String(result.message_seq), chatId: target };
        } else {
          const result = await client.message.sendPrivateMessage({ user_id: Number(target), message: segments });
          return { channel: CHANNEL_ID, messageId: String(result.message_seq), chatId: target };
        }
      },
    },

    gateway: {
      startAccount: async (ctx: any) => {
        const { cfg, accountId, log } = ctx;
        const account = resolveAccount(cfg, accountId);
        if (!account.enabled) { log?.info?.(`Milky account ${accountId} is disabled`); return { stop: () => {} }; }
        if (!account.baseURL) { log?.warn?.(`Milky account ${accountId} missing baseURL`); return { stop: () => {} }; }

        const client = createClient(account.baseURL, account.token);
        let botQQ: number;
        try {
          const loginInfo = await client.system.getLoginInfo();
          botQQ = loginInfo.uin;
          log?.info?.(`Milky connected as QQ ${botQQ} (${loginInfo.nickname})`);
        } catch (err: any) {
          log?.warn?.(`Milky failed to connect: ${err?.message || err}`);
          return { stop: () => {} };
        }

        try {
          const groupList = await client.group.getGroupList({});
          const groupIds = new Set<string>();
          for (const g of groupList.groups) groupIds.add(String(g.group_id));
          knownGroups.set(account.accountId, groupIds);
          log?.info?.(`Milky cached ${groupIds.size} groups`);
        } catch (err: any) {
          log?.warn?.(`Milky failed to fetch group list: ${err?.message || err}`);
          knownGroups.set(account.accountId, new Set());
        }

        const eventSource = client.event(account.connectionKind, {
          token: account.token || undefined,
          reconnect: { interval: 3000, attempts: "always" },
        });

        (async () => {
          try {
            for await (const event of eventSource) {
              if (event.event_type !== "message_receive") continue;
              const msg = event.data;
              const text = extractText(msg.segments as any);
              if (!text) continue;
              let from: string, chatType: "direct" | "group", senderName: string;
              switch (msg.message_scene) {
                case "friend": from = String(msg.peer_id); chatType = "direct"; senderName = msg.friend?.nickname || String(msg.sender_id); break;
                case "group": from = String(msg.peer_id); chatType = "group"; senderName = msg.group_member?.card || msg.group_member?.nickname || String(msg.sender_id); knownGroups.get(account.accountId)?.add(String(msg.peer_id)); break;
                case "temp": from = String(msg.peer_id); chatType = "direct"; senderName = String(msg.sender_id); break;
                default: continue;
              }
              if (chatType === "direct") {
                const auth = authorizeUserForDm(String(msg.sender_id), account.dmPolicy, account.allowedUserIds);
                if (!auth.allowed) { log?.info?.(`Milky DM blocked from ${msg.sender_id}`); continue; }
              }
              const msgCtx = { Body: text, From: from, To: String(botQQ), SessionKey: `milky:${msg.message_scene}:${from}`, AccountId: account.accountId, OriginatingChannel: CHANNEL_ID, OriginatingTo: from, ChatType: chatType, SenderName: senderName, MessageId: String(msg.message_seq) };
              try {
                const rt = getMilkyRuntime();
                const currentCfg = await rt.config.loadConfig();
                await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({ ctx: msgCtx, cfg: currentCfg, dispatcherOptions: {
                  deliver: async (payload: any) => {
                    const replyText = payload?.text ?? payload?.body;
                    if (!replyText) return;
                    const segs = [{ type: "text" as const, data: { text: replyText } }];
                    if (chatType === "group") await client.message.sendGroupMessage({ group_id: Number(from), message: segs });
                    else await client.message.sendPrivateMessage({ user_id: Number(from), message: segs });
                  },
                  onReplyStart: () => { log?.info?.(`Agent reply started for ${from} (${chatType})`); },
                }});
              } catch (err: any) { log?.warn?.(`Milky dispatch error: ${err?.message || err}`); }
            }
          } catch (err: any) { log?.warn?.(`Milky event loop ended: ${err?.message || err}`); }
        })();

        return { stop: () => { log?.info?.(`Stopping Milky account ${accountId}`); eventSource.close(); } };
      },
      stopAccount: async (ctx: any) => { ctx.log?.info?.(`Milky account ${ctx.accountId} stopped`); },
    },

    agentPrompt: {
      messageToolHints: () => ["", "### QQ (Milky) Formatting", "QQ supports limited formatting. Use @user_id to mention users. Images can be sent as URLs.", "", "**Limitations**: No markdown, no editing, keep messages under 2000 chars."],
    },
  };
}
