import { createMilkyClient, type MilkyClient, type MilkyEventSource } from "@saltify/milky-tea";

export type { MilkyClient, MilkyEventSource };

export function createClient(baseURL: string, token?: string): MilkyClient {
  return createMilkyClient({ baseURL, token: token || undefined });
}

export interface ParsedMessage {
  text: string;
  mediaAttachments: MediaAttachment[];
  replyToSeq: number | null;
}

export interface MediaAttachment {
  type: "image" | "record" | "video";
  url: string;
  resourceId?: string;
}

/**
 * Parse incoming message segments into text + media attachments.
 */
export function parseIncomingSegments(
  segments: any[],
): ParsedMessage {
  if (!Array.isArray(segments)) {
    return { text: "", mediaAttachments: [], replyToSeq: null };
  }

  const textParts: string[] = [];
  const mediaAttachments: MediaAttachment[] = [];
  let replyToSeq: number | null = null;

  for (const seg of segments) {
    const type: string = seg.type;
    const data: any = seg.data ?? {};

    switch (type) {
      case "text":
        textParts.push(data.text ?? "");
        break;

      case "mention":
        textParts.push(`@${data.user_id}`);
        break;

      case "mention_all":
        textParts.push("@全体成员");
        break;

      case "face":
        textParts.push(`[表情:${data.face_id ?? "?"}]`);
        break;

      case "image":
        if (data.resource_id) {
          mediaAttachments.push({
            type: "image",
            url: "", // resolved async later
            resourceId: String(data.resource_id),
          });
        } else if (data.uri) {
          mediaAttachments.push({ type: "image", url: String(data.uri) });
        }
        textParts.push("[图片]");
        break;

      case "record":
        if (data.resource_id) {
          mediaAttachments.push({
            type: "record",
            url: "",
            resourceId: String(data.resource_id),
          });
        } else if (data.uri) {
          mediaAttachments.push({ type: "record", url: String(data.uri) });
        }
        textParts.push("[语音]");
        break;

      case "video":
        if (data.resource_id) {
          mediaAttachments.push({
            type: "video",
            url: "",
            resourceId: String(data.resource_id),
          });
        } else if (data.uri) {
          mediaAttachments.push({ type: "video", url: String(data.uri) });
        }
        textParts.push("[视频]");
        break;

      case "reply":
        if (data.message_seq != null) {
          replyToSeq = Number(data.message_seq);
        }
        break;

      case "forward":
        textParts.push("[合并转发消息]");
        break;

      case "file":
        textParts.push(`[文件:${data.file_name ?? data.file_id ?? "?"}]`);
        break;

      case "light_app":
        textParts.push("[小程序]");
        break;

      default:
        // Unknown segment types are silently skipped
        break;
    }
  }

  return {
    text: textParts.join(""),
    mediaAttachments,
    replyToSeq,
  };
}

/**
 * Detect media type from URL or filename.
 */
export function detectMediaType(url: string): "image" | "record" | "video" {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3") || lower.includes(".wav") || lower.includes(".silk") || lower.includes(".amr")) {
    return "record";
  }
  if (lower.includes(".mp4") || lower.includes(".avi") || lower.includes(".mov") || lower.includes(".mkv")) {
    return "video";
  }
  return "image";
}

/**
 * Parse outbound text for @mention patterns and produce segments.
 * Supports @123456 and @全体成员 patterns.
 */
export function buildOutboundSegments(
  text: string,
  options?: { replyToSeq?: number | null },
): any[] {
  const segments: any[] = [];

  // Add reply segment first if present
  if (options?.replyToSeq) {
    segments.push({ type: "reply", data: { message_seq: options.replyToSeq } });
  }

  // Parse text for @mentions
  // Pattern: @全体成员 or @<digits>
  const mentionPattern = /@全体成员|@(\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text)) !== null) {
    // Text before the mention
    const before = text.slice(lastIndex, match.index);
    if (before) {
      segments.push({ type: "text", data: { text: before } });
    }

    if (match[0] === "@全体成员") {
      segments.push({ type: "mention_all", data: {} });
    } else if (match[1]) {
      segments.push({ type: "mention", data: { user_id: Number(match[1]) } });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last mention
  const remaining = text.slice(lastIndex);
  if (remaining) {
    segments.push({ type: "text", data: { text: remaining } });
  }

  // If no segments were produced (empty text), add empty text segment
  if (segments.length === 0 || (segments.length === 1 && segments[0].type === "reply")) {
    segments.push({ type: "text", data: { text: text || " " } });
  }

  return segments;
}
