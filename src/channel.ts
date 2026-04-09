import {
  DEFAULT_ACCOUNT_ID,
  setAccountEnabledInConfigSection,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk/core";
import { z } from "zod";
import { listAccountIds, resolveAccount } from "./accounts.js";
import {
  createClient,
  parseIncomingSegments,
  detectMediaType,
  buildOutboundSegments,
  type ParsedMessage,
} from "./client.js";
import { authorizeUserForDm } from "./security.js";
import type { ResolvedMilkyAccount } from "./types.js";

const CHANNEL_ID = "milky";

const MilkyAccountSchema = z.object({
  baseURL: z.string().describe("Milky HTTP API base URL (e.g. http://127.0.0.1:3000)"),
  token: z.string().default("").describe("Access token for Milky API (leave empty if not required)"),
  enabled: z.boolean().default(true),
  connectionKind: z.enum(["sse", "websocket", "auto"]).default("websocket").describe("Event streaming transport. Lagrange.Milky uses WebSocket by default."),
  dmPolicy: z.enum(["allowlist", "open"]).default("allowlist").describe("DM authorization policy: 'allowlist' only allows allowedUserIds, 'open' allows anyone"),
  allowedUserIds: z.array(z.string()).default([]).describe("QQ user IDs allowed to DM the bot"),
  groupPolicy: z.enum(["all", "allowlist"]).default("all").describe("Group message policy: 'all' responds in all groups, 'allowlist' only responds in allowedGroups"),
  groupMentionOnly: z.boolean().default(false).describe("When true, only @bot messages enter context; all other group messages are logged to JSONL"),
  groupLogDir: z.string().default("~/.openclaw/workspace/logs/milky-groups").describe("Directory for group message JSONL logs (used when groupMentionOnly=true)"),
  allowedGroups: z.array(z.string()).default([]).describe("Group IDs the bot should respond to (only used when groupPolicy=allowlist or mention)"),
  autoAcceptFriendRequest: z.boolean().default(true).describe("Auto-accept friend requests from allowedUserIds"),
  autoAcceptGroupInvitation: z.boolean().default(true).describe("Auto-accept group invitations sent to the bot"),
  botQQ: z.number().nullable().default(null).describe("Bot QQ number (auto-detected on connect, usually no need to set)"),
});

const MilkyConfigSchema = buildChannelConfigSchema(
  MilkyAccountSchema.partial().extend({
    accounts: z.record(z.string(), MilkyAccountSchema).optional(),
  }),
);

/** Cache of known group IDs per account, for routing outbound messages. */
const knownGroups = new Map<string, Set<string>>();

/** Active event sources keyed by accountId, used for stopAccount. */
const activeSessions = new Map<string, { close: () => void; resolve: () => void }>();

/** Helper: determine if target is a group chat. */
function isGroupTarget(accountId: string, target: string): boolean {
  return knownGroups.get(accountId)?.has(target) ?? false;
}

/** Helper: send message to correct endpoint based on group/direct. */
async function sendMessage(
  client: ReturnType<typeof createClient>,
  isGroup: boolean,
  target: string,
  segments: any[],
) {
  if (isGroup) {
    return client.message.sendGroupMessage({
      group_id: Number(target),
      message: segments,
    });
  }
  return client.message.sendPrivateMessage({
    user_id: Number(target),
    message: segments,
  });
}

/** Helper: resolve media attachment URLs using get_resource_temp_url. */
async function resolveMediaUrls(
  parsed: ParsedMessage,
  client: ReturnType<typeof createClient>,
): Promise<ParsedMessage> {
  for (const att of parsed.mediaAttachments) {
    if (att.resourceId && !att.url) {
      try {
        const result = await client.message.getResourceTempUrl({
          resource_id: att.resourceId,
        });
        att.url = result.url;
      } catch (err: any) {
        // Log but don't fail the whole message for a single media resolution failure
        console.warn(`Milky: failed to resolve resource URL for ${att.resourceId}: ${err?.message || err}`);
      }
    }
  }
  return parsed;
}

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
      unsend: true,
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
          cfg,
          sectionKey: `channels.${CHANNEL_ID}`,
          accountId,
          enabled,
        });
      },
    },

    security: {
      resolveDmPolicy: ({
        cfg,
        accountId,
        account,
      }: {
        cfg: any;
        accountId?: string | null;
        account: ResolvedMilkyAccount;
      }) => {
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
      collectWarnings: ({ account }: { account: ResolvedMilkyAccount }) => {
        const warnings: string[] = [];
        if (!account.baseURL) {
          warnings.push("- Milky: baseURL is not configured.");
        }
        if (account.dmPolicy === "open") {
          warnings.push(
            '- Milky: dmPolicy="open" allows any user to message the bot. Consider "allowlist" for production use.',
          );
        }
        if (account.dmPolicy === "allowlist" && account.allowedUserIds.length === 0) {
          warnings.push(
            '- Milky: dmPolicy="allowlist" with empty allowedUserIds blocks all senders. Add users or set dmPolicy="open".',
          );
        }
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
      self: async ({ cfg, accountId }: any) => {
        try {
          const account = resolveAccount(cfg, accountId);
          const client = createClient(account.baseURL, account.token);
          const info = await client.system.getLoginInfo();
          return {
            kind: "user" as const,
            id: String(info.uin),
            name: info.nickname,
          };
        } catch {
          return null;
        }
      },

      listPeers: async ({ cfg, accountId }: any) => {
        try {
          const account = resolveAccount(cfg, accountId);
          const client = createClient(account.baseURL, account.token);
          const result = await client.system.getFriendList({ no_cache: false });
          return (result.friends ?? []).map((f: any) => ({
            kind: "user" as const,
            id: String(f.user_id),
            name: f.nickname || f.remark || String(f.user_id),
          }));
        } catch {
          return [];
        }
      },

      listGroups: async ({ cfg, accountId }: any) => {
        try {
          const account = resolveAccount(cfg, accountId);
          const client = createClient(account.baseURL, account.token);
          const result = await client.system.getGroupList({ no_cache: false });
          return (result.groups ?? []).map((g: any) => ({
            kind: "group" as const,
            id: String(g.group_id),
            name: g.group_name || String(g.group_id),
          }));
        } catch {
          return [];
        }
      },
    },

    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 2000,

      sendText: async ({ cfg, to, text, accountId, replyToId }: any) => {
        const account = resolveAccount(cfg, accountId);
        const client = createClient(account.baseURL, account.token);
        const target = String(to).trim();
        const group = isGroupTarget(account.accountId, target);

        const segments = buildOutboundSegments(text, {
          replyToSeq: replyToId ? Number(replyToId) : null,
        });

        try {
          const result = await sendMessage(client, group, target, segments);
          return {
            channel: CHANNEL_ID,
            messageId: String(result.message_seq),
            chatId: target,
          };
        } catch (err: any) {
          throw new Error(`Milky sendText failed: ${err?.message || err}`);
        }
      },

      sendMedia: async ({ cfg, to, mediaUrl, accountId }: any) => {
        const account = resolveAccount(cfg, accountId);
        const client = createClient(account.baseURL, account.token);
        const target = String(to).trim();
        const group = isGroupTarget(account.accountId, target);

        const mediaType = detectMediaType(String(mediaUrl));
        const segmentType = mediaType === "record" ? "record" : "image";
        // Note: Lagrange.Milky does not implement outgoing video segments;
        // if video URL detected, attempt it but degrade to image on failure.
        if (mediaType === "video") {
          const videoSegments = [{ type: "video" as const, data: { uri: String(mediaUrl) } }];
          try {
            const result = await sendMessage(client, group, target, videoSegments);
            return { channel: CHANNEL_ID, messageId: String(result.message_seq), chatId: target };
          } catch (err: any) {
            console.warn(`Milky sendVideo failed (backend may not implement it): ${err?.message || err}`);
            // Degrade to text notification since image fallback won't work for video
            const fallbackSegments = buildOutboundSegments("[视频发送失败：后端暂不支持视频上传]");
            const fallbackResult = await sendMessage(client, group, target, fallbackSegments);
            return { channel: CHANNEL_ID, messageId: String(fallbackResult.message_seq), chatId: target };
          }
        }
        const segments = [{ type: segmentType, data: { uri: mediaUrl } }];

        try {
          const result = await sendMessage(client, group, target, segments);
          return {
            channel: CHANNEL_ID,
            messageId: String(result.message_seq),
            chatId: target,
          };
        } catch (err: any) {
          throw new Error(`Milky sendMedia failed: ${err?.message || err}`);
        }
      },
    },

    actions: {
      describeMessageTool: () => ({
        actions: ["react", "unsend"] as const,
      }),
      handleAction: async (ctx: any) => {
        const { action, cfg, params, accountId } = ctx;
        const account = resolveAccount(cfg, accountId);
        const client = createClient(account.baseURL, account.token);
        const target = String(params.to ?? "").trim();
        const group = isGroupTarget(account.accountId, target);

        if (action === "react") {
          if (!group) {
            return { content: "Reactions are only supported in group chats" };
          }
          try {
            await client.group.sendGroupMessageReaction({
              group_id: Number(target),
              message_seq: Number(params.messageId),
              reaction: params.emoji || "\u{1F44D}",
              reaction_type: "emoji",
              is_add: true,
            });
            return { content: "Reaction added" };
          } catch (err: any) {
            return { content: `Milky sendReaction failed: ${err?.message || err}` };
          }
        }

        if (action === "unsend") {
          try {
            if (group) {
              await client.message.recallGroupMessage({
                group_id: Number(target),
                message_seq: Number(params.messageId),
              });
            } else {
              await client.message.recallPrivateMessage({
                user_id: Number(target),
                message_seq: Number(params.messageId),
              });
            }
            return { content: "Message unsent" };
          } catch (err: any) {
            return { content: `Milky unsend failed: ${err?.message || err}` };
          }
        }

        return { content: `Unsupported action: ${action}` };
      },
    },

    gateway: {
      startAccount: async (ctx: any) => {
        const { cfg, accountId, account, log, channelRuntime } = ctx;

        if (!account.enabled) {
          log?.info?.(`Milky account ${accountId} is disabled, skipping`);
          return { stop: () => {} };
        }

        if (!account.baseURL) {
          log?.warn?.(`Milky account ${accountId} not configured (missing baseURL)`);
          return { stop: () => {} };
        }

        const client = createClient(account.baseURL, account.token);

        // Verify connection and get bot info
        let botQQ: number;
        try {
          const loginInfo = await client.system.getLoginInfo();
          botQQ = loginInfo.uin;
          log?.info?.(`Milky connected as QQ ${botQQ} (${loginInfo.nickname})`);
        } catch (err: any) {
          log?.warn?.(`Milky failed to connect: ${err?.message || err}`);
          return { stop: () => {} };
        }

        // Cache group list for routing
        try {
          const groupList = await client.system.getGroupList({ no_cache: false });
          const groupIds = new Set<string>();
          for (const g of groupList.groups) {
            groupIds.add(String(g.group_id));
          }
          for (const gId of account.allowedGroups) groupIds.add(String(gId));
          knownGroups.set(account.accountId, groupIds);
          log?.info?.(`Milky cached ${groupIds.size} groups`);
        } catch (err: any) {
          log?.warn?.(`Milky failed to fetch group list: ${err?.message || err}`);
          knownGroups.set(account.accountId, new Set());
        }

        // Create a promise that blocks startAccount until stop is requested
        let stopResolve!: () => void;
        const blockPromise = new Promise<void>((resolve) => {
          stopResolve = resolve;
        });

        // Create event source
        const eventSource = client.event(account.connectionKind, {
          token: account.token || undefined,
          reconnect: { interval: 3000, attempts: "always" },
        });

        // Store session for stopAccount
        activeSessions.set(account.accountId, {
          close: () => eventSource.close(),
          resolve: stopResolve,
        });

        // Process events
        (async () => {
          try {
            for await (const event of eventSource) {
              if (event.event_type === "message_receive") {
                await handleMessageReceive(
                  event.data,
                  client,
                  account,
                  botQQ,
                  log,
                  cfg,
                  channelRuntime,
                );
              } else if (event.event_type === "friend_request") {
                await handleFriendRequest(event.data, client, account, log);
              } else if (
                event.event_type === "group_join_request" ||
                event.event_type === "group_invited_join_request"
              ) {
                await handleGroupNotification(event, client, account, log);
              }
            }
          } catch (err: any) {
            log?.warn?.(`Milky event loop ended: ${err?.message || err}`);
          } finally {
            // Ensure the blocking promise is resolved when event loop ends
            activeSessions.delete(account.accountId);
            stopResolve();
          }
        })();

        // Block until stopAccount is called or event source ends
        await blockPromise;

        log?.info?.(`Milky account ${accountId} stopped`);

        return { stop: () => {} };
      },

      stopAccount: async (ctx: any) => {
        const session = activeSessions.get(ctx.accountId);
        if (session) {
          session.close();
          session.resolve();
        }
        ctx.log?.info?.(`Milky account ${ctx.accountId} stop requested`);
      },
    },

    agentPrompt: {
      messageToolHints: (_params: any) => [
        "",
        "### QQ (Milky) Formatting",
        "QQ supports limited formatting. Use these patterns:",
        "",
        "**Mentions**: Use @user_id (e.g. @123456789) to mention users in group chats. Use @全体成员 to mention everyone.",
        "",
        "**Reactions**: Can be added to group messages using emoji.",
        "",
        "**Reply**: Reply to specific messages by quoting them.",
        "",
        "**Images**: Can be sent as URLs. The bot will upload them.",
        "",
        "**Limitations**:",
        "- No markdown, bold, italic, or code blocks",
        "- No buttons, cards, or interactive elements",
        "- No message editing after send",
        "- Keep messages under 2000 characters for best readability",
        "- Group messages may be rate-limited",
        "",
        "**Best practices**:",
        "- Use short, clear responses",
        "- Use line breaks to separate sections",
        "- Use numbered or bulleted lists for clarity",
      ],
    },
  };
}

/**
 * Handle an incoming message event.
 */
async function handleMessageReceive(
  msg: any,
  client: ReturnType<typeof createClient>,
  account: ResolvedMilkyAccount,
  botQQ: number,
  log: any,
  cfg: any,
  channelRuntime: any,
) {
  // Parse all segment types
  const parsed = parseIncomingSegments(msg.segments as any);

  // Resolve media attachment URLs
  const resolved = await resolveMediaUrls(parsed, client);

  // Build final text body
  const textParts: string[] = [];
  if (resolved.replyToSeq) {
    textParts.push(`[回复消息 ${resolved.replyToSeq}] `);
  }
  textParts.push(resolved.text);

  // Append media info as URLs for the agent
  for (const att of resolved.mediaAttachments) {
    if (att.url) {
      textParts.push(`\n[${att.type === "image" ? "图片" : att.type === "record" ? "语音" : "视频"}: ${att.url}]`);
    }
  }

  const text = textParts.join("").trim();
  if (!text && resolved.mediaAttachments.length === 0) return;

  let from: string;
  let chatType: "direct" | "group";
  let senderName: string;

  switch (msg.message_scene) {
    case "friend":
      from = String(msg.peer_id);
      chatType = "direct";
      senderName = msg.friend?.nickname || String(msg.sender_id);
      break;
    case "group":
      from = String(msg.peer_id);
      chatType = "group";
      senderName = msg.group_member?.card || msg.group_member?.nickname || String(msg.sender_id);
      // Update group cache
      knownGroups.get(account.accountId)?.add(String(msg.peer_id));
      break;
    case "temp":
      from = String(msg.peer_id);
      chatType = "direct";
      senderName = String(msg.sender_id);
      break;
    default:
      return;
  }

  // DM policy check for direct messages
  if (chatType === "direct") {
    const auth = authorizeUserForDm(
      String(msg.sender_id),
      account.dmPolicy,
      account.allowedUserIds,
    );
    if (!auth.allowed) {
      log?.info?.(
        `Milky DM blocked from ${msg.sender_id}: ${auth.reason}`,
      );
      return;
    }
  }

  // Group policy check
  if (chatType === "group" && account.groupPolicy === "allowlist") {
    if (!account.allowedGroups.includes(from)) {
      log?.info?.(`Milky group message blocked from group ${from}: not in allowedGroups`);
      return;
    }
  }

  // Mention-only mode: check if bot is mentioned
  let botMentioned = false;
  if (chatType === "group" && account.groupMentionOnly) {
    // Check if bot QQ is mentioned in the segments
    const segments = msg.segments as any[] | undefined;
    if (segments) {
      for (const seg of segments) {
        if (seg.type === "mention_all" || (seg.type === "mention" && String(seg.data?.user_id) === String(botQQ))) {
          botMentioned = true;
          break;
        }
      }
    }
    // Log all group messages to JSONL regardless of mention
    await appendGroupLog(account.groupLogDir, from, {
      ts: new Date().toISOString(),
      sender_id: String(msg.sender_id),
      sender_name: senderName,
      message_seq: msg.message_seq,
      text,
      media: resolved.mediaAttachments.map(a => ({ type: a.type, url: a.url || "" })),
      bot_mentioned: botMentioned,
    });
    if (!botMentioned) return;
  }

  const msgCtx: Record<string, any> = {
    Body: text,
    From: from,
    To: String(botQQ),
    SessionKey: `milky:${msg.message_scene}:${from}`,
    AccountId: account.accountId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: from,
    ChatType: chatType,
    SenderName: senderName,
    MessageId: String(msg.message_seq),
  };

  // Include reply-to metadata
  if (resolved.replyToSeq) {
    msgCtx.ReplyToSeq = String(resolved.replyToSeq);
  }

  try {
    await channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher({
      ctx: msgCtx,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: { text?: string; body?: string }) => {
          const replyText = payload?.text ?? payload?.body;
          if (!replyText) return;

          const segments = buildOutboundSegments(replyText, {
            replyToSeq: resolved.replyToSeq,
          });

          if (chatType === "group") {
            await client.message.sendGroupMessage({
              group_id: Number(from),
              message: segments,
            });
          } else {
            await client.message.sendPrivateMessage({
              user_id: Number(from),
              message: segments,
            });
          }
        },
        onReplyStart: () => {
          log?.info?.(`Agent reply started for ${from} (${chatType})`);
        },
      },
    });
  } catch (err: any) {
    log?.warn?.(`Milky dispatch error: ${err?.message || err}`);
  }
}

/**
 * Handle friend request events.
 * Attempts auto-accept for allowlisted users; degrades gracefully if
 * the backend does not implement acceptFriendRequest.
 */
async function handleFriendRequest(
  data: any,
  client: ReturnType<typeof createClient>,
  account: ResolvedMilkyAccount,
  log: any,
) {
  if (!account.autoAcceptFriendRequest) return;
  try {
    const requesterId = String(data?.user_id ?? data?.sender_id ?? "");
    if (!requesterId) return;
    if (!account.allowedUserIds.includes(requesterId)) return;

    await client.friend.acceptFriendRequest(data);
    log?.info?.(`Milky auto-accepted friend request from ${requesterId}`);
  } catch (err: any) {
    // Backend may not implement this API — log and continue
    log?.warn?.(`Milky auto-accept friend request failed (API may not be implemented): ${err?.message || err}`);
  }
}

/**
 * Handle group request/invitation events.
 * Attempts auto-accept; degrades gracefully if the backend
 * does not implement acceptGroupRequest/acceptGroupInvitation.
 */
async function handleGroupNotification(
  event: any,
  client: ReturnType<typeof createClient>,
  account: ResolvedMilkyAccount,
  log: any,
) {
  try {
    const data = event.data;
    const requesterId = String(data?.user_id ?? "");

    if (event.event_type === "group_join_request") {
      if (requesterId && account.allowedUserIds.includes(requesterId) && account.autoAcceptGroupInvitation) {
        try {
          await client.group.acceptGroupRequest(data);
          log?.info?.(`Milky auto-accepted group request from ${requesterId}`);
        } catch (err: any) {
          log?.warn?.(`Milky acceptGroupRequest failed (API may not be implemented): ${err?.message || err}`);
        }
      }
    } else if (event.event_type === "group_invited_join_request") {
      if (account.autoAcceptGroupInvitation) {
        try {
          await client.group.acceptGroupInvitation(data);
          log?.info?.(`Milky auto-accepted group invitation`);
        } catch (err: any) {
          log?.warn?.(`Milky acceptGroupInvitation failed (API may not be implemented): ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    log?.warn?.(`Milky group notification handling failed: ${err?.message || err}`);
  }
}

/**
 * Append a group message to the JSONL log file.
 * One file per group: {groupLogDir}/{groupId}.jsonl
 */
async function appendGroupLog(
  groupLogDir: string,
  groupId: string,
  entry: Record<string, any>,
) {
  try {
    const dir = groupLogDir.replace(/^~/, process.env.HOME || "/root");
    await import("fs").then(fs => fs.promises.mkdir(dir, { recursive: true }));
    const filePath = `${dir}/${groupId}.jsonl`;
    const line = JSON.stringify(entry) + "\n";
    await import("fs").then(fs => fs.promises.appendFile(filePath, line, "utf-8"));
  } catch (err: any) {
    console.warn(`Milky: failed to write group log: ${err?.message || err}`);
  }
}
