import { ApiKind, AssetKind, RecordStatus } from "@/generated/prisma/enums";
import { videoConfig } from "@/lib/config";
import { getErrorMessage, jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { resolveServerModel } from "@/server/model-catalog";
import { videoTurnToDto } from "@/server/serializers";
import { saveRemoteOutputAsset } from "@/server/storage";
import { pollVideoTask, videoStatusEndpoint } from "@/server/video-provider";

export const runtime = "nodejs";

async function materializeVideo(turn: {
  id: string;
  conversationId: string;
  model: string;
  prompt: string;
  remoteUrl: string | null;
  outputAssetId: string | null;
}) {
  if (!turn.remoteUrl || turn.outputAssetId) return turn.outputAssetId;
  const existing = await prisma.asset.findFirst({
    where: {
      conversationId: turn.conversationId,
      kind: AssetKind.VIDEO_OUTPUT,
      remoteUrl: turn.remoteUrl,
    },
  });
  if (existing) return existing.id;
  const asset = await saveRemoteOutputAsset({
    conversationId: turn.conversationId,
    remoteUrl: turn.remoteUrl,
    kind: "VIDEO_OUTPUT",
    provider: "agnes",
    model: turn.model,
    originalName: `${turn.prompt.slice(0, 40) || "agnes-video"}.mp4`,
    fallbackMimeType: "video/mp4",
    maxBytes: videoConfig.maxDownloadBytes,
  });
  return asset.id;
}

async function logTerminalStatus(input: {
  conversationId: string;
  turnId: string;
  model: string;
  endpoint: string;
  statusCode?: number;
  requestId?: string;
  durationMs: number;
  errorMessage?: string;
}) {
  const existing = await prisma.apiUsageLog.findFirst({
    where: { videoTurnId: input.turnId, kind: ApiKind.VIDEO_STATUS },
  });
  if (existing) return;
  await prisma.apiUsageLog.create({
    data: {
      conversationId: input.conversationId,
      videoTurnId: input.turnId,
      kind: ApiKind.VIDEO_STATUS,
      model: input.model,
      endpoint: input.endpoint,
      statusCode: input.statusCode,
      requestId: input.requestId,
      durationMs: input.durationMs,
      errorMessage: input.errorMessage,
    },
  });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; turnId: string }> },
) {
  const { id, turnId } = await context.params;
  const user = await getDefaultUser();
  let turn = await prisma.videoTurn.findFirst({
    where: {
      id: turnId,
      conversationId: id,
      conversation: { userId: user.id, deletedAt: null, type: "VIDEO" },
    },
  });
  if (!turn) return jsonError("视频任务不存在", 404);

  const model = resolveServerModel("video", turn.model);
  if (!model) return jsonError("视频任务使用了未知模型", 422);

  if (turn.status === RecordStatus.COMPLETED) {
    if (turn.remoteUrl && !turn.outputAssetId) {
      try {
        const outputAssetId = await materializeVideo(turn);
        turn = await prisma.videoTurn.update({
          where: { id: turn.id },
          data: { outputAssetId, errorMessage: null },
        });
        await prisma.conversation.update({
          where: { id },
          data: { activeAssetId: outputAssetId, lastMessageAt: new Date() },
        });
      } catch (error) {
        turn = await prisma.videoTurn.update({
          where: { id: turn.id },
          data: { errorMessage: `视频已生成，但本地保存失败：${getErrorMessage(error)}` },
        });
      }
    }
    return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: null });
  }
  if (turn.status === RecordStatus.FAILED || turn.status === RecordStatus.CANCELLED) {
    return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: null });
  }

  const isMock = turn.videoId?.startsWith("mock-video-");
  if (isMock) {
    const progress = Math.min(100, turn.progress + 50);
    turn = await prisma.videoTurn.update({
      where: { id: turn.id },
      data: {
        progress,
        status: progress >= 100 ? RecordStatus.COMPLETED : RecordStatus.STREAMING,
        completedAt: progress >= 100 ? new Date() : undefined,
        providerResponse: { mock: true, status: progress >= 100 ? "completed" : "in_progress", progress },
      },
    });
    return jsonOk(
      { item: videoTurnToDto(turn), retryAfterMs: progress >= 100 ? null : 2000 },
      { status: progress >= 100 ? 200 : 202 },
    );
  }
  if (!turn.videoId) return jsonError("视频任务缺少 video_id", 502);

  const startedAt = Date.now();
  const endpoint = videoStatusEndpoint(model, turn.videoId);
  try {
    const result = await pollVideoTask(model, turn.videoId);
    const task = result.task;
    if (task.status === "failed") {
      const message = task.errorMessage || "AGNES 视频生成失败";
      turn = await prisma.videoTurn.update({
        where: { id: turn.id },
        data: {
          status: RecordStatus.FAILED,
          progress: task.progress,
          providerResponse: task.raw === null ? undefined : task.raw,
          errorMessage: message,
        },
      });
      await logTerminalStatus({
        conversationId: id,
        turnId: turn.id,
        model: model.id,
        endpoint: result.endpoint,
        statusCode: result.statusCode,
        requestId: result.requestId,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: null });
    }

    if (task.status === "completed") {
      if (!task.remoteUrl) return jsonError("AGNES 已完成任务但没有返回视频地址", 502);
      turn = await prisma.videoTurn.update({
        where: { id: turn.id },
        data: {
          status: RecordStatus.COMPLETED,
          progress: 100,
          taskId: task.taskId ?? turn.taskId,
          remoteUrl: task.remoteUrl,
          providerResponse: task.raw === null ? undefined : task.raw,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      try {
        const outputAssetId = await materializeVideo(turn);
        turn = await prisma.videoTurn.update({
          where: { id: turn.id },
          data: { outputAssetId },
        });
        await prisma.conversation.update({
          where: { id },
          data: { activeAssetId: outputAssetId, lastMessageAt: new Date() },
        });
      } catch (error) {
        turn = await prisma.videoTurn.update({
          where: { id: turn.id },
          data: { errorMessage: `视频已生成，但本地保存失败：${getErrorMessage(error)}` },
        });
      }
      await logTerminalStatus({
        conversationId: id,
        turnId: turn.id,
        model: model.id,
        endpoint: result.endpoint,
        statusCode: result.statusCode,
        requestId: result.requestId,
        durationMs: Date.now() - startedAt,
      });
      return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: null });
    }

    turn = await prisma.videoTurn.update({
      where: { id: turn.id },
      data: {
        status: task.status === "in_progress" ? RecordStatus.STREAMING : RecordStatus.PENDING,
        progress: task.progress,
        taskId: task.taskId ?? turn.taskId,
        providerResponse: task.raw === null ? undefined : task.raw,
      },
    });
    return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: 2000 }, { status: 202 });
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return jsonOk({ item: videoTurnToDto(turn), retryAfterMs: 10000 }, { status: 202 });
    }
    return jsonError(getErrorMessage(error), 502, {
      item: videoTurnToDto(turn),
      retryAfterMs: 4000,
      endpoint,
    });
  }
}
