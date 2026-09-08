import { NextRequest } from "next/server";
import { ConversationType } from "@/generated/prisma/enums";
import { createConversationSchema } from "@/lib/schemas";
import { compactTitle } from "@/lib/utils";
import { jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { conversationListItem } from "@/server/serializers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getDefaultUser();
  const type = request.nextUrl.searchParams.get("type");
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 10), 30);

  const conversations = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      ...(type === ConversationType.CHAT ||
      type === ConversationType.IMAGE ||
      type === ConversationType.VIDEO
        ? { type }
        : {}),
      ...(cursor ? { lastMessageAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: {
      messages: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
      imageTurns: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
      videoTurns: {
        orderBy: { sequence: "desc" },
        take: 1,
      },
      assets: true,
    },
  });

  const hasMore = conversations.length > limit;
  const items = conversations.slice(0, limit).map(conversationListItem);

  return jsonOk({
    items,
    nextCursor: hasMore ? items.at(-1)?.lastMessageAt ?? null : null,
  });
}

export async function POST(request: Request) {
  const parsed = createConversationSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError("会话参数不正确", 422, parsed.error.flatten());

  const user = await getDefaultUser();
  const title =
    parsed.data.title ??
    (parsed.data.type === ConversationType.IMAGE
      ? "新的图片创作"
      : parsed.data.type === ConversationType.VIDEO
        ? "新的视频创作"
        : "新聊天");

  const conversation = await prisma.conversation.create({
    data: {
      type: parsed.data.type,
      title: compactTitle(title, title),
      userId: user.id,
    },
    include: {
      messages: true,
      imageTurns: true,
      videoTurns: true,
      assets: true,
    },
  });

  return jsonOk({ item: conversationListItem(conversation) }, { status: 201 });
}
