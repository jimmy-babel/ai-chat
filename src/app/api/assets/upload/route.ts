import { AssetKind } from "@/generated/prisma/enums";
import { chatConfig, imageConfig, videoConfig } from "@/lib/config";
import { uploadAssetSchema } from "@/lib/schemas";
import { jsonError, jsonOk } from "@/server/api";
import { assetToDto, saveUploadedAsset } from "@/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const parsed = uploadAssetSchema.safeParse({
    kind: formData.get("kind"),
    conversationId: formData.get("conversationId") || undefined,
  });

  if (!parsed.success) return jsonError("上传参数不正确", 422, parsed.error.flatten());
  if (!(file instanceof File)) return jsonError("请选择图片文件", 400);

  if (
    parsed.data.kind !== AssetKind.CHAT_INPUT &&
    parsed.data.kind !== AssetKind.IMAGE_REFERENCE &&
    parsed.data.kind !== AssetKind.IMAGE_MASK &&
    parsed.data.kind !== AssetKind.VIDEO_REFERENCE
  ) {
    return jsonError("该资源类型不允许上传", 422);
  }

  const isChat = parsed.data.kind === AssetKind.CHAT_INPUT;
  const isVideoReference = parsed.data.kind === AssetKind.VIDEO_REFERENCE;
  const allowedTypes = isChat
    ? chatConfig.allowedImageTypes
    : isVideoReference
      ? videoConfig.allowedImageTypes
      : imageConfig.allowedImageTypes;
  const maxUploadBytes = isChat
    ? chatConfig.maxUploadBytes
    : isVideoReference
      ? videoConfig.maxUploadBytes
      : imageConfig.maxUploadBytes;

  if (!allowedTypes.includes(file.type as never)) {
    return jsonError("仅支持 PNG、JPG 或 WebP 图片", 415);
  }

  if (file.size > maxUploadBytes) {
    return jsonError("图片文件过大", 413);
  }

  const asset = await saveUploadedAsset({
    file,
    kind: parsed.data.kind,
    conversationId: parsed.data.conversationId,
  });

  return jsonOk({ item: assetToDto(asset) }, { status: 201 });
}
