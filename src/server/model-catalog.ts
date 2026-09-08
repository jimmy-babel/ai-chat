import type {
  ModelModality,
  ModelProvider,
  PublicModel,
  ReasoningEffort,
} from "@/lib/models";

type ProviderRuntime = {
  baseUrl: string;
  apiKey: string;
};

export type ServerModel = PublicModel & {
  runtime: ProviderRuntime;
  supportsPreviousResponseId: boolean;
};

const providerLabels: Record<ModelProvider, string> = {
  openai: "GPT",
  deepseek: "DeepSeek",
  agnes: "AGNES",
};

function trimBaseUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function modelId(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function displayName(id: string) {
  if (id === "gpt-5.5") return "GPT-5.5";
  if (id === "gpt-image-2") return "GPT-Image-2";
  if (id === "deepseek-v4-flash") return "DeepSeek-V4-Flash";
  if (id === "agnes-2.5-flash") return "AGNES-2.5-Flash";
  if (id === "agnes-image-2.1-flash") return "AGNES-Image-2.1-Flash";
  if (id === "agnes-video-2.5-flash") return "AGNES-Video-2.5-Flash";
  if (id === "agnes-video-2.5") return "AGNES-Video-2.5";
  return id;
}

function runtime(provider: ModelProvider): ProviderRuntime {
  if (provider === "deepseek") {
    return {
      baseUrl: trimBaseUrl(process.env.DEEPSEEK_BASE_URL, "https://api.deepseek.com"),
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",
    };
  }

  if (provider === "agnes") {
    return {
      baseUrl: trimBaseUrl(process.env.AGNES_BASE_URL, "https://apihub.agnes-ai.com/v1"),
      apiKey: process.env.AGNES_API_KEY?.trim() || "",
    };
  }

  return {
    baseUrl: trimBaseUrl(process.env.OPENAI_BASE_URL, "https://api.openai.com/v1"),
    apiKey: process.env.OPENAI_API_KEY?.trim() || "",
  };
}

function entry(input: {
  id: string;
  provider: ModelProvider;
  modality: ModelModality;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  supportsChatImages?: boolean;
  imageControls?: PublicModel["imageControls"];
  videoCapabilities?: PublicModel["videoCapabilities"];
  supportsPreviousResponseId?: boolean;
}): ServerModel {
  return {
    id: input.id,
    displayName: displayName(input.id),
    provider: input.provider,
    providerLabel: providerLabels[input.provider],
    modality: input.modality,
    reasoningEfforts: input.reasoningEfforts ?? [],
    defaultReasoningEffort: input.defaultReasoningEffort ?? "high",
    supportsChatImages: input.supportsChatImages ?? false,
    imageControls: input.imageControls,
    videoCapabilities: input.videoCapabilities,
    runtime: runtime(input.provider),
    supportsPreviousResponseId: input.supportsPreviousResponseId ?? false,
  };
}

function buildCatalog(): ServerModel[] {
  return [
    entry({
      id: modelId(process.env.OPENAI_CHAT_MODEL, "gpt-5.5"),
      provider: "openai",
      modality: "chat",
      reasoningEfforts: ["auto", "low", "medium", "high"],
      defaultReasoningEffort: "high",
      supportsChatImages: true,
      supportsPreviousResponseId: true,
    }),
    entry({
      id: modelId(process.env.DEEPSEEK_CHAT_MODEL, "deepseek-v4-flash"),
      provider: "deepseek",
      modality: "chat",
      reasoningEfforts: ["low", "high", "max"],
      defaultReasoningEffort: "high",
    }),
    entry({
      id: modelId(process.env.AGNES_CHAT_MODEL, "agnes-2.5-flash"),
      provider: "agnes",
      modality: "chat",
      reasoningEfforts: ["high"],
      defaultReasoningEffort: "high",
    }),
    entry({
      id: modelId(process.env.OPENAI_IMAGE_MODEL, "gpt-image-2"),
      provider: "openai",
      modality: "image",
      imageControls: {
        quality: true,
        n: true,
        outputFormat: true,
        outputCompression: true,
        moderation: true,
      },
    }),
    entry({
      id: modelId(process.env.AGNES_IMAGE_MODEL, "agnes-image-2.1-flash"),
      provider: "agnes",
      modality: "image",
      imageControls: {
        quality: false,
        n: false,
        outputFormat: false,
        outputCompression: false,
        moderation: false,
      },
    }),
    entry({
      id: modelId(process.env.AGNES_VIDEO_MODEL, "agnes-video-2.5-flash"),
      provider: "agnes",
      modality: "video",
      videoCapabilities: {
        modes: ["text", "keyframe", "reference"],
        sizes: ["720P"],
        aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        seconds: [4, 5, 6, 7, 8, 9, 10, 11, 12],
        maxReferenceImages: 5,
        maxReferenceVideos: 0,
        supportsVideoReferences: false,
      },
    }),
    entry({
      id: modelId(process.env.AGNES_VIDEO_REFERENCE_MODEL, "agnes-video-2.5"),
      provider: "agnes",
      modality: "video",
      videoCapabilities: {
        modes: ["text", "keyframe", "reference"],
        sizes: ["720P", "960P", "2K"],
        aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        seconds: [4, 5, 6, 7, 8, 9, 10, 11, 12],
        maxReferenceImages: 5,
        maxReferenceVideos: 1,
        supportsVideoReferences: true,
      },
    }),
  ];
}

export function getServerModels(modality?: ModelModality) {
  const catalog = buildCatalog();
  return modality ? catalog.filter((model) => model.modality === modality) : catalog;
}

export function getPublicModels(modality: ModelModality): PublicModel[] {
  return getServerModels(modality).map((model) => ({
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    providerLabel: model.providerLabel,
    modality: model.modality,
    reasoningEfforts: model.reasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportsChatImages: model.supportsChatImages,
    imageControls: model.imageControls,
    videoCapabilities: model.videoCapabilities,
  }));
}

export function resolveServerModel(modality: ModelModality, id: string) {
  return getServerModels(modality).find((model) => model.id === id);
}

export function defaultServerModel(modality: ModelModality) {
  const model = getServerModels(modality)[0];
  if (!model) throw new Error(`没有配置 ${modality} 模型`);
  return model;
}

export function modelEndpoint(model: ServerModel, path: string) {
  return `${model.runtime.baseUrl}/${path.replace(/^\/+/, "")}`;
}

export function isModelConfigured(model: ServerModel) {
  return Boolean(model.runtime.apiKey);
}

export function modelAuthHeaders(model: ServerModel, contentType?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${model.runtime.apiKey}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}
