import { ApiKind, AssetKind, RecordStatus } from "@/generated/prisma/enums";
import type { VideoParams } from "@/lib/config";
import { videoConfig } from "@/lib/config";
import { videoTurnSchema } from "@/lib/schemas";
import { compactTitle } from "@/lib/utils";
import { getErrorMessage, jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { isModelConfigured } from "@/server/ai-providers";
import { resolveServerModel } from "@/server/model-catalog";
import { videoTurnToDto } from "@/server/serializers";
import { assetAsCompressedDataUrl } from "@/server/storage";
import {
  normalizeVideoParams,
  postVideoTask,
  sanitizedVideoRequest,
  videoCreateEndpoint,
  videoCreationBody,
} from "@/server/video-provider";

export const runtime = "nodejs";

function recordStatus(status: string) {
  if (status === "completed") return RecordStatus.COMPLETED;
  if (status === "failed") return RecordStatus.FAILED;
  if (status === "in_progress") return RecordStatus.STREAMING;
  return RecordStatus.PENDING;
}

async function nextSequence(conversationId: string) {
  const aggregate = await prisma.videoTurn.aggregate({
    where: { conversationId },
    _max: { sequence: true },
  });
  return (aggregate._max.sequence ?? 0) + 1;
}

function secureRemoteImageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("参考图片的远程地址不安全");
  }
  return url.toString();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = videoTurnSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError("视频生成参数不正确", 422, parsed.error.flatten());

  const model = resolveServerModel("video", parsed.data.params.model);
  if (!model) return jsonError("不支持的视频模型", 422);
  const capabilities = model.videoCapabilities;
  if (!capabilities) return jsonError("该模型未配置视频能力", 422);
  if (parsed.data.referenceImageAssetIds.length > capabilities.maxReferenceImages) {
    return jsonError(`该模型最多支持 ${capabilities.maxReferenceImages} 张参考图`, 422);
  }
  if (parsed.data.referenceVideoAssetId && !capabilities.supportsVideoReferences) {
    return jsonError("Flash 模型不支持参考视频，请手动切换到 AGNES Video 2.5", 422);
  }

  let params: VideoParams;
  try {
    params = normalizeVideoParams(model, parsed.data.params);
  } catch (error) {
    return jsonError(getErrorMessage(error), 422);
  }

  const user = await getDefaultUser();
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id, deletedAt: null, type: "VIDEO" },
  });
  if (!conversation) return jsonError("视频会话不存在", 404);

  const existing = await prisma.videoTurn.findUnique({
    where: { conversationId_clientRequestId: { conversationId: id, clientRequestId: parsed.data.clientRequestId } },
  });
  if (existing) return jsonOk({ item: videoTurnToDto(existing) });

  const active = await prisma.videoTurn.findFirst({
    where: {
      conversationId: id,
      status: { in: [RecordStatus.PENDING, RecordStatus.STREAMING] },
    },
  });
  if (active) return jsonError("当前会话已有视频正在生成，请等待完成", 409);

  const referenceAssetIds = Array.from(
    new Set(
      [
        ...parsed.data.referenceImageAssetIds,
        parsed.data.firstFrameAssetId,
        parsed.data.lastFrameAssetId,
        parsed.data.referenceVideoAssetId,
      ].filter(Boolean) as string[],
    ),
  );
  const assets = referenceAssetIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: referenceAssetIds } },
        include: { conversation: { select: { userId: true } } },
      })
    : [];
  if (assets.length !== referenceAssetIds.length) return jsonError("部分参考素材不存在", 404);
  if (
    assets.some(
      (asset) =>
        !(
          (asset.kind === AssetKind.VIDEO_REFERENCE && asset.conversationId === null) ||
          asset.conversation?.userId === user.id
        ),
    )
  ) {
    return jsonError("无权使用部分参考素材", 403);
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const imageValue = async (assetId: string | undefined) => {
    if (!assetId) return undefined;
    const asset = byId.get(assetId);
    if (!asset?.mimeType.startsWith("image/")) throw new Error("参考图片格式不正确");
    if (asset.remoteUrl && asset.provider === "agnes") return secureRemoteImageUrl(asset.remoteUrl);
    return (
      (await assetAsCompressedDataUrl(asset.id, {
        maxDimension: 1920,
        maxBytes: videoConfig.maxCompressedBytes,
      })) ?? undefined
    );
  };

  let firstFrame: string | undefined;
  let lastFrame: string | undefined;
  let images: string[] = [];
  let referenceVideoUrl: string | undefined;
  try {
    firstFrame = await imageValue(parsed.data.firstFrameAssetId);
    lastFrame = await imageValue(parsed.data.lastFrameAssetId);
    images = (
      await Promise.all(parsed.data.referenceImageAssetIds.map((assetId) => imageValue(assetId)))
    ).filter((value): value is string => Boolean(value));
    if (parsed.data.referenceVideoAssetId) {
      const asset = byId.get(parsed.data.referenceVideoAssetId);
      if (
        !asset ||
        asset.kind !== AssetKind.VIDEO_OUTPUT ||
        asset.provider !== "agnes" ||
        !asset.remoteUrl
      ) {
        return jsonError("参考视频必须是带远程地址的 AGNES 生成视频", 422);
      }
      const url = new URL(asset.remoteUrl);
      if (url.protocol !== "https:" || url.username || url.password) {
        return jsonError("参考视频的远程地址不安全", 422);
      }
      referenceVideoUrl = url.toString();
    }
  } catch (error) {
    return jsonError(getErrorMessage(error), 422);
  }

  const body = videoCreationBody({
    model,
    prompt: parsed.data.prompt,
    params,
    firstFrame,
    lastFrame,
    images,
    referenceVideoUrl,
  });
  const sequence = await nextSequence(id);
  const turn = await prisma.videoTurn.create({
    data: {
      conversationId: id,
      clientRequestId: parsed.data.clientRequestId,
      sequence,
      model: model.id,
      mode: params.mode,
      prompt: parsed.data.prompt,
      params,
      referenceAssetIds: {
        images: parsed.data.referenceImageAssetIds,
        firstFrameAssetId: parsed.data.firstFrameAssetId,
        lastFrameAssetId: parsed.data.lastFrameAssetId,
        referenceVideoAssetId: parsed.data.referenceVideoAssetId,
      },
      providerRequest: sanitizedVideoRequest(body),
    },
  });

  await prisma.asset.updateMany({
    where: {
      id: { in: referenceAssetIds },
      kind: AssetKind.VIDEO_REFERENCE,
      conversationId: null,
    },
    data: { conversationId: id },
  });
  await prisma.conversation.update({
    where: { id },
    data: {
      title:
        conversation.title === "新的视频创作"
          ? compactTitle(parsed.data.prompt, "新的视频创作")
          : conversation.title,
      lastMessageAt: new Date(),
    },
  });

  const startedAt = Date.now();
  const endpoint = videoCreateEndpoint(model);
  let statusCode: number | undefined;
  let requestId: string | undefined;
  try {
    if (!isModelConfigured(model)) {
      const mockTurn = await prisma.videoTurn.update({
        where: { id: turn.id },
        data: {
          taskId: `mock-task-${turn.id}`,
          videoId: `mock-video-${turn.id}`,
          providerResponse: { mock: true, status: "queued", progress: 0 },
        },
      });
      await prisma.apiUsageLog.create({
        data: {
          conversationId: id,
          videoTurnId: turn.id,
          kind: ApiKind.VIDEO_GENERATION,
          model: model.id,
          endpoint,
          durationMs: Date.now() - startedAt,
        },
      });
      return jsonOk({ item: videoTurnToDto(mockTurn) }, { status: 202 });
    }

    const result = await postVideoTask(model, body);
    statusCode = result.statusCode;
    requestId = result.requestId;
    const updated = await prisma.videoTurn.update({
      where: { id: turn.id },
      data: {
        status: recordStatus(result.task.status),
        progress: result.task.progress,
        taskId: result.task.taskId,
        videoId: result.task.videoId,
        remoteUrl: result.task.remoteUrl,
        providerResponse: result.task.raw === null ? undefined : result.task.raw,
        errorMessage: result.task.errorMessage,
        completedAt: result.task.status === "completed" ? new Date() : undefined,
      },
    });
    await prisma.apiUsageLog.create({
      data: {
        conversationId: id,
        videoTurnId: turn.id,
        kind: ApiKind.VIDEO_GENERATION,
        model: model.id,
        endpoint: result.endpoint,
        statusCode,
        requestId,
        durationMs: Date.now() - startedAt,
      },
    });
    return jsonOk({ item: videoTurnToDto(updated) }, { status: 202 });
  } catch (error) {
    let message = getErrorMessage(error);
    if ((firstFrame?.startsWith("data:") || lastFrame?.startsWith("data:") || images.some((value) => value.startsWith("data:")))) {
      message += "；AGNES Video 可能不接受 Data URI，请改用素材库中带远程地址的 AGNES 图片";
    }
    const failed = await prisma.videoTurn.update({
      where: { id: turn.id },
      data: { status: RecordStatus.FAILED, errorMessage: message },
    });
    await prisma.apiUsageLog.create({
      data: {
        conversationId: id,
        videoTurnId: turn.id,
        kind: ApiKind.VIDEO_GENERATION,
        model: model.id,
        endpoint,
        statusCode,
        requestId,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      },
    });
    return jsonError(message, 502, { item: videoTurnToDto(failed) });
  }
}
