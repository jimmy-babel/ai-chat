import type { VideoParams } from "@/lib/config";
import { getRequestId } from "@/server/api";
import {
  modelAuthHeaders,
  modelEndpoint,
  type ServerModel,
} from "@/server/model-catalog";

export type AgnesVideoStatus = "queued" | "in_progress" | "completed" | "failed";

export type ParsedVideoTask = {
  taskId?: string;
  videoId?: string;
  status: AgnesVideoStatus;
  progress: number;
  remoteUrl?: string;
  errorMessage?: string;
  raw: unknown;
};

export type ProviderVideoResponse = {
  task: ParsedVideoTask;
  endpoint: string;
  statusCode: number;
  requestId?: string;
};

export function videoCreateEndpoint(model: ServerModel) {
  return modelEndpoint(model, "videos");
}

export function videoStatusEndpoint(model: ServerModel, videoId: string) {
  const configured = process.env.AGNES_VIDEO_STATUS_URL?.trim();
  const endpoint = configured
    ? new URL(configured)
    : new URL("/agnesapi", new URL(model.runtime.baseUrl).origin);
  endpoint.searchParams.set("video_id", videoId);
  endpoint.searchParams.set("model_name", model.id);
  return endpoint.toString();
}

export function normalizeVideoParams(model: ServerModel, params: VideoParams): VideoParams {
  const capabilities = model.videoCapabilities;
  if (!capabilities) throw new Error("该模型未配置视频能力");
  if (!capabilities.modes.includes(params.mode)) throw new Error("该模型不支持所选生成模式");
  if (!capabilities.aspectRatios.includes(params.aspectRatio)) {
    throw new Error("该模型不支持所选画面比例");
  }
  if (!capabilities.seconds.includes(params.seconds)) throw new Error("视频时长必须为 4–12 秒");
  if (!capabilities.sizes.includes(params.size)) {
    if (model.id.endsWith("-flash")) return { ...params, model: model.id, size: "720P" };
    throw new Error("该模型不支持所选分辨率");
  }
  return { ...params, model: model.id };
}

export function videoCreationBody(input: {
  model: ServerModel;
  prompt: string;
  params: VideoParams;
  firstFrame?: string;
  lastFrame?: string;
  images?: string[];
  referenceVideoUrl?: string;
}) {
  const body: Record<string, unknown> = {
    model: input.model.id,
    prompt: input.prompt,
    mode: input.params.mode,
    seconds: String(input.params.seconds),
    size: input.params.size,
    aspect_ratio: input.params.aspectRatio,
    n: 1,
  };

  if (input.params.mode === "keyframe") {
    if (input.firstFrame) body.first_frame = input.firstFrame;
    if (input.lastFrame) body.last_frame = input.lastFrame;
  }
  if (input.params.mode === "reference") {
    if (input.images?.length) body.images = input.images;
    if (input.referenceVideoUrl) {
      body.videos = [{ url: input.referenceVideoUrl, start_seconds: 0, require_audio: false }];
    }
  }
  return body;
}

export function sanitizedVideoRequest(body: Record<string, unknown>) {
  return {
    ...body,
    first_frame: body.first_frame ? "[image]" : undefined,
    last_frame: body.last_frame ? "[image]" : undefined,
    images: Array.isArray(body.images) ? body.images.map(() => "[image]") : undefined,
  };
}

export async function postVideoTask(
  model: ServerModel,
  body: Record<string, unknown>,
): Promise<ProviderVideoResponse> {
  const endpoint = videoCreateEndpoint(model);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: modelAuthHeaders(model, "application/json"),
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(providerErrorMessage(json, `视频任务创建失败（${response.status}）`));
  return {
    task: parseVideoTask(json),
    endpoint,
    statusCode: response.status,
    requestId: getRequestId(response.headers),
  };
}

export async function pollVideoTask(
  model: ServerModel,
  videoId: string,
): Promise<ProviderVideoResponse> {
  const endpoint = videoStatusEndpoint(model, videoId);
  const response = await fetch(endpoint, {
    headers: modelAuthHeaders(model),
    cache: "no-store",
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(providerErrorMessage(json, `视频状态查询失败（${response.status}）`));
    Object.assign(error, { statusCode: response.status });
    throw error;
  }
  return {
    task: parseVideoTask(json),
    endpoint,
    statusCode: response.status,
    requestId: getRequestId(response.headers),
  };
}

export function parseVideoTask(json: unknown): ParsedVideoTask {
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const metadata =
    record.metadata && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : {};
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
  const rawStatus = typeof record.status === "string" ? record.status : "queued";
  const status: AgnesVideoStatus =
    rawStatus === "completed" || rawStatus === "failed" || rawStatus === "in_progress"
      ? rawStatus
      : "queued";
  const progress = Math.max(0, Math.min(100, Number(record.progress ?? (status === "completed" ? 100 : 0)) || 0));
  return {
    taskId:
      typeof record.task_id === "string"
        ? record.task_id
        : typeof record.id === "string"
          ? record.id
          : undefined,
    videoId: typeof record.video_id === "string" ? record.video_id : undefined,
    status,
    progress,
    remoteUrl:
      typeof metadata.url === "string"
        ? metadata.url
        : typeof record.url === "string"
          ? record.url
          : undefined,
    errorMessage: typeof error.message === "string" ? error.message : undefined,
    raw: json,
  };
}

function providerErrorMessage(json: unknown, fallback: string) {
  if (!json || typeof json !== "object") return fallback;
  const record = json as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}
