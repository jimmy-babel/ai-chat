import { z } from "zod";
import { chatConfig, imageConfig, videoConfig } from "@/lib/config";

export const conversationTypeSchema = z.enum(["CHAT", "IMAGE", "VIDEO"]);

export const createConversationSchema = z.object({
  type: conversationTypeSchema,
  title: z.string().trim().min(1).max(32000).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(191),
});

export const assetKindSchema = z.enum([
  "CHAT_INPUT",
  "IMAGE_REFERENCE",
  "IMAGE_OUTPUT",
  "IMAGE_MASK",
  "VIDEO_REFERENCE",
  "VIDEO_OUTPUT",
]);

export const uploadAssetSchema = z.object({
  kind: assetKindSchema,
  conversationId: z.string().optional(),
});

export const chatMessageSchema = z.object({
  content: z.string().trim().max(32000).default(""),
  assetIds: z.array(z.string()).max(chatConfig.maxImageInputs).default([]),
  model: z.string().trim().min(1),
  reasoningEffort: z.enum(chatConfig.reasoningEfforts).default("high"),
});

export const imageParamsSchema = z.object({
  aspectRatio: z.string().default(imageConfig.defaults.aspectRatio),
  model: z.string().default(imageConfig.defaults.model),
  quality: z.enum(["low", "medium", "high", "auto"]).default("high"),
  n: z.coerce.number().int().min(1).max(10).default(1),
  outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
  outputCompression: z.coerce.number().int().min(0).max(100).default(100),
  moderation: z.enum(["auto", "low"]).default("auto"),
  size: z.string().default("auto"),
  background: z.enum(["transparent", "opaque", "auto"]).default("auto"),
  stream: z.boolean().default(false),
  partialImages: z.coerce.number().int().min(0).max(3).default(0),
});

export const imageTurnSchema = z.object({
  prompt: z.string().trim().min(1).max(32000),
  params: imageParamsSchema.default(imageConfig.defaults),
  referenceAssetIds: z.array(z.string()).max(16).default([]),
  baseAssetId: z.string().optional(),
  activeAssetId: z.string().optional(),
  maskAssetId: z.string().optional(),
});

export const videoParamsSchema = z.object({
  model: z.string().trim().min(1),
  mode: z.enum(videoConfig.modes),
  aspectRatio: z.enum(videoConfig.aspectRatios),
  size: z.enum(videoConfig.sizes),
  seconds: z.coerce.number().int().min(4).max(12),
});

export const videoTurnSchema = z
  .object({
    clientRequestId: z.uuid(),
    prompt: z.string().trim().min(1).max(32000),
    params: videoParamsSchema,
    referenceImageAssetIds: z.array(z.string()).max(videoConfig.maxReferenceImages).default([]),
    firstFrameAssetId: z.string().optional(),
    lastFrameAssetId: z.string().optional(),
    referenceVideoAssetId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const hasKeyframe = Boolean(value.firstFrameAssetId || value.lastFrameAssetId);
    const hasReference = value.referenceImageAssetIds.length > 0 || Boolean(value.referenceVideoAssetId);
    if (value.params.mode === "text" && (hasKeyframe || hasReference)) {
      ctx.addIssue({ code: "custom", message: "文生视频模式不能携带参考素材" });
    }
    if (value.params.mode === "keyframe" && !hasKeyframe) {
      ctx.addIssue({ code: "custom", message: "首尾帧模式至少需要一张图片" });
    }
    if (value.params.mode === "keyframe" && hasReference) {
      ctx.addIssue({ code: "custom", message: "首尾帧模式不能携带参考素材" });
    }
    if (value.params.mode === "reference" && !hasReference) {
      ctx.addIssue({ code: "custom", message: "参考素材模式至少需要一项素材" });
    }
    if (value.params.mode === "reference" && hasKeyframe) {
      ctx.addIssue({ code: "custom", message: "参考素材模式不能携带首尾帧" });
    }
  });
