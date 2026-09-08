"use client";

import { ImagePlus, Mic, Plus, Send, X } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import type { AssetDto, ChatDraft } from "@/lib/api-types";
import { uploadAsset } from "@/lib/client-api";
import { chatConfig } from "@/lib/config";
import type { PublicModel, ReasoningEffort } from "@/lib/models";
import { validReasoningEffort } from "@/lib/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/model-selector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ChatComposer({
  conversationId,
  onSubmit,
  disabled,
  compact = false,
  models,
}: {
  conversationId?: string;
  onSubmit: (draft: ChatDraft) => Promise<void> | void;
  disabled?: boolean;
  compact?: boolean;
  models: PublicModel[];
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [content, setContent] = React.useState("");
  const [assets, setAssets] = React.useState<AssetDto[]>([]);
  const [selectedModelId, setSelectedModelId] = React.useState(models[0]?.id ?? chatConfig.model);
  const [reasoningEffort, setReasoningEffort] = React.useState<ReasoningEffort>(
    models[0]?.defaultReasoningEffort ?? "high",
  );
  const [uploading, setUploading] = React.useState(false);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? models[0];

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedModelId = window.localStorage.getItem("ai-chat:selected-model") || undefined;
      const storedModel = models.find((model) => model.id === storedModelId) ?? models[0];
      if (!storedModel) return;
      const storedEffort =
        window.localStorage.getItem(`ai-chat:reasoning:${storedModel.id}`) || undefined;
      setSelectedModelId(storedModel.id);
      setReasoningEffort(validReasoningEffort(storedModel, storedEffort));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [models]);

  function selectModel(model: PublicModel) {
    if (assets.length > 0 && !model.supportsChatImages) return;
    setSelectedModelId(model.id);
    window.localStorage.setItem("ai-chat:selected-model", model.id);
    const storedEffort = window.localStorage.getItem(`ai-chat:reasoning:${model.id}`) || undefined;
    setReasoningEffort(validReasoningEffort(model, storedEffort));
  }

  function selectReasoning(effort: ReasoningEffort) {
    if (!selectedModel) return;
    setReasoningEffort(effort);
    window.localStorage.setItem(`ai-chat:reasoning:${selectedModel.id}`, effort);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextFiles = Array.from(files).slice(0, chatConfig.maxImageInputs - assets.length);
    if (!nextFiles.length) return;

    setUploading(true);
    try {
      const uploaded: AssetDto[] = [];
      for (const file of nextFiles) {
        const result = await uploadAsset({
          file,
          kind: "CHAT_INPUT",
          conversationId,
        });
        uploaded.push(result.item);
      }
      setAssets((current) => [...current, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit() {
    const trimmed = content.trim();
    if ((!trimmed && assets.length === 0) || disabled || uploading) return;

    const draft = {
      content: trimmed,
      assetIds: assets.map((asset) => asset.id),
      model: selectedModel?.id ?? models[0]?.id ?? chatConfig.model,
      reasoningEffort,
    };

    setContent("");
    setAssets([]);
    await onSubmit(draft);
  }

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[760px]",
        compact ? "px-3" : "px-4",
      )}
    >
      {assets.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {assets.map((asset) => (
            <div key={asset.id} className="group relative size-16 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
              <Image
                src={asset.url}
                alt={asset.originalName || "上传图片"}
                fill
                sizes="64px"
                unoptimized
                className="object-cover"
              />
              <button
                type="button"
                onClick={() => setAssets((current) => current.filter((item) => item.id !== asset.id))}
                className="absolute right-1 top-1 cursor-pointer rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                aria-label="移除图片"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-12 items-center gap-2 rounded-[26px] border border-zinc-200 bg-white p-2 shadow-[0_8px_34px_rgba(15,23,42,0.10)]">
        <input
          ref={fileInputRef}
          type="file"
          accept={chatConfig.allowedImageTypes.join(",")}
          multiple
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => fileInputRef.current?.click()}
              disabled={
                disabled ||
                uploading ||
                !selectedModel?.supportsChatImages ||
                assets.length >= chatConfig.maxImageInputs
              }
              aria-label="上传图片"
            >
              <Plus className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {selectedModel?.supportsChatImages ? "上传图片" : "当前模型暂不支持本地图片附件"}
          </TooltipContent>
        </Tooltip>
        <textarea
          value={content}
          rows={1}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="有问题，尽管问"
          className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400"
          disabled={disabled}
        />
        <ModelSelector
          models={models}
          value={selectedModel?.id ?? ""}
          onModelChange={selectModel}
          reasoningEffort={reasoningEffort}
          onReasoningChange={selectReasoning}
          disabled={disabled}
          disabledModelIds={
            assets.length > 0 ? models.filter((model) => !model.supportsChatImages).map((model) => model.id) : []
          }
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="语音输入" disabled>
              <Mic className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>语音输入暂未开放</TooltipContent>
        </Tooltip>
        <Button
          size="icon"
          onClick={submit}
          disabled={disabled || uploading || (!content.trim() && assets.length === 0)}
          aria-label="发送"
          className="bg-black text-white hover:bg-zinc-800"
        >
          {uploading ? <ImagePlus className="size-5 animate-pulse" /> : <Send className="size-5" />}
        </Button>
      </div>
    </div>
  );
}
