import { createMilkyClient, type MilkyClient, type MilkyEventSource } from "@saltify/milky-tea";

export type { MilkyClient, MilkyEventSource };

export function createClient(baseURL: string, token?: string): MilkyClient {
  return createMilkyClient({ baseURL, token: token || undefined });
}

export function extractText(segments: any[]): string {
  if (!Array.isArray(segments)) return "";
  return segments
    .filter((s: any) => s.type === "text")
    .map((s: any) => s.data?.text ?? "")
    .join("");
}
