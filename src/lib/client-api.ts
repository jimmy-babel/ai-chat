import type {
  AssetDto,
  ChatDraft,
  ConversationDetail,
  ConversationItem,
  ImageDraft,
  VideoDraft,
  VideoTurnDto,
} from "@/lib/api-types";

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || `Request failed with ${response.status}`);
  }
  return json as T;
}

export async function createConversation(type: "CHAT" | "IMAGE" | "VIDEO", title?: string) {
  const response = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, title }),
  });
  return readJson<{ item: ConversationItem }>(response);
}

export async function fetchConversation(id: string) {
  const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
  return readJson<{ item: ConversationDetail }>(response);
}

export async function fetchHistory(cursor?: string | null, type?: string) {
  const params = new URLSearchParams({ limit: "10" });
  if (cursor) params.set("cursor", cursor);
  if (type && type !== "ALL") params.set("type", type);
  const response = await fetch(`/api/conversations?${params}`, { cache: "no-store" });
  return readJson<{ items: ConversationItem[]; nextCursor: string | null }>(response);
}

export async function renameConversation(id: string, title: string) {
  const response = await fetch(`/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return readJson<{ item: ConversationItem }>(response);
}

export async function deleteConversation(id: string) {
  const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
  return readJson<{ ok: boolean }>(response);
}

export async function searchConversations(q: string, type: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type !== "ALL") params.set("type", type);
  const response = await fetch(`/api/search?${params}`, { cache: "no-store" });
  return readJson<{ items: ConversationItem[] }>(response);
}

export async function uploadAsset(input: {
  file: File;
  kind: "CHAT_INPUT" | "IMAGE_REFERENCE" | "IMAGE_MASK" | "VIDEO_REFERENCE";
  conversationId?: string;
}) {
  const formData = new FormData();
  formData.set("file", input.file);
  formData.set("kind", input.kind);
  if (input.conversationId) formData.set("conversationId", input.conversationId);

  const response = await fetch("/api/assets/upload", {
    method: "POST",
    body: formData,
  });

  return readJson<{ item: AssetDto }>(response);
}

export function storeChatDraft(id: string, draft: ChatDraft) {
  sessionStorage.setItem(`chat-draft:${id}`, JSON.stringify(draft));
}

export function takeChatDraft(id: string): ChatDraft | null {
  const key = `chat-draft:${id}`;
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  sessionStorage.removeItem(key);
  return JSON.parse(value) as ChatDraft;
}

export function storeImageDraft(id: string, draft: ImageDraft) {
  sessionStorage.setItem(`image-draft:${id}`, JSON.stringify(draft));
}

export function takeImageDraft(id: string): ImageDraft | null {
  const key = `image-draft:${id}`;
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  sessionStorage.removeItem(key);
  return JSON.parse(value) as ImageDraft;
}

export function storeVideoDraft(id: string, draft: VideoDraft) {
  sessionStorage.setItem(`video-draft:${id}`, JSON.stringify(draft));
}

export function takeVideoDraft(id: string): VideoDraft | null {
  const key = `video-draft:${id}`;
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  sessionStorage.removeItem(key);
  return JSON.parse(value) as VideoDraft;
}

export async function createVideoTurn(
  conversationId: string,
  input: {
    clientRequestId: string;
    prompt: string;
    params: Record<string, unknown>;
    referenceImageAssetIds: string[];
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    referenceVideoAssetId?: string;
  },
) {
  const response = await fetch(`/api/video/${conversationId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ item: VideoTurnDto }>(response);
}

export async function refreshVideoTurn(conversationId: string, turnId: string) {
  const response = await fetch(`/api/video/${conversationId}/turns/${turnId}/refresh`, {
    method: "POST",
  });
  return readJson<{ item: VideoTurnDto; retryAfterMs: number | null }>(response);
}

export async function fetchAssetLibrary(media: "image" | "video", cursor?: string | null) {
  const params = new URLSearchParams({ media, limit: "24" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/assets/library?${params}`, { cache: "no-store" });
  return readJson<{ items: AssetDto[]; nextCursor: string | null }>(response);
}

export function refreshHistory() {
  window.dispatchEvent(new Event("ai-history-refresh"));
}

export function parseSseChunk(buffer: string, onEvent: (event: string, data: unknown) => void) {
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";

  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLine = lines.find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) continue;

    const event = eventLine.replace(/^event:\s*/, "").trim();
    const raw = dataLine.replace(/^data:\s*/, "");
    onEvent(event, JSON.parse(raw));
  }

  return rest;
}
