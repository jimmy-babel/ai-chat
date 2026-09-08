"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ChatDraft } from "@/lib/api-types";
import type { PublicModel } from "@/lib/models";
import { createConversation, storeChatDraft } from "@/lib/client-api";
import { ChatComposer } from "@/components/chat/chat-composer";

export function ChatHome({ greeting, models }: { greeting: string; models: PublicModel[] }) {
  const router = useRouter();
  const [submitting, setSubmitting] = React.useState(false);

  async function submit(draft: ChatDraft) {
    setSubmitting(true);
    try {
      const result = await createConversation("CHAT", draft.content || "新聊天");
      storeChatDraft(result.item.id, draft);
      router.push(`/ai/chat/${result.item.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-white">
      <div className="absolute right-6 top-5 size-4 rounded-full border border-dashed border-zinc-400" />
      <section className="flex min-h-screen flex-col items-center justify-center px-4 pb-28">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-950">{greeting}</h1>
        <ChatComposer onSubmit={submit} disabled={submitting} models={models} />
      </section>
    </div>
  );
}
