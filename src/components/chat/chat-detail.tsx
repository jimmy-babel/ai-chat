"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ChatDraft, ChatMessageDto, ConversationDetail } from "@/lib/api-types";
import type { PublicModel } from "@/lib/models";
import { fetchConversation, parseSseChunk, refreshHistory, takeChatDraft } from "@/lib/client-api";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageList } from "@/components/chat/message-list";

function tempMessage(role: "USER" | "ASSISTANT", content: string | null): ChatMessageDto {
  return {
    id: `temp-${role}-${Date.now()}-${Math.random()}`,
    role,
    content,
    sequence: Date.now(),
    status: role === "ASSISTANT" ? "STREAMING" : "COMPLETED",
    attachments: [],
    providerResponseId: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };
}

export function ChatDetail({ id, models }: { id: string; models: PublicModel[] }) {
  const router = useRouter();
  const [conversation, setConversation] = React.useState<ConversationDetail | null>(null);
  const [messages, setMessages] = React.useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const startedDraftRef = React.useRef(false);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  }, []);

  const load = React.useCallback(async () => {
    const result = await fetchConversation(id);
    if (result.item.type !== "CHAT") {
      router.replace(`/ai/image/${id}`);
      return;
    }
    setConversation(result.item);
    setMessages(result.item.messages);
  }, [id, router]);

  const send = React.useCallback(
    async (draft: ChatDraft) => {
      setStreaming(true);
      const userMessage = tempMessage("USER", draft.content);
      const assistantMessage = tempMessage("ASSISTANT", "");

      setMessages((current) => [...current, userMessage, assistantMessage]);
      scrollToBottom("auto");

      try {
        const response = await fetch(`/api/chat/${id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });

        if (!response.ok || !response.body) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.error || "发送失败");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = parseSseChunk(buffer, (event, data) => {
            if (event === "meta") {
              const meta = data as { attachments?: unknown };
              if (Array.isArray(meta.attachments)) {
                setMessages((current) =>
                  current.map((message) =>
                    message.id === userMessage.id
                      ? { ...message, attachments: meta.attachments }
                      : message,
                  ),
                );
              }
            }
            if (event === "delta") {
              const delta = data as { text?: string };
              if (!delta.text) return;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, content: `${message.content || ""}${delta.text}` }
                    : message,
                ),
              );
              scrollToBottom();
            }
            if (event === "error") {
              const payload = data as { message?: string };
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? {
                        ...message,
                        status: "FAILED",
                        errorMessage: payload.message || "回复失败",
                      }
                    : message,
                ),
              );
            }
          });
        }

        await load();
        refreshHistory();
      } finally {
        setStreaming(false);
      }
    },
    [id, load, scrollToBottom],
  );

  React.useEffect(() => {
    let alive = true;
    async function init() {
      setLoading(true);
      try {
        await load();
        if (!alive || startedDraftRef.current) return;
        startedDraftRef.current = true;
        const draft = takeChatDraft(id);
        if (draft) await send(draft);
      } finally {
        if (alive) setLoading(false);
      }
    }

    init();
    return () => {
      alive = false;
    };
  }, [id, load, send]);

  React.useEffect(() => {
    if (messages.length > 0) scrollToBottom("auto");
  }, [messages.length, scrollToBottom]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* <div className="absolute right-7 top-7 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium">
        USER
      </div> */}
      {loading && messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-400">
          加载会话中...
        </div>
      ) : (
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
          <MessageList messages={messages} streaming={streaming && Boolean(conversation)} />
          <div ref={bottomRef} />
        </div>
      )}
      <div className="shrink-0 bg-white/95 pb-5">
        <ChatComposer conversationId={id} onSubmit={send} disabled={streaming} compact models={models} />
      </div>
    </div>
  );
}
