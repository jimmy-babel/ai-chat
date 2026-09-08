"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileImage,
  ImagePlus,
  Loader2,
  Mic,
  Minus,
  Paperclip,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { AssetDto, ConversationDetail, ImageDraft } from "@/lib/api-types";
import type { PublicModel } from "@/lib/models";
import {
  createConversation,
  fetchConversation,
  refreshHistory,
  storeImageDraft,
  takeImageDraft,
  uploadAsset,
} from "@/lib/client-api";
import { imageConfig, type ImageParams } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ModelSelector } from "@/components/model-selector";

type ParamsState = ImageParams;
const RESULTS_PER_PAGE = 4;

function paramsForModel(current: ParamsState, model: PublicModel): ParamsState {
  if (model.provider !== "agnes") {
    return { ...imageConfig.defaults, aspectRatio: current.aspectRatio, model: model.id };
  }
  return {
    ...current,
    model: model.id,
    size: "1K",
    n: 1,
    quality: "high",
    outputFormat: "png",
    outputCompression: 100,
    moderation: "auto",
  };
}

function outputAssets(conversation: ConversationDetail | null) {
  return conversation?.assets.filter((asset) => asset.kind === "IMAGE_OUTPUT") ?? [];
}

function idsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function ImageStudio({ id, models }: { id?: string; models: PublicModel[] }) {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [conversation, setConversation] = React.useState<ConversationDetail | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [referenceAssets, setReferenceAssets] = React.useState<AssetDto[]>([]);
  const [params, setParams] = React.useState<ParamsState>({
    ...imageConfig.defaults,
    model: models[0]?.id ?? imageConfig.defaults.model,
  });
  const [selectedAssetId, setSelectedAssetId] = React.useState<string | undefined>();
  const [resultPage, setResultPage] = React.useState(0);
  const [generating, setGenerating] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const startedDraftRef = React.useRef(false);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedModelId = window.localStorage.getItem("ai-image:selected-model") || undefined;
      const storedModel = models.find((model) => model.id === storedModelId) ?? models[0];
      if (!storedModel) return;
      setParams((current) => paramsForModel(current, storedModel));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [models]);

  function selectImageModel(model: PublicModel) {
    window.localStorage.setItem("ai-image:selected-model", model.id);
    setParams((current) => paramsForModel(current, model));
  }

  const outputs = outputAssets(conversation);
  const selectedAsset =
    outputs.find((asset) => asset.id === selectedAssetId) ||
    outputs.find((asset) => asset.id === conversation?.activeAssetId) ||
    outputs.at(-1);
  const resultPageCount = Math.max(1, Math.ceil(outputs.length / RESULTS_PER_PAGE));
  const visibleResultPage = Math.min(resultPage, resultPageCount - 1);
  const pagedOutputs = outputs.slice(
    visibleResultPage * RESULTS_PER_PAGE,
    visibleResultPage * RESULTS_PER_PAGE + RESULTS_PER_PAGE,
  );
  const canPageBack = outputs.length > 0 && visibleResultPage > 0;
  const canPageForward = outputs.length > 0 && visibleResultPage < resultPageCount - 1;

  const load = React.useCallback(async () => {
    if (!id) return null;
    const result = await fetchConversation(id);
    if (result.item.type !== "IMAGE") {
      router.replace(`/ai/chat/${id}`);
      return null;
    }
    setConversation(result.item);
    const latestTurn = result.item.imageTurns.at(-1);
    if (latestTurn) setPrompt(latestTurn.prompt);
    const loadedOutputs = result.item.assets.filter((asset) => asset.kind === "IMAGE_OUTPUT");
    const activeId = latestTurn?.activeAssetId || result.item.activeAssetId || loadedOutputs.at(-1)?.id;
    if (activeId) {
      setSelectedAssetId(activeId);
      const activeIndex = loadedOutputs.findIndex((asset) => asset.id === activeId);
      if (activeIndex >= 0) setResultPage(Math.floor(activeIndex / RESULTS_PER_PAGE));
    }
    return result.item;
  }, [id, router]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const slots = imageConfig.maxReferenceImages - referenceAssets.length;
    const nextFiles = Array.from(files).slice(0, slots);
    if (!nextFiles.length) return;

    setUploading(true);
    try {
      const uploaded: AssetDto[] = [];
      for (const file of nextFiles) {
        const result = await uploadAsset({
          file,
          kind: "IMAGE_REFERENCE",
          conversationId: id,
        });
        uploaded.push(result.item);
      }
      setReferenceAssets((current) => [...current, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const generate = React.useCallback(async (conversationId: string, draft: ImageDraft) => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch(`/api/image/${conversationId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || "生成失败");
      await load();
      refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }, [load]);

  async function submit() {
    const trimmed = prompt.trim();
    if (!trimmed || generating || uploading) return;

    const draft: ImageDraft = {
      prompt: trimmed,
      params,
      referenceAssetIds: referenceAssets.map((asset) => asset.id),
      baseAssetId: selectedAssetId,
      activeAssetId: selectedAssetId,
    };

    if (!id) {
      const result = await createConversation("IMAGE", trimmed);
      storeImageDraft(result.item.id, draft);
      router.push(`/ai/image/${result.item.id}`);
      return;
    }

    await generate(id, draft);
  }

  React.useEffect(() => {
    let alive = true;
    async function init() {
      const loaded = await load();
      if (!alive || !id || startedDraftRef.current) return;
      startedDraftRef.current = true;
      const draft = takeImageDraft(id);
      if (draft) {
        setPrompt(draft.prompt);
        setParams({ ...imageConfig.defaults, ...draft.params });
        await generate(id, draft);
      } else if (loaded) {
        const latestTurn = loaded.imageTurns.at(-1);
        const refIds = idsFromUnknown(latestTurn?.referenceAssetIds);
        setReferenceAssets(loaded.assets.filter((asset) => refIds.includes(asset.id)));
      }
    }
    init();
    return () => {
      alive = false;
    };
  }, [generate, id, load]);

  return (
    <div className="min-h-full bg-[#dfe2df] p-2 md:p-10">
      {/* <header className="mb-6 flex h-[74px] items-center rounded-[28px] bg-white px-6 text-xl font-medium shadow-sm">
        Daydream Image Studio
      </header> */}
      <div className="grid min-h-[calc(100vh-24px)] gap-6 lg:grid-cols-[272px_minmax(420px,1fr)_272px]">
        <aside className="rounded-[28px] bg-white px-6 py-7 shadow-sm">
          <h1 className="mb-8 text-2xl font-semibold tracking-tight">创作台</h1>
          <label className="mb-3 block text-sm text-zinc-500">Prompt</label>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="写下你想看见的画面：材质、光线、气息与构图都可以慢慢展开..."
            className="min-h-36 border-0 bg-zinc-100 text-base leading-8 shadow-none focus:ring-0"
          />
          <div className="mt-7">
            <label className="mb-3 block text-sm text-zinc-500">风格参考</label>
            <input
              ref={fileRef}
              type="file"
              accept={imageConfig.allowedImageTypes.join(",")}
              multiple
              className="hidden"
              onChange={(event) => handleFiles(event.target.files)}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 justify-between rounded-2xl"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || referenceAssets.length >= imageConfig.maxReferenceImages}
              >
                选择参考图
                <Paperclip className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="rounded-2xl" disabled>
                <Mic className="size-4" />
              </Button>
            </div>
            {referenceAssets.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {referenceAssets.map((asset) => (
                  <div key={asset.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-zinc-100">
                    <Image
                      src={asset.url}
                      alt={asset.originalName || "参考图"}
                      fill
                      sizes="110px"
                      unoptimized
                      className="object-cover"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-2 cursor-pointer rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                      onClick={() => setReferenceAssets((current) => current.filter((item) => item.id !== asset.id))}
                      aria-label="移除参考图"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="mt-8 rounded-[26px] bg-white shadow-[0_-18px_40px_rgba(255,255,255,0.85)]">
            <Button
              size="lg"
              className="h-14 w-full rounded-2xl text-base"
              onClick={submit}
              disabled={!prompt.trim() || generating || uploading}
            >
              {generating ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
              生成
            </Button>
          </div>
        </aside>

        {/* <main className="space-y-8 rounded-[30px] bg-[#eef1ed] p-6 shadow-[0_24px_70px_rgba(69,75,68,0.12)]"> */}
        <main className="space-y-8 rounded-[30px] pl-1 pr-1">
          <div className="rounded-[28px] bg-[#f7f9f6] p-5 shadow-[0_24px_54px_rgba(63,70,62,0.10)]">
            <div className="flex min-h-[640px] flex-col items-center justify-center rounded-[22px] border border-dashed border-zinc-300/80 bg-[radial-gradient(circle_at_center,#fbfcfb_0,#f4f7f4_34%,#e7ece8_100%)]">
              {selectedAsset ? (
                <div className="relative h-[620px] w-full max-w-[620px] overflow-hidden rounded-[22px]">
                  <Image
                    src={selectedAsset.url}
                    alt="生成图片"
                    fill
                    sizes="620px"
                    unoptimized
                    className="object-contain"
                  />
                </div>
              ) : generating ? (
                <div className="flex flex-col items-center gap-4 text-sm text-zinc-500">
                  <Loader2 className="size-8 animate-spin" />
                  正在生成画面...
                </div>
              ) : (
                <div className="max-w-72 text-center text-sm leading-7 text-slate-600">
                  生成完成，或点选最近作品后，画面会在这里展开。
                </div>
              )}
            </div>
          </div>
          {error && <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <section>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-base tracking-tight text-zinc-950 pl-1">生成结果</h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 border-zinc-200/80 bg-[#eef1ed] text-zinc-400 shadow-none hover:bg-white"
                  disabled={!canPageBack}
                  onClick={() => setResultPage((page) => Math.max(0, page - 1))}
                  aria-label="上一页生成结果"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 border-zinc-200/80 bg-[#eef1ed] text-zinc-400 shadow-none hover:bg-white"
                  disabled={!canPageForward}
                  onClick={() =>
                    setResultPage((page) => Math.min(resultPageCount - 1, page + 1))
                  }
                  aria-label="下一页生成结果"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            {outputs.length > 0 ? (
              <div className="grid min-h-32 grid-cols-2 gap-3 rounded-[28px] border border-dashed border-zinc-300/80 bg-[#f7f9f6]/90 p-4 sm:grid-cols-4">
                {pagedOutputs.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={cn(
                      "relative aspect-square cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:scale-[1.01]",
                      selectedAsset?.id === asset.id ? "border-zinc-950" : "border-transparent",
                    )}
                  >
                    <Image
                      src={asset.url}
                      alt="生成缩略图"
                      fill
                      sizes="160px"
                      unoptimized
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex min-h-32 flex-col items-center justify-center rounded-[28px] border border-dashed border-zinc-300/80 bg-[#f7f9f6]/90 text-center text-sm leading-7 text-slate-500">
                <FileImage className="mb-3 size-6 text-slate-500" />
                还没有作品，先开始一次生成。
              </div>
            )}
          </section>
        </main>

        <ParameterPanel
          params={params}
          onChange={setParams}
          generating={generating}
          models={models}
          onModelChange={selectImageModel}
        />
      </div>
    </div>
  );
}

function ParameterPanel({
  params,
  onChange,
  generating,
  models,
  onModelChange,
}: {
  params: ParamsState;
  onChange: React.Dispatch<React.SetStateAction<ParamsState>>;
  generating: boolean;
  models: PublicModel[];
  onModelChange: (model: PublicModel) => void;
}) {
  function set<K extends keyof ParamsState>(key: K, value: ParamsState[K]) {
    onChange((current) => ({ ...current, [key]: value }));
  }

  const selectedModel = models.find((model) => model.id === params.model) ?? models[0];
  const controls = selectedModel?.imageControls;

  return (
    <aside className="rounded-[28px] bg-white px-6 py-7 shadow-sm">
      <h2 className="mb-8 text-2xl font-semibold tracking-tight">参数</h2>

      {imageConfig.visibleParams.aspectRatio && (
        <Control label="画面比例" value={params.aspectRatio}>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-zinc-100 p-1">
            {imageConfig.aspectRatioOptions.map((option) => (
              <button
                key={option}
                type="button"
                disabled={generating}
                onClick={() => set("aspectRatio", option)}
                className={cn(
                  "h-10 cursor-pointer rounded-xl text-sm text-zinc-500 transition disabled:cursor-not-allowed",
                  params.aspectRatio === option && "bg-zinc-950 text-white",
                )}
              >
                {option === "auto" ? "Auto" : option}
              </button>
            ))}
          </div>
        </Control>
      )}

      {imageConfig.visibleParams.model && (
        <Control label="模型">
          <ModelSelector
            models={models}
            value={params.model}
            disabled={generating}
            onModelChange={onModelChange}
            className="h-14 w-full max-w-none justify-between rounded-2xl bg-zinc-50 px-4 text-sm"
          />
        </Control>
      )}

      {imageConfig.visibleParams.quality && controls?.quality !== false && (
        <Control label="创作约束" value={params.quality}>
          <Segmented
            options={imageConfig.qualityOptions}
            value={params.quality}
            onChange={(value) => set("quality", value as ParamsState["quality"])}
            disabled={generating}
          />
        </Control>
      )}

      {imageConfig.visibleParams.n && controls?.n !== false && (
        <Control label="批量数量" value={String(params.n)}>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => set("n", Math.max(1, params.n - 1))}
              disabled={generating}
            >
              <Minus className="size-4" />
            </Button>
            <div className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-zinc-100 text-xl">
              {params.n}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => set("n", Math.min(10, params.n + 1))}
              disabled={generating}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </Control>
      )}

      {imageConfig.visibleParams.outputFormat && controls?.outputFormat !== false && (
        <Control label="输出格式" value={params.outputFormat.toUpperCase()}>
          <Segmented
            options={imageConfig.outputFormatOptions}
            value={params.outputFormat}
            onChange={(value) => set("outputFormat", value as ParamsState["outputFormat"])}
            disabled={generating}
          />
        </Control>
      )}

      {imageConfig.visibleParams.outputCompression && controls?.outputCompression !== false && (
        <Control label="压缩" value={`${params.outputCompression}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={params.outputCompression}
            disabled={generating}
            onChange={(event) => set("outputCompression", Number(event.target.value))}
            className="w-full accent-zinc-950"
          />
        </Control>
      )}

      {imageConfig.visibleParams.moderation && controls?.moderation !== false && (
        <Control label="审核强度" value={params.moderation}>
          <Segmented
            options={imageConfig.moderationOptions}
            value={params.moderation}
            onChange={(value) => set("moderation", value as ParamsState["moderation"])}
            disabled={generating}
          />
        </Control>
      )}

      <div className="mt-8 rounded-3xl bg-zinc-50 p-4 text-xs leading-6 text-zinc-500">
        <ImagePlus className="mb-2 size-4" />
        参考图上限、mask、stream、partial_images 和透明背景都在静态配置里预留，可按 API 能力逐步开放。
      </div>
    </aside>
  );
}

function Control({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-zinc-500">{label}</span>
        {value && <span className="font-medium text-zinc-600">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-2xl bg-zinc-100 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "h-10 cursor-pointer rounded-xl text-sm text-zinc-500 transition disabled:cursor-not-allowed",
            value === option && "bg-zinc-950 text-white",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
