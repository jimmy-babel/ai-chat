export const chatConfig = {
  model: "gpt-5.5",
  allowImageInput: true,
  maxImageInputs: 10,
  maxUploadBytes: 12 * 1024 * 1024,
  allowedImageTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  reasoningEfforts: ["auto", "low", "medium", "high", "max"] as const,
  defaultReasoningEffort: "high",
};

export type ImageParams = {
  aspectRatio: string;
  model: string;
  quality: "low" | "medium" | "high" | "auto";
  n: number;
  outputFormat: "png" | "jpeg" | "webp";
  outputCompression: number;
  moderation: "auto" | "low";
  size: string;
  background: "transparent" | "opaque" | "auto";
  stream: boolean;
  partialImages: number;
};

export const imageConfig = {
  model: "gpt-image-2",
  maxReferenceImages: 4,
  maxUploadBytes: 20 * 1024 * 1024,
  allowedImageTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  maskEnabled: false,
  visibleParams: {
    aspectRatio: true,
    model: true,
    quality: true,
    n: true,
    outputFormat: true,
    outputCompression: true,
    moderation: true,
    size: true,
    background: false,
    stream: false,
    partialImages: false,
    mask: false,
  },
  defaults: {
    aspectRatio: "auto",
    model: "gpt-image-2",
    quality: "high",
    n: 1,
    outputFormat: "png",
    outputCompression: 100,
    moderation: "auto",
    size: "auto",
    background: "auto",
    stream: false,
    partialImages: 0,
  } satisfies ImageParams,
  aspectSizes: {
    auto: "auto",
    "1:1": "1024x1024",
    "4:3": "1536x1152",
    "3:4": "1152x1536",
    "16:9": "1536x864",
    "9:16": "864x1536",
  } as Record<string, string>,
  aspectRatioOptions: ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"],
  qualityOptions: ["low", "medium", "high", "auto"],
  outputFormatOptions: ["png", "jpeg", "webp"],
  moderationOptions: ["auto", "low"],
};

export type VideoMode = "text" | "keyframe" | "reference";

export type VideoParams = {
  model: string;
  mode: VideoMode;
  aspectRatio: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  size: "720P" | "960P" | "2K";
  seconds: number;
};

export const videoConfig = {
  model: "agnes-video-2.5-flash",
  referenceModel: "agnes-video-2.5",
  maxReferenceImages: 5,
  maxReferenceVideos: 1,
  maxUploadBytes: 20 * 1024 * 1024,
  maxCompressedBytes: 2 * 1024 * 1024,
  maxDownloadBytes: 250 * 1024 * 1024,
  allowedImageTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  modes: ["text", "keyframe", "reference"] as const,
  aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const,
  sizes: ["720P", "960P", "2K"] as const,
  seconds: [4, 5, 6, 7, 8, 9, 10, 11, 12] as const,
  defaults: {
    model: "agnes-video-2.5-flash",
    mode: "text",
    aspectRatio: "16:9",
    size: "720P",
    seconds: 5,
  } satisfies VideoParams,
};
