import { NextRequest } from "next/server";
import { ConversationType } from "@/generated/prisma/enums";
import { jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { conversationListItem } from "@/server/serializers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getDefaultUser();
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const type = request.nextUrl.searchParams.get("type");

  const conversations = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      ...(type === ConversationType.CHAT ||
      type === ConversationType.IMAGE ||
      type === ConversationType.VIDEO
        ? { type }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { messages: { some: { content: { contains: q } } } },
              { imageTurns: { some: { prompt: { contains: q } } } },
              { videoTurns: { some: { prompt: { contains: q } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: 50,
    include: {
      messages: { orderBy: { sequence: "desc" }, take: 1 },
      imageTurns: { orderBy: { sequence: "desc" }, take: 1 },
      videoTurns: { orderBy: { sequence: "desc" }, take: 1 },
      assets: true,
    },
  });

  return jsonOk({ items: conversations.map(conversationListItem) });
}
