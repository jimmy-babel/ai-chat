"use client";

import { Check, Copy } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import type { AssetDto, ChatMessageDto } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function attachmentDtos(attachments: unknown): AssetDto[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((item): item is AssetDto => {
    return Boolean(item && typeof item === "object" && "id" in item && "url" in item);
  });
}

export function MessageList({
  messages,
}: {
  messages: ChatMessageDto[];
  streaming?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-5 pb-10 pt-16">
      <div className="space-y-7">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {/* {streaming && (
          <div className="flex items-center gap-2 pl-1 text-sm text-zinc-500">
            <span className="size-2 animate-pulse rounded-full bg-zinc-400" />
            已思考若干秒
          </div>
        )} */}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessageDto }) {
  const isUser = message.role === "USER";
  const attachments = attachmentDtos(message.attachments);
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    await navigator.clipboard.writeText(message.content || "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] space-y-2">
          {attachments.length > 0 && (
            <div className="flex justify-end gap-2">
              {attachments.map((asset) => (
                <Image
                  key={asset.id}
                  src={asset.url}
                  alt={asset.originalName || "用户图片"}
                  width={112}
                  height={112}
                  unoptimized
                  className="rounded-2xl border border-zinc-200 object-cover"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div className="rounded-[15px] bg-zinc-100 px-4 py-2 text-sm leading-7 text-zinc-900">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group max-w-[78%] space-y-3">
      {message.status === "FAILED" ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {message.errorMessage || "回复失败"}
        </div>
      ) : (
        <div
          className={cn(
            "whitespace-pre-wrap text-[15px] leading-8 text-zinc-950",
            !message.content && "text-zinc-400",
          )}
        >
          <div className={cn(!message.content && "thinking" || "")}>
            {message.content || "正在思考"}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 text-zinc-500 opacity-0 transition group-hover:opacity-100">
        <Button variant="ghost" size="iconSm" onClick={copy} aria-label="复制">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        {/* <Button variant="ghost" size="iconSm" aria-label="点赞">
          <ThumbsUp className="size-4" />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="点踩">
          <ThumbsDown className="size-4" />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="重新生成">
          <RefreshCcw className="size-4" />
        </Button>
        <Button variant="ghost" size="iconSm" aria-label="更多">
          <MoreHorizontal className="size-4" />
        </Button> */}
      </div>
    </div>
  );
}
