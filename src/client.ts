import { createMilkyClient, type MilkyClient, type MilkyEventSource } from "@saltify/milky-tea";

export type { MilkyClient, MilkyEventSource };

export function createClient(baseURL: string, token?: string): MilkyClient {
  return createMilkyClient({ baseURL, token: token || undefined });
}

export interface ParsedMessage {
  text: string;
  mediaAttachments: MediaAttachment[];
  replyToSeq: number | null;
  /** Parsed forward message metadata (if any). */
  forwards: ForwardMeta[];
  /** Parsed file segment metadata (if any). */
  files: FileMeta[];
}

export interface MediaAttachment {
  type: "image" | "record" | "video";
  url: string;
  resourceId?: string;
}

export interface ForwardMeta {
  forwardId: string;
  title: string;
  preview: string[];
  summary: string;
}

export interface FileMeta {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileHash?: string;
  /** Resolved download URL (async). */
  downloadUrl?: string;
}

/**
 * Parse incoming message segments into text + media attachments.
 */
export function parseIncomingSegments(
  segments: any[],
): ParsedMessage {
  if (!Array.isArray(segments)) {
    return { text: "", mediaAttachments: [], replyToSeq: null, forwards: [], files: [] };
  }

  const textParts: string[] = [];
  const mediaAttachments: MediaAttachment[] = [];
  const forwards: ForwardMeta[] = [];
  const files: FileMeta[] = [];
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

      case "forward": {
        const fwd: ForwardMeta = {
          forwardId: data.forward_id ?? "",
          title: data.title ?? "",
          preview: Array.isArray(data.preview) ? data.preview : [],
          summary: data.summary ?? "",
        };
        forwards.push(fwd);
        textParts.push(`[合并转发: ${fwd.title || fwd.preview.slice(0, 3).join(", ") || "(无标题)"}]`);
        break;
      }

      case "file": {
        const f: FileMeta = {
          fileId: data.file_id ?? "",
          fileName: data.file_name ?? data.file_id ?? "?",
          fileSize: data.file_size ?? 0,
          fileHash: data.file_hash ?? undefined,
        };
        files.push(f);
        const sizeStr = f.fileSize > 0 ? ` (${formatFileSize(f.fileSize)})` : "";
        textParts.push(`[文件: ${f.fileName}${sizeStr}]`);
        break;
      }

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
    forwards,
    files,
  };
}

/**
 * Format file size in human-readable form.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/**
 * Parse sub-segments inside a forwarded message into readable text.
 * Reuses the same logic as parseIncomingSegments but returns only text.
 */
export function parseForwardedSegments(segments: any[]): string {
  if (!Array.isArray(segments)) return "";
  const parts: string[] = [];
  for (const seg of segments) {
    const type: string = seg.type;
    const data: any = seg.data ?? {};
    switch (type) {
      case "text":
        parts.push(data.text ?? "");
        break;
      case "mention":
        parts.push(`@${data.user_id ?? ""}`);
        break;
      case "mention_all":
        parts.push("@全体成员");
        break;
      case "face":
        parts.push(`[表情]`);
        break;
      case "image":
        parts.push("[图片]");
        break;
      case "record":
        parts.push("[语音]");
        break;
      case "video":
        parts.push("[视频]");
        break;
      case "forward":
        parts.push(`[合并转发: ${data.title || "(无标题)"}]`);
        break;
      case "file":
        parts.push(`[文件: ${data.file_name ?? "?"}]`);
        break;
      case "light_app":
        parts.push("[小程序]");
        break;
      default:
        break;
    }
  }
  return parts.join("").trim();
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
