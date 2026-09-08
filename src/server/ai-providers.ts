import { imageConfig, type ImageParams } from "@/lib/config";
import type { ReasoningEffort } from "@/lib/models";
import { getRequestId } from "@/server/api";
import {
  isModelConfigured,
  modelAuthHeaders,
  modelEndpoint,
  type ServerModel,
} from "@/server/model-catalog";
import { assetAsDataUrl, readAssetFile } from "@/server/storage";

export type ImageProviderResult = {
  json: unknown;
  statusCode: number;
  requestId?: string;
  endpoint: string;
};

export function chatEndpoint(model: ServerModel) {
  return modelEndpoint(model, "responses");
}

export function imageGenerationsEndpoint(model: ServerModel) {
  return modelEndpoint(model, "images/generations");
}

export function imageEditsEndpoint(model: ServerModel) {
  return model.provider === "agnes"
    ? imageGenerationsEndpoint(model)
    : modelEndpoint(model, "images/edits");
}

export { isModelConfigured };

export function reasoningPayload(model: ServerModel, effort: ReasoningEffort) {
  if (model.provider === "agnes" || effort === "auto") return undefined;
  return { effort };
}

export function canReusePreviousResponse(input: {
  model: ServerModel;
  providerResponseId?: string | null;
  previousModel?: string | null;
  previousEndpoint?: string | null;
}) {
  return Boolean(
    input.model.supportsPreviousResponseId &&
      input.providerResponseId &&
      input.previousModel === input.model.id &&
      input.previousEndpoint === chatEndpoint(input.model),
  );
}

export async function postResponsesStream(
  model: ServerModel,
  payload: Record<string, unknown>,
) {
  return fetch(chatEndpoint(model), {
    method: "POST",
    headers: modelAuthHeaders(model, "application/json"),
    body: JSON.stringify(payload),
  });
}

export function visibleResponseDelta(event: unknown) {
  if (!event || typeof event !== "object") return "";
  const record = event as Record<string, unknown>;
  if (record.type === "response.output_text.delta" && typeof record.delta === "string") {
    return record.delta;
  }
  if (record.type === "response.output_text.delta" && typeof record.text === "string") {
    return record.text;
  }
  return "";
}

export function completedResponse(event: unknown) {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (record.type === "response.completed" && record.response) return record.response;
  if (typeof record.id === "string" && Array.isArray(record.output)) return record;
  return null;
}

export function responseTerminalError(event: unknown) {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (record.type !== "response.failed" && record.type !== "response.incomplete") return null;

  const response = record.response;
  if (response && typeof response === "object") {
    const responseRecord = response as Record<string, unknown>;
    const error = responseRecord.error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
    const details = responseRecord.incomplete_details;
    if (details && typeof details === "object") {
      const reason = (details as { reason?: unknown }).reason;
      if (typeof reason === "string" && reason) return `响应未完成：${reason}`;
    }
  }

  return record.type === "response.failed" ? "模型响应失败" : "模型响应未完成";
}

export function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const output = record.output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") {
        return [];
      }
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        const partRecord = part as { type?: unknown; text?: unknown };
        return partRecord.type === "output_text" && typeof partRecord.text === "string"
          ? partRecord.text
          : "";
      });
    })
    .join("");
}

function openAiImagePayload(params: ImageParams) {
  const size =
    params.size && params.size !== "auto"
      ? params.size
      : imageConfig.aspectSizes[params.aspectRatio] || "auto";
  const payload: Record<string, string | number | boolean> = {
    model: params.model,
    quality: params.quality,
    n: params.n,
    size,
  };
  if (imageConfig.visibleParams.outputFormat) payload.output_format = params.outputFormat;
  if (imageConfig.visibleParams.outputCompression) {
    payload.output_compression = params.outputCompression;
  }
  if (imageConfig.visibleParams.moderation) payload.moderation = params.moderation;
  if (imageConfig.visibleParams.background && params.background !== "auto") {
    payload.background = params.background;
  }
  if (imageConfig.visibleParams.stream) payload.stream = params.stream;
  if (imageConfig.visibleParams.partialImages && params.partialImages > 0) {
    payload.partial_images = params.partialImages;
  }
  return payload;
}

function agnesRatio(aspectRatio: string) {
  return aspectRatio === "auto" ? "1:1" : aspectRatio;
}

export function imageGenerationBody(input: {
  model: ServerModel;
  prompt: string;
  params: ImageParams;
}) {
  return input.model.provider === "agnes"
    ? {
        model: input.model.id,
        prompt: input.prompt,
        size: "1K",
        ratio: agnesRatio(input.params.aspectRatio),
        return_base64: false,
        extra_body: { response_format: "url" },
      }
    : { prompt: input.prompt, ...openAiImagePayload(input.params) };
}

export function agnesImageEditBody(input: {
  model: ServerModel;
  prompt: string;
  params: ImageParams;
  images: string[];
}) {
  return {
    model: input.model.id,
    prompt: input.prompt,
    size: "1K",
    ratio: agnesRatio(input.params.aspectRatio),
    extra_body: { image: input.images, response_format: "url" },
  };
}

export function normalizeImageParams(model: ServerModel, params: ImageParams): ImageParams {
  if (model.provider !== "agnes") return { ...params, model: model.id };
  return {
    ...params,
    model: model.id,
    size: "1K",
    n: 1,
    outputFormat: "png",
    outputCompression: 100,
    moderation: "auto",
    quality: "high",
  };
}

export async function postImageGeneration(input: {
  model: ServerModel;
  prompt: string;
  params: ImageParams;
}): Promise<ImageProviderResult> {
  const endpoint = imageGenerationsEndpoint(input.model);
  const body = imageGenerationBody(input);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: modelAuthHeaders(input.model, "application/json"),
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerErrorMessage(json, `Image generation failed with ${response.status}`));
  }
  return { json, statusCode: response.status, requestId: getRequestId(response.headers), endpoint };
}

export async function postImageEdit(input: {
  model: ServerModel;
  prompt: string;
  params: ImageParams;
  imageAssetIds: string[];
  maskAssetId?: string;
}): Promise<ImageProviderResult> {
  if (input.model.provider === "agnes") {
    const images = (
      await Promise.all(input.imageAssetIds.map((assetId) => assetAsDataUrl(assetId)))
    ).filter((value): value is string => Boolean(value));
    const endpoint = imageGenerationsEndpoint(input.model);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: modelAuthHeaders(input.model, "application/json"),
      body: JSON.stringify(
        agnesImageEditBody({
          model: input.model,
          prompt: input.prompt,
          params: input.params,
          images,
        }),
      ),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(providerErrorMessage(json, `Image edit failed with ${response.status}`));
    }
    return { json, statusCode: response.status, requestId: getRequestId(response.headers), endpoint };
  }

  const formData = new FormData();
  formData.set("prompt", input.prompt);
  for (const [key, value] of Object.entries(openAiImagePayload(input.params))) {
    formData.set(key, String(value));
  }
  for (const assetId of input.imageAssetIds) {
    const file = await readAssetFile(assetId);
    if (!file) continue;
    formData.append(
      "image[]",
      new Blob([file.buffer], { type: file.asset.mimeType }),
      file.asset.originalName || file.asset.filename,
    );
  }
  if (input.maskAssetId && imageConfig.maskEnabled) {
    const maskFile = await readAssetFile(input.maskAssetId);
    if (maskFile) {
      formData.set(
        "mask",
        new Blob([maskFile.buffer], { type: maskFile.asset.mimeType }),
        maskFile.asset.originalName || maskFile.asset.filename,
      );
    }
  }
  const endpoint = imageEditsEndpoint(input.model);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: modelAuthHeaders(input.model),
    body: formData,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(providerErrorMessage(json, `Image edit failed with ${response.status}`));
  }
  return { json, statusCode: response.status, requestId: getRequestId(response.headers), endpoint };
}

export function extractImageResults(json: unknown) {
  if (!json || typeof json !== "object") return [];
  const results: Array<{ base64?: string; remoteUrl?: string; revisedPrompt?: string }> = [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return results;
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const record = item as { b64_json?: unknown; url?: unknown; revised_prompt?: unknown };
    if (typeof record.b64_json !== "string" && typeof record.url !== "string") continue;
    results.push({
      base64: typeof record.b64_json === "string" ? record.b64_json : undefined,
      remoteUrl: typeof record.url === "string" ? record.url : undefined,
      revisedPrompt:
        typeof record.revised_prompt === "string" ? record.revised_prompt : undefined,
    });
  }
  return results;
}

function providerErrorMessage(json: unknown, fallback: string) {
  if (!json || typeof json !== "object") return fallback;
  const error = (json as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}
