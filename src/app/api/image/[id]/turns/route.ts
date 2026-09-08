import { ApiKind, RecordStatus } from "@/generated/prisma/enums";
import { imageTurnSchema } from "@/lib/schemas";
import { compactTitle } from "@/lib/utils";
import { getErrorMessage, jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import {
  extractImageResults,
  imageEditsEndpoint,
  imageGenerationsEndpoint,
  isModelConfigured,
  normalizeImageParams,
  postImageEdit,
  postImageGeneration,
} from "@/server/ai-providers";
import { resolveServerModel } from "@/server/model-catalog";
import {
  assetToDto,
  attachAssetsToConversation,
  saveOutputAsset,
  saveRemoteOutputAsset,
  svgPlaceholderBase64,
} from "@/server/storage";

export const runtime = "nodejs";

function mimeFromFormat(format: string) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function uniqueIds(ids: Array<string | undefined>) {
  return Array.from(new Set(ids.filter(Boolean) as string[]));
}

function outputTextSnippet(json: unknown) {
  if (!json || typeof json !== "object") return "";

  const responses = (json as { responses?: unknown }).responses;
  const payloads = Array.isArray(responses) ? responses : [json];
  const texts: string[] = [];

  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) continue;

    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string" && text.trim()) texts.push(text.trim());
      }
    }
  }

  return texts.join("\n").slice(0, 240);
}

async function nextSequence(conversationId: string) {
  const aggregate = await prisma.imageTurn.aggregate({
    where: { conversationId },
    _max: { sequence: true },
  });

  return (aggregate._max.sequence ?? 0) + 1;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = imageTurnSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError("图片生成参数不正确", 422, parsed.error.flatten());

  const model = resolveServerModel("image", parsed.data.params.model);
  if (!model) return jsonError("不支持的图片模型", 422);
  const params = normalizeImageParams(model, parsed.data.params);

  const user = await getDefaultUser();
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id, deletedAt: null, type: "IMAGE" },
  });

  if (!conversation) return jsonError("图片会话不存在", 404);

  const referenceAssetIds = uniqueIds(parsed.data.referenceAssetIds);
  const editAssetIds = uniqueIds([
    parsed.data.baseAssetId,
    parsed.data.activeAssetId,
    ...referenceAssetIds,
  ]);

  await attachAssetsToConversation([...referenceAssetIds, ...editAssetIds], id);

  const sequence = await nextSequence(id);
  const turn = await prisma.imageTurn.create({
    data: {
      conversationId: id,
      sequence,
      prompt: parsed.data.prompt,
      status: RecordStatus.PENDING,
      params,
      referenceAssetIds,
      baseAssetId: parsed.data.baseAssetId,
      activeAssetId: parsed.data.activeAssetId,
      maskAssetId: parsed.data.maskAssetId,
    },
  });

  await prisma.conversation.update({
    where: { id },
    data: {
      title:
        conversation.title === "新的图片创作"
          ? compactTitle(parsed.data.prompt, "新的图片创作")
          : conversation.title,
      lastMessageAt: new Date(),
    },
  });

  const startedAt = Date.now();
  const isEdit = editAssetIds.length > 0;
  let statusCode: number | undefined;
  let requestId: string | undefined;
  let providerResponse: unknown = null;
  let providerEndpoint = isEdit ? imageEditsEndpoint(model) : imageGenerationsEndpoint(model);

  try {
    await prisma.imageTurn.update({
      where: { id: turn.id },
      data: { status: RecordStatus.STREAMING },
    });

    const results: Array<{
      base64?: string;
      remoteUrl?: string;
      revisedPrompt?: string;
      mimeType: string;
    }> = [];

    if (!isModelConfigured(model)) {
      const count = Math.min(params.n || 1, 4);
      for (let index = 0; index < count; index += 1) {
        results.push({
          base64: svgPlaceholderBase64(`${parsed.data.prompt}${count > 1 ? ` #${index + 1}` : ""}`),
          revisedPrompt: parsed.data.prompt,
          mimeType: "image/svg+xml",
        });
      }
    } else if (isEdit) {
      const result = await postImageEdit({
        model,
        prompt: parsed.data.prompt,
        params,
        imageAssetIds: editAssetIds,
        maskAssetId: parsed.data.maskAssetId,
      });
      statusCode = result.statusCode;
      requestId = result.requestId;
      providerEndpoint = result.endpoint;
      providerResponse = result.json;
      results.push(
        ...extractImageResults(result.json).map((item) => ({
          ...item,
          mimeType: mimeFromFormat(params.outputFormat),
        })),
      );
    } else {
      const result = await postImageGeneration({
        model,
        prompt: parsed.data.prompt,
        params,
      });
      statusCode = result.statusCode;
      requestId = result.requestId;
      providerEndpoint = result.endpoint;
      providerResponse = result.json;
      results.push(
        ...extractImageResults(result.json).map((item) => ({
          ...item,
          mimeType: mimeFromFormat(params.outputFormat),
        })),
      );
    }

    if (!results.length) {
      const snippet = outputTextSnippet(providerResponse);
      throw new Error(
        snippet
          ? `图片接口返回了文本而不是图片数据：${snippet}`
          : "图片接口没有返回图片数据",
      );
    }

    const assets = [];
    for (const result of results) {
      const originalName = `${compactTitle(parsed.data.prompt, "image")}.${result.mimeType.split("/").at(-1)}`;
      const asset = result.remoteUrl
        ? await saveRemoteOutputAsset({
            conversationId: id,
            remoteUrl: result.remoteUrl,
            kind: "IMAGE_OUTPUT",
            provider: model.provider,
            model: model.id,
            originalName,
            fallbackMimeType: result.mimeType,
            maxBytes: 50 * 1024 * 1024,
          })
        : result.base64
          ? await saveOutputAsset({
              conversationId: id,
              base64: result.base64,
              mimeType: result.mimeType,
              originalName,
              provider: model.provider,
              model: model.id,
            })
          : null;
      if (!asset) throw new Error("图片接口没有返回可保存的图片数据");
      assets.push(asset);
    }

    const activeAsset = assets[0];

    const completedTurn = await prisma.imageTurn.update({
      where: { id: turn.id },
      data: {
        status: RecordStatus.COMPLETED,
        outputAssetIds: assets.map((asset) => asset.id),
        activeAssetId: activeAsset?.id,
        providerRequest: {
          endpoint: providerEndpoint,
          prompt: parsed.data.prompt,
          params,
          referenceAssetIds,
          editAssetIds,
        },
        providerResponse: providerResponse === null ? undefined : providerResponse,
      },
    });

    await prisma.conversation.update({
      where: { id },
      data: {
        activeAssetId: activeAsset?.id,
        lastMessageAt: new Date(),
      },
    });

    await prisma.apiUsageLog.create({
      data: {
        conversationId: id,
        imageTurnId: turn.id,
        kind: isEdit ? ApiKind.IMAGE_EDIT : ApiKind.IMAGE_GENERATION,
        model: model.id,
        endpoint: providerEndpoint,
        statusCode,
        requestId,
        durationMs: Date.now() - startedAt,
      },
    });

    return jsonOk({
      item: {
        id: completedTurn.id,
        sequence: completedTurn.sequence,
        prompt: completedTurn.prompt,
        status: completedTurn.status,
        params: completedTurn.params,
        referenceAssetIds: completedTurn.referenceAssetIds,
        outputAssetIds: completedTurn.outputAssetIds,
        activeAssetId: completedTurn.activeAssetId,
        createdAt: completedTurn.createdAt.toISOString(),
      },
      assets: assets.map(assetToDto),
    });
  } catch (error) {
    const message = getErrorMessage(error);

    await prisma.imageTurn.update({
      where: { id: turn.id },
      data: {
        status: RecordStatus.FAILED,
        errorMessage: message,
        providerRequest: {
          endpoint: providerEndpoint,
          prompt: parsed.data.prompt,
          params,
          referenceAssetIds,
          editAssetIds,
        },
        providerResponse: providerResponse === null ? undefined : providerResponse,
      },
    });

    await prisma.apiUsageLog.create({
      data: {
        conversationId: id,
        imageTurnId: turn.id,
        kind: isEdit ? ApiKind.IMAGE_EDIT : ApiKind.IMAGE_GENERATION,
        model: model.id,
        endpoint: providerEndpoint,
        statusCode,
        requestId,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      },
    });

    return jsonError(message, 502);
  }
}
