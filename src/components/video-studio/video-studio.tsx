"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Clock3,
  Download,
  Film,
  ImagePlus,
  Library,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import type {
  AssetDto,
  ConversationDetail,
  VideoDraft,
  VideoTurnDto,
} from "@/lib/api-types";
import { videoConfig, type VideoMode, type VideoParams } from "@/lib/config";
import {
  createConversation,
  createVideoTurn,
  fetchAssetLibrary,
  fetchConversation,
  refreshHistory,
  refreshVideoTurn,
  storeVideoDraft,
  takeVideoDraft,
  uploadAsset,
} from "@/lib/client-api";
import type { PublicModel } from "@/lib/models";
import { referencesForVideoMode } from "@/lib/video-draft";
import { cn } from "@/lib/utils";
import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";

type ReferenceShape = {
  images?: string[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
};

const modeCopy: Record<VideoMode, { label: string; description: string }> = {
  text: { label: "文生视频", description: "只用提示词构建镜头" },
  keyframe: { label: "首尾帧", description: "控制视频起止画面" },
  reference: { label: "参考素材", description: "复用角色、风格或动作" },
};

function isActive(turn: VideoTurnDto) {
  return turn.status === "PENDING" || turn.status === "STREAMING";
}

function paramsFromUnknown(value: unknown, fallback: VideoParams): VideoParams {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Partial<VideoParams>;
  return {
    model: typeof record.model === "string" ? record.model : fallback.model,
    mode: videoConfig.modes.includes(record.mode as never) ? (record.mode as VideoMode) : fallback.mode,
    aspectRatio: videoConfig.aspectRatios.includes(record.aspectRatio as never)
      ? (record.aspectRatio as VideoParams["aspectRatio"])
      : fallback.aspectRatio,
    size: videoConfig.sizes.includes(record.size as never)
      ? (record.size as VideoParams["size"])
      : fallback.size,
    seconds:
      typeof record.seconds === "number" && record.seconds >= 4 && record.seconds <= 12
        ? record.seconds
        : fallback.seconds,
  };
}

function referencesFromUnknown(value: unknown): ReferenceShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    images: Array.isArray(record.images)
      ? record.images.filter((item): item is string => typeof item === "string")
      : [],
    firstFrameAssetId:
      typeof record.firstFrameAssetId === "string" ? record.firstFrameAssetId : undefined,
    lastFrameAssetId:
      typeof record.lastFrameAssetId === "string" ? record.lastFrameAssetId : undefined,
    referenceVideoAssetId:
      typeof record.referenceVideoAssetId === "string"
        ? record.referenceVideoAssetId
        : undefined,
  };
}

export function VideoStudio({ id, models }: { id?: string; models: PublicModel[] }) {
  const router = useRouter();
  const promptRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const uploadTargetRef = React.useRef<"images" | "first" | "last">("images");
  const draftStartedRef = React.useRef(false);
  const pollStartedAtRef = React.useRef<number | null>(null);
  const [conversation, setConversation] = React.useState<ConversationDetail | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [params, setParams] = React.useState<VideoParams>({
    ...videoConfig.defaults,
    model: models[0]?.id ?? videoConfig.model,
  });
  const [referenceImageIds, setReferenceImageIds] = React.useState<string[]>([]);
  const [firstFrameId, setFirstFrameId] = React.useState<string>();
  const [lastFrameId, setLastFrameId] = React.useState<string>();
  const [referenceVideoId, setReferenceVideoId] = React.useState<string>();
  const [selectedTurnId, setSelectedTurnId] = React.useState<string>();
  const [uploading, setUploading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [pollTimedOut, setPollTimedOut] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [libraryMedia, setLibraryMedia] = React.useState<"image" | "video">("image");
  const [libraryItems, setLibraryItems] = React.useState<AssetDto[]>([]);
  const [libraryLoading, setLibraryLoading] = React.useState(false);
  const [stagedAssets, setStagedAssets] = React.useState<AssetDto[]>([]);

  const selectedModel = models.find((model) => model.id === params.model) ?? models[0];
  const capabilities = selectedModel?.videoCapabilities;
  const turns = conversation?.videoTurns ?? [];
  const activeTurn = turns.findLast(isActive);
  const activeTurnId = activeTurn?.id;
  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? turns.at(-1);
  const availableAssets = React.useMemo(() => {
    const assets = [...(conversation?.assets ?? []), ...stagedAssets];
    return Array.from(new Map(assets.map((asset) => [asset.id, asset])).values());
  }, [conversation?.assets, stagedAssets]);
  const selectedOutput = availableAssets.find(
    (asset) => asset.id === selectedTurn?.outputAssetId,
  );
  const videoSource = selectedOutput?.url || selectedTurn?.remoteUrl || undefined;
  const busy = creating || uploading || Boolean(activeTurn);

  const assetById = React.useCallback(
    (assetId: string | undefined) => availableAssets.find((asset) => asset.id === assetId),
    [availableAssets],
  );

  const rememberAssets = React.useCallback((assets: AssetDto[]) => {
    setStagedAssets((current) => {
      const merged = [...current, ...assets];
      return Array.from(new Map(merged.map((asset) => [asset.id, asset])).values());
    });
  }, []);

  const applyLoadedTurn = React.useCallback(
    (item: ConversationDetail) => {
      const latest = item.videoTurns.at(-1);
      if (!latest) return;
      const nextParams = paramsFromUnknown(latest.params, {
        ...videoConfig.defaults,
        model: models[0]?.id ?? videoConfig.model,
      });
      const refs = referencesFromUnknown(latest.referenceAssetIds);
      setPrompt(latest.prompt);
      setParams(nextParams);
      setReferenceImageIds(refs.images ?? []);
      setFirstFrameId(refs.firstFrameAssetId);
      setLastFrameId(refs.lastFrameAssetId);
      setReferenceVideoId(refs.referenceVideoAssetId);
      setSelectedTurnId((current) => current ?? latest.id);
    },
    [models],
  );

  const load = React.useCallback(async () => {
    if (!id) return null;
    const result = await fetchConversation(id);
    if (result.item.type !== "VIDEO") {
      router.replace(`/ai/chat/${id}`);
      return null;
    }
    setConversation(result.item);
    applyLoadedTurn(result.item);
    return result.item;
  }, [applyLoadedTurn, id, router]);

  const startTurn = React.useCallback(
    async (conversationId: string, draft: VideoDraft) => {
      setCreating(true);
      setError(null);
      setPollTimedOut(false);
      pollStartedAtRef.current = Date.now();
      try {
        const result = await createVideoTurn(conversationId, {
          clientRequestId: crypto.randomUUID(),
          prompt: draft.prompt,
          params: draft.params,
          referenceImageAssetIds: draft.referenceImageAssetIds,
          firstFrameAssetId: draft.firstFrameAssetId,
          lastFrameAssetId: draft.lastFrameAssetId,
          referenceVideoAssetId: draft.referenceVideoAssetId,
        });
        setConversation((current) =>
          current
            ? {
                ...current,
                videoTurns: [
                  ...current.videoTurns.filter((turn) => turn.id !== result.item.id),
                  result.item,
                ],
              }
            : current,
        );
        setSelectedTurnId(result.item.id);
        refreshHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : "视频任务创建失败");
        await load();
      } finally {
        setCreating(false);
      }
    },
    [load],
  );

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = window.localStorage.getItem("ai-video:params");
      if (!stored) return;
      try {
        const next = paramsFromUnknown(JSON.parse(stored), {
          ...videoConfig.defaults,
          model: models[0]?.id ?? videoConfig.model,
        });
        const model = models.find((item) => item.id === next.model) ?? models[0];
        if (!model?.videoCapabilities) return;
        setParams({
          ...next,
          model: model.id,
          size: model.videoCapabilities.sizes.includes(next.size)
            ? next.size
            : model.videoCapabilities.sizes[0],
        });
      } catch {
        window.localStorage.removeItem("ai-video:params");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [models]);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    queueMicrotask(() => {
      void load().then((item) => {
        if (cancelled || !item || draftStartedRef.current) return;
        draftStartedRef.current = true;
        const draft = takeVideoDraft(id);
        if (!draft) return;
        setPrompt(draft.prompt);
        setParams(paramsFromUnknown(draft.params, videoConfig.defaults));
        setReferenceImageIds(draft.referenceImageAssetIds);
        setFirstFrameId(draft.firstFrameAssetId);
        setLastFrameId(draft.lastFrameAssetId);
        setReferenceVideoId(draft.referenceVideoAssetId);
        setStagedAssets(draft.stagedAssets ?? []);
        void startTurn(id, draft);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id, load, startTurn]);

  React.useEffect(() => {
    if (!id || !activeTurnId || pollTimedOut) return;
    let cancelled = false;
    let timeoutId: number | undefined;
    let failureCount = 0;
    pollStartedAtRef.current ??= Date.now();

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - (pollStartedAtRef.current ?? Date.now()) > 15 * 60 * 1000) {
        setPollTimedOut(true);
        return;
      }
      try {
        const result = await refreshVideoTurn(id, activeTurnId);
        failureCount = 0;
        setError(null);
        setConversation((current) =>
          current
            ? {
                ...current,
                videoTurns: current.videoTurns.map((turn) =>
                  turn.id === result.item.id ? result.item : turn,
                ),
              }
            : current,
        );
        if (result.item.status === "COMPLETED" || result.item.status === "FAILED") {
          await load();
          refreshHistory();
          return;
        }
        timeoutId = window.setTimeout(tick, result.retryAfterMs ?? 2000);
      } catch (err) {
        failureCount += 1;
        setError(err instanceof Error ? err.message : "查询视频状态失败");
        const backoff = [2000, 4000, 8000, 10000][Math.min(failureCount - 1, 3)];
        timeoutId = window.setTimeout(tick, backoff);
      }
    };
    timeoutId = window.setTimeout(tick, 600);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [activeTurnId, id, load, pollTimedOut]);

  React.useEffect(() => {
    if (!libraryOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLibraryLoading(true);
      void fetchAssetLibrary(libraryMedia)
        .then((result) => {
          if (!cancelled) setLibraryItems(result.items);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "素材库加载失败");
        })
        .finally(() => {
          if (!cancelled) setLibraryLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [libraryMedia, libraryOpen]);

  function persistParams(next: VideoParams) {
    setParams(next);
    window.localStorage.setItem("ai-video:params", JSON.stringify(next));
  }

  function selectModel(model: PublicModel) {
    const nextCapabilities = model.videoCapabilities;
    if (!nextCapabilities) return;
    persistParams({
      ...params,
      model: model.id,
      size: nextCapabilities.sizes.includes(params.size) ? params.size : nextCapabilities.sizes[0],
    });
  }

  function changeMode(mode: VideoMode) {
    persistParams({ ...params, mode });
  }

  function openUpload(target: "images" | "first" | "last") {
    uploadTargetRef.current = target;
    fileRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const target = uploadTargetRef.current;
    const limit = target === "images" ? videoConfig.maxReferenceImages - referenceImageIds.length : 1;
    const selected = Array.from(files).slice(0, Math.max(0, limit));
    if (!selected.length) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded: AssetDto[] = [];
      for (const file of selected) {
        const result = await uploadAsset({ file, kind: "VIDEO_REFERENCE", conversationId: id });
        uploaded.push(result.item);
      }
      if (target === "first") setFirstFrameId(uploaded[0]?.id);
      else if (target === "last") setLastFrameId(uploaded[0]?.id);
      else setReferenceImageIds((current) => [...current, ...uploaded.map((asset) => asset.id)]);
      rememberAssets(uploaded);
      setConversation((current) =>
        current ? { ...current, assets: [...current.assets, ...uploaded] } : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function insertToken(token: string) {
    const element = promptRef.current;
    if (!element) {
      setPrompt((current) => `${current}${current ? " " : ""}${token}`);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const next = `${prompt.slice(0, start)}${token}${prompt.slice(end)}`;
    setPrompt(next);
    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function chooseLibraryAsset(asset: AssetDto) {
    if (libraryMedia === "video") {
      if (!capabilities?.supportsVideoReferences) return;
      setReferenceVideoId(asset.id);
      insertToken("<Video 1>");
    } else if (params.mode === "keyframe") {
      if (!firstFrameId) setFirstFrameId(asset.id);
      else setLastFrameId(asset.id);
    } else {
      if (!referenceImageIds.includes(asset.id) && referenceImageIds.length < 5) {
        const nextIndex = referenceImageIds.length + 1;
        setReferenceImageIds((current) => [...current, asset.id]);
        insertToken(`<Picture ${nextIndex}>`);
      }
    }
    rememberAssets([asset]);
    setConversation((current) =>
      current && !current.assets.some((item) => item.id === asset.id)
        ? { ...current, assets: [...current.assets, asset] }
        : current,
    );
    setLibraryOpen(false);
  }

  function currentDraft(): VideoDraft {
    const references = referencesForVideoMode(params.mode, {
      referenceImageAssetIds: referenceImageIds,
      firstFrameAssetId: firstFrameId,
      lastFrameAssetId: lastFrameId,
      referenceVideoAssetId: referenceVideoId,
    });
    return {
      prompt: prompt.trim(),
      params,
      ...references,
      stagedAssets,
    };
  }

  async function submit() {
    const draft = currentDraft();
    if (!draft.prompt || busy) return;
    if (params.mode === "keyframe" && !draft.firstFrameAssetId && !draft.lastFrameAssetId) {
      setError("首尾帧模式至少需要一张图片");
      return;
    }
    if (
      params.mode === "reference" &&
      !draft.referenceImageAssetIds.length &&
      !draft.referenceVideoAssetId
    ) {
      setError("参考素材模式至少需要一项素材");
      return;
    }
    if (
      params.mode === "reference" &&
      draft.referenceVideoAssetId &&
      !capabilities?.supportsVideoReferences
    ) {
      setError("Flash 不支持参考视频，请移除该视频或切换到 AGNES Video 2.5");
      return;
    }
    if (!id) {
      setCreating(true);
      try {
        const result = await createConversation("VIDEO", draft.prompt);
        storeVideoDraft(result.item.id, draft);
        router.push(`/ai/video/${result.item.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "视频会话创建失败");
        setCreating(false);
      }
      return;
    }
    await startTurn(id, draft);
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-auto bg-[#e8ece8] p-5 text-zinc-950">
      <div className="pointer-events-none absolute inset-0 opacity-45 [background-image:radial-gradient(circle_at_20%_15%,rgba(255,255,255,.95),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(186,207,193,.55),transparent_25%)]" />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <div className="relative mx-auto grid min-h-[calc(100vh-40px)] max-w-[1560px] grid-cols-[minmax(270px,0.82fr)_minmax(430px,1.45fr)_minmax(260px,0.78fr)] gap-5 max-xl:grid-cols-[300px_minmax(420px,1fr)] max-lg:block">
        <aside className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_rgba(31,43,35,.08)] backdrop-blur max-lg:mb-5">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-zinc-950 text-white">
              <Clapperboard className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">视频创作台</h1>
              <p className="text-xs text-zinc-400">Scene · Motion · Rhythm</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">生成模式</div>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-zinc-100 p-1">
              {videoConfig.modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={busy}
                  onClick={() => changeMode(mode)}
                  className={cn(
                    "rounded-xl px-2 py-2 text-xs font-medium transition",
                    params.mode === mode ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-900",
                  )}
                >
                  {modeCopy[mode].label}
                </button>
              ))}
            </div>
            <p className="text-xs leading-5 text-zinc-400">{modeCopy[params.mode].description}</p>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">
              <span>Prompt</span>
              <span>{prompt.length}/32000</span>
            </div>
            <Textarea
              ref={promptRef}
              value={prompt}
              maxLength={32000}
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="描述主体、动作、镜头运动、光线与声音节奏……"
              className="min-h-40 resize-none rounded-2xl border-0 bg-zinc-100/80 p-4 text-sm leading-6 shadow-none focus:ring-1 focus:ring-zinc-300"
            />
          </div>

          {params.mode === "keyframe" && (
            <div className="mt-6 grid grid-cols-2 gap-3">
              <FrameSlot label="首帧" asset={assetById(firstFrameId)} onAdd={() => openUpload("first")} onRemove={() => setFirstFrameId(undefined)} />
              <FrameSlot label="尾帧" asset={assetById(lastFrameId)} onAdd={() => openUpload("last")} onRemove={() => setLastFrameId(undefined)} />
            </div>
          )}

          {params.mode === "reference" && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">参考素材</span>
                <span className="text-xs text-zinc-400">{referenceImageIds.length}/5</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {referenceImageIds.map((assetId, index) => (
                  <ReferenceChip
                    key={assetId}
                    asset={assetById(assetId)}
                    label={`Picture ${index + 1}`}
                    onInsert={() => insertToken(`<Picture ${index + 1}>`)}
                    onRemove={() => setReferenceImageIds((items) => items.filter((id) => id !== assetId))}
                  />
                ))}
                {referenceVideoId && (
                  <ReferenceChip
                    asset={assetById(referenceVideoId)}
                    label="Video 1"
                    video
                    onInsert={() => insertToken("<Video 1>")}
                    onRemove={() => setReferenceVideoId(undefined)}
                  />
                )}
              </div>
            </div>
          )}

          {params.mode !== "text" && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy || (params.mode === "reference" && referenceImageIds.length >= 5)}
                onClick={() => openUpload(params.mode === "reference" ? "images" : firstFrameId ? "last" : "first")}
                className="rounded-xl"
              >
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                本地图片
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setLibraryOpen(true)} className="rounded-xl">
                <Library className="size-4" />
                AGNES 素材
              </Button>
            </div>
          )}

          {error && (
            <div className="mt-4 flex gap-2 rounded-2xl border border-red-100 bg-red-50 p-3 text-xs leading-5 text-red-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="button"
            disabled={!prompt.trim() || busy}
            onClick={() => void submit()}
            className="mt-6 h-14 w-full rounded-2xl bg-zinc-950 text-base text-white hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />}
            {activeTurn ? `生成中 ${activeTurn.progress}%` : creating ? "正在创建任务" : "开始生成"}
          </Button>
        </aside>

        <main className="flex min-h-[620px] flex-col rounded-[30px] bg-[#121514] p-5 text-white shadow-[0_28px_80px_rgba(20,27,22,.18)] max-lg:mb-5">
          <div className="flex items-center justify-between px-1 pb-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-white/40">Preview Monitor</div>
              <div className="mt-1 text-sm text-white/70">{selectedTurn ? `${selectedTurn.model} · ${selectedTurn.mode}` : "等待第一个镜头"}</div>
            </div>
            {selectedTurn?.status === "COMPLETED" && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">
                <CheckCircle2 className="size-3.5" /> Completed
              </span>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-black">
            <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:40px_40px]" />
            {videoSource ? (
              <video key={videoSource} src={videoSource} controls playsInline className="relative z-10 max-h-full max-w-full object-contain" />
            ) : selectedTurn && isActive(selectedTurn) ? (
              <ProgressStage turn={selectedTurn} timedOut={pollTimedOut} />
            ) : selectedTurn?.status === "FAILED" ? (
              <div className="relative z-10 max-w-md px-8 text-center">
                <AlertCircle className="mx-auto size-10 text-red-300" />
                <h2 className="mt-4 text-lg font-medium">这个镜头没有生成完成</h2>
                <p className="mt-2 text-sm leading-6 text-white/50">{selectedTurn.errorMessage}</p>
                <Button type="button" variant="outline" className="mt-5 border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={() => void submit()}>
                  <RotateCcw className="size-4" /> 使用当前参数重试
                </Button>
              </div>
            ) : selectedTurn?.status === "COMPLETED" ? (
              <div className="relative z-10 text-center text-white/50">
                <Play className="mx-auto size-12" />
                <p className="mt-3 text-sm">Mock 任务已完成，配置 API Key 后会显示真实视频</p>
              </div>
            ) : (
              <div className="relative z-10 max-w-sm px-8 text-center">
                <div className="mx-auto grid size-20 place-items-center rounded-full border border-white/10 bg-white/5">
                  <Film className="size-8 text-white/55" />
                </div>
                <h2 className="mt-6 text-xl font-medium">把一句描述变成一段镜头</h2>
                <p className="mt-2 text-sm leading-6 text-white/40">选择模式、补充参考素材，然后开始生成。离开页面后任务仍会在 AGNES 侧继续。</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex min-h-20 items-center gap-3 overflow-x-auto pb-1">
            {turns.map((turn) => (
              <button
                key={turn.id}
                type="button"
                onClick={() => setSelectedTurnId(turn.id)}
                className={cn(
                  "min-w-44 rounded-2xl border px-4 py-3 text-left transition",
                  selectedTurn?.id === turn.id ? "border-white/35 bg-white/10" : "border-white/10 bg-white/[.035] hover:bg-white/[.07]",
                )}
              >
                <div className="flex items-center justify-between text-[11px] text-white/40">
                  <span>SHOT {String(turn.sequence).padStart(2, "0")}</span>
                  <span>{turn.status === "COMPLETED" ? "DONE" : turn.status === "FAILED" ? "FAILED" : `${turn.progress}%`}</span>
                </div>
                <div className="mt-1 truncate text-xs text-white/75">{turn.prompt}</div>
              </button>
            ))}
          </div>
        </main>

        <aside className="rounded-[28px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_rgba(31,43,35,.08)] backdrop-blur max-xl:col-span-2 max-xl:grid max-xl:grid-cols-4 max-xl:gap-5 max-lg:block">
          <div className="mb-6 space-y-3 max-xl:col-span-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">镜头参数</h2>
              <p className="mt-1 text-xs text-zinc-400">输出格式由模型能力约束</p>
            </div>
            {videoSource && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !selectedOutput?.remoteUrl || !capabilities?.supportsVideoReferences}
                  title={!capabilities?.supportsVideoReferences ? "请先手动切换到 AGNES Video 2.5" : undefined}
                  onClick={() => {
                    if (!selectedOutput?.remoteUrl || !capabilities?.supportsVideoReferences) return;
                    persistParams({ ...params, mode: "reference" });
                    setReferenceVideoId(selectedOutput.id);
                    insertToken("<Video 1>");
                  }}
                  className="rounded-xl"
                >
                  用于新视频参考
                </Button>
                <a href={videoSource} download className="grid size-10 place-items-center rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100" title="下载视频">
                  <Download className="size-4" />
                </a>
              </div>
            )}
          </div>

          <ParameterBlock label="模型">
            <ModelSelector
              models={models}
              value={params.model}
              onModelChange={selectModel}
              disabled={busy}
              disabledModelIds={params.mode === "reference" && referenceVideoId ? models.filter((model) => !model.videoCapabilities?.supportsVideoReferences).map((model) => model.id) : []}
              disabledReason="当前已选择参考视频，请先移除视频后再切换到 Flash"
              className="w-full max-w-none justify-between rounded-xl"
            />
            {selectedModel?.id.endsWith("-flash") ? (
              <p className="mt-2 text-xs leading-5 text-zinc-400">Flash 固定 720P，不支持参考视频。</p>
            ) : (
              <p className="mt-2 text-xs leading-5 text-amber-600">标准 2.5 可能产生费用，请以 AGNES 平台规则为准。</p>
            )}
          </ParameterBlock>

          <ParameterBlock label="画面比例">
            <div className="grid grid-cols-3 gap-2">
              {capabilities?.aspectRatios.map((ratio) => (
                <ChoiceButton key={ratio} selected={params.aspectRatio === ratio} disabled={busy} onClick={() => persistParams({ ...params, aspectRatio: ratio })}>
                  {ratio}
                </ChoiceButton>
              ))}
            </div>
          </ParameterBlock>

          <ParameterBlock label="分辨率">
            <div className="grid grid-cols-3 gap-2">
              {capabilities?.sizes.map((size) => (
                <ChoiceButton key={size} selected={params.size === size} disabled={busy} onClick={() => persistParams({ ...params, size })}>
                  {size}
                </ChoiceButton>
              ))}
            </div>
          </ParameterBlock>

          <ParameterBlock label="时长">
            <div className="grid grid-cols-3 gap-2">
              {videoConfig.seconds.map((seconds) => (
                <ChoiceButton key={seconds} selected={params.seconds === seconds} disabled={busy} onClick={() => persistParams({ ...params, seconds })}>
                  {seconds}s
                </ChoiceButton>
              ))}
            </div>
          </ParameterBlock>
        </aside>
      </div>

      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] p-0">
          <DialogTitle className="sr-only">选择 AGNES 素材</DialogTitle>
          <div className="border-b border-zinc-100 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">AGNES 素材库</h2>
                <p className="mt-1 text-xs text-zinc-400">复用已经生成并保留远程地址的素材</p>
              </div>
              <div className="flex rounded-xl bg-zinc-100 p-1">
                <button type="button" onClick={() => setLibraryMedia("image")} className={cn("rounded-lg px-4 py-2 text-sm", libraryMedia === "image" && "bg-white shadow-sm")}>
                  图片
                </button>
                <button type="button" onClick={() => setLibraryMedia("video")} className={cn("rounded-lg px-4 py-2 text-sm", libraryMedia === "video" && "bg-white shadow-sm")}>
                  视频
                </button>
              </div>
            </div>
          </div>
          <div className="grid max-h-[560px] grid-cols-3 gap-3 overflow-y-auto p-5 max-sm:grid-cols-2">
            {libraryLoading && <div className="col-span-full py-20 text-center text-sm text-zinc-400">正在读取素材……</div>}
            {!libraryLoading && libraryItems.map((asset) => {
              const disabled = libraryMedia === "video" && !capabilities?.supportsVideoReferences;
              return (
                <button
                  key={asset.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => chooseLibraryAsset(asset)}
                  className="group overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 text-left transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45"
                  title={disabled ? "Flash 不支持参考视频，请先切换到 AGNES Video 2.5" : undefined}
                >
                  <div className="relative aspect-video bg-zinc-900">
                    {libraryMedia === "image" ? (
                      <Image src={asset.url} alt={asset.originalName || "AGNES 图片"} fill unoptimized className="object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-white/70"><Film className="size-8" /></div>
                    )}
                  </div>
                  <div className="truncate p-3 text-xs text-zinc-600">{asset.originalName || asset.model}</div>
                </button>
              );
            })}
            {!libraryLoading && libraryItems.length === 0 && <div className="col-span-full py-20 text-center text-sm text-zinc-400">还没有可复用的 AGNES {libraryMedia === "image" ? "图片" : "视频"}</div>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ParameterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-7 max-xl:mb-0">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      {children}
    </section>
  );
}

function ChoiceButton({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn("h-10 rounded-xl border text-xs font-medium transition", selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400", disabled && "opacity-60")}>
      {children}
    </button>
  );
}

function FrameSlot({ label, asset, onAdd, onRemove }: { label: string; asset?: AssetDto; onAdd: () => void; onRemove: () => void }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-dashed border-zinc-300 bg-zinc-50">
      {asset ? (
        <>
          <Image src={asset.url} alt={label} fill unoptimized className="object-cover" />
          <button type="button" onClick={onRemove} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/65 text-white"><X className="size-3.5" /></button>
          <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">{label}</span>
        </>
      ) : (
        <button type="button" onClick={onAdd} className="grid h-full w-full place-items-center text-xs text-zinc-400"><span className="flex flex-col items-center gap-2"><ImagePlus className="size-5" />{label}</span></button>
      )}
    </div>
  );
}

function ReferenceChip({ asset, label, video, onInsert, onRemove }: { asset?: AssetDto; label: string; video?: boolean; onInsert: () => void; onRemove: () => void }) {
  return (
    <div className="group relative h-16 w-20 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
      {asset && !video ? <Image src={asset.url} alt={label} fill unoptimized className="object-cover" /> : <div className="grid h-full place-items-center"><Film className="size-5 text-zinc-500" /></div>}
      <button type="button" onClick={onInsert} className="absolute inset-x-1 bottom-1 truncate rounded bg-black/65 px-1 py-0.5 text-[9px] text-white">{label}</button>
      <button type="button" onClick={onRemove} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/65 text-white opacity-0 transition group-hover:opacity-100"><X className="size-3" /></button>
    </div>
  );
}

function ProgressStage({ turn, timedOut }: { turn: VideoTurnDto; timedOut: boolean }) {
  return (
    <div className="relative z-10 w-full max-w-md px-8 text-center">
      <div className="relative mx-auto size-24">
        <div className="absolute inset-0 rounded-full border border-white/10" />
        <div className="absolute inset-2 animate-spin rounded-full border-2 border-transparent border-t-emerald-300" />
        <div className="absolute inset-0 grid place-items-center text-xl font-semibold">{turn.progress}%</div>
      </div>
      <h2 className="mt-6 text-lg font-medium">{timedOut ? "任务仍在 AGNES 侧生成" : turn.status === "PENDING" ? "镜头正在排队" : "正在合成画面与运动"}</h2>
      <p className="mt-2 text-sm text-white/45">{timedOut ? "稍后重新进入页面会继续查询，不会取消供应商任务。" : "可以离开此页面，重新进入后会继续查询进度。"}</p>
      <div className="mx-auto mt-6 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300 transition-all duration-500" style={{ width: `${turn.progress}%` }} /></div>
      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-white/35"><Clock3 className="size-3.5" /> AGNES asynchronous render</div>
    </div>
  );
}
