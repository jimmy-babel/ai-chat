export type ModelProvider = "openai" | "deepseek" | "agnes";

export type ModelModality = "chat" | "image" | "video";

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "max";

export type ImageModelControls = {
  quality: boolean;
  n: boolean;
  outputFormat: boolean;
  outputCompression: boolean;
  moderation: boolean;
};

export type VideoModelCapabilities = {
  modes: Array<"text" | "keyframe" | "reference">;
  sizes: Array<"720P" | "960P" | "2K">;
  aspectRatios: Array<"21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16">;
  seconds: number[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  supportsVideoReferences: boolean;
};

export type PublicModel = {
  id: string;
  displayName: string;
  provider: ModelProvider;
  providerLabel: string;
  modality: ModelModality;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  supportsChatImages: boolean;
  imageControls?: ImageModelControls;
  videoCapabilities?: VideoModelCapabilities;
};

export const providerOrder: readonly ModelProvider[] = ["openai", "deepseek", "agnes"];

export function findPublicModel(models: PublicModel[], id: string | undefined) {
  return models.find((model) => model.id === id);
}

export function defaultPublicModel(models: PublicModel[]) {
  return models[0];
}

export function validReasoningEffort(model: PublicModel, effort: string | undefined) {
  if (effort && model.reasoningEfforts.includes(effort as ReasoningEffort)) {
    return effort as ReasoningEffort;
  }
  return model.defaultReasoningEffort;
}
