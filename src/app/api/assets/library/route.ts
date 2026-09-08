import { NextRequest } from "next/server";
import { AssetKind } from "@/generated/prisma/enums";
import { jsonError, jsonOk } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import { assetToDto } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const media = request.nextUrl.searchParams.get("media");
  if (media !== "image" && media !== "video") return jsonError("素材类型不正确", 422);
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") || 24), 1), 48);
  const user = await getDefaultUser();
  const assets = await prisma.asset.findMany({
    where: {
      kind: media === "image" ? AssetKind.IMAGE_OUTPUT : AssetKind.VIDEO_OUTPUT,
      provider: "agnes",
      conversation: { userId: user.id, deletedAt: null },
      ...(media === "video" ? { remoteUrl: { not: null } } : {}),
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = assets.length > limit;
  const items = assets.slice(0, limit);
  return jsonOk({
    items: items.map(assetToDto),
    nextCursor: hasMore ? items.at(-1)?.createdAt.toISOString() ?? null : null,
  });
}
