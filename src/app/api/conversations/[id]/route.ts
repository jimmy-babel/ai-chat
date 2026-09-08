import { NextRequest } from "next/server";
import { updateConversationSchema } from "@/lib/schemas";
import { compactTitle } from "@/lib/utils";
import { jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { conversationDetail, conversationListItem } from "@/server/serializers";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await getDefaultUser();

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    include: {
      messages: { orderBy: { sequence: "asc" } },
      imageTurns: { orderBy: { sequence: "asc" } },
      videoTurns: { orderBy: { sequence: "asc" } },
      assets: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation) return jsonError("会话不存在", 404);

  const referencedAssetIds = conversation.videoTurns.flatMap((turn) => {
    if (!turn.referenceAssetIds || typeof turn.referenceAssetIds !== "object") return [];
    const value = turn.referenceAssetIds as Record<string, unknown>;
    return [
      ...(Array.isArray(value.images)
        ? value.images.filter((item): item is string => typeof item === "string")
        : []),
      value.firstFrameAssetId,
      value.lastFrameAssetId,
      value.referenceVideoAssetId,
    ].filter((item): item is string => typeof item === "string");
  });
  const missingIds = [...new Set(referencedAssetIds)].filter(
    (assetId) => !conversation.assets.some((asset) => asset.id === assetId),
  );
  const reusedAssets = missingIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: missingIds }, conversation: { userId: user.id } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return jsonOk({
    item: conversationDetail({ ...conversation, assets: [...conversation.assets, ...reusedAssets] }),
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = updateConversationSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError("标题参数不正确", 422, parsed.error.flatten());

  const user = await getDefaultUser();
  const conversation = await prisma.conversation.update({
    where: { id, userId: user.id },
    data: { title: compactTitle(parsed.data.title) },
    include: { messages: true, imageTurns: true, videoTurns: true, assets: true },
  });

  return jsonOk({ item: conversationListItem(conversation) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const user = await getDefaultUser();

  await prisma.conversation.update({
    where: { id, userId: user.id },
    data: { deletedAt: new Date() },
  });

  return jsonOk({ ok: true });
}
