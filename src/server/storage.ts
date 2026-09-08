import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { AssetKind } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

const dataRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const uploadRoot = path.join(dataRoot, "uploads");
const outputRoot = path.join(dataRoot, "outputs");

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export type AssetDto = {
  id: string;
  kind: string;
  filename: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  url: string;
  provider: string | null;
  model: string | null;
  remoteUrl: string | null;
  createdAt: string;
};

function dateFolder() {
  const now = new Date();
  return [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ];
}

function extensionFromMime(mimeType: string) {
  return mimeExtensions[mimeType] || "bin";
}

function relativeFor(kind: "uploads" | "outputs", ...parts: string[]) {
  return path.join("data", kind, ...parts);
}

function absoluteFromRelative(relativePath: string) {
  const normalized = relativePath.replace(/^data[\\/]/, "");
  const absolute = path.resolve(dataRoot, normalized);
  if (!absolute.startsWith(dataRoot)) {
    throw new Error("Invalid asset path.");
  }
  return absolute;
}

export function assetToDto(asset: {
  id: string;
  kind: string;
  filename: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  publicPath: string;
  provider: string | null;
  model: string | null;
  remoteUrl: string | null;
  createdAt: Date;
}): AssetDto {
  return {
    id: asset.id,
    kind: asset.kind,
    filename: asset.filename,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    url: asset.publicPath,
    provider: asset.provider,
    model: asset.model,
    remoteUrl: asset.remoteUrl,
    createdAt: asset.createdAt.toISOString(),
  };
}

export async function saveUploadedAsset(input: {
  file: File;
  kind: keyof typeof AssetKind;
  conversationId?: string;
}) {
  const id = randomUUID();
  const mimeType = input.file.type || "application/octet-stream";
  const ext = extensionFromMime(mimeType);
  const folders = dateFolder();
  const filename = `${id}.${ext}`;
  const relativePath = relativeFor("uploads", ...folders, filename);
  const absoluteDir = path.join(uploadRoot, ...folders);
  const absolutePath = path.join(absoluteDir, filename);
  const buffer = Buffer.from(await input.file.arrayBuffer());

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  const asset = await prisma.asset.create({
    data: {
      id,
      conversationId: input.conversationId,
      kind: input.kind,
      filename,
      originalName: input.file.name || filename,
      mimeType,
      sizeBytes: buffer.byteLength,
      relativePath,
      publicPath: `/api/assets/${id}`,
    },
  });

  return asset;
}

export async function saveOutputAsset(input: {
  conversationId: string;
  base64: string;
  mimeType: string;
  originalName?: string;
  kind?: "IMAGE_OUTPUT" | "VIDEO_OUTPUT";
  provider?: string;
  model?: string;
  remoteUrl?: string;
}) {
  const id = randomUUID();
  const ext = extensionFromMime(input.mimeType);
  const folders = dateFolder();
  const filename = `${id}.${ext}`;
  const relativePath = relativeFor("outputs", ...folders, filename);
  const absoluteDir = path.join(outputRoot, ...folders);
  const absolutePath = path.join(absoluteDir, filename);
  const buffer = Buffer.from(input.base64, "base64");

  await mkdir(absoluteDir, { recursive: true });
  await writeFile(absolutePath, buffer);

  return prisma.asset.create({
    data: {
      id,
      conversationId: input.conversationId,
      kind: input.kind ?? AssetKind.IMAGE_OUTPUT,
      filename,
      originalName: input.originalName ?? filename,
      mimeType: input.mimeType,
      sizeBytes: buffer.byteLength,
      relativePath,
      publicPath: `/api/assets/${id}`,
      provider: input.provider,
      model: input.model,
      remoteUrl: input.remoteUrl,
    },
  });
}

export async function readAssetFile(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return null;

  const absolutePath = absoluteFromRelative(asset.relativePath);
  const buffer = await readFile(absolutePath);

  return { asset, buffer };
}

export async function findAssetOnDisk(assetId: string) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return null;
  const absolutePath = absoluteFromRelative(asset.relativePath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return null;
  return { asset, absolutePath, sizeBytes: fileStat.size };
}

export async function assetAsDataUrl(assetId: string) {
  const file = await readAssetFile(assetId);
  if (!file) return null;
  return `data:${file.asset.mimeType};base64,${file.buffer.toString("base64")}`;
}

export async function assetAsCompressedDataUrl(
  assetId: string,
  options: { maxDimension?: number; maxBytes?: number } = {},
) {
  const file = await readAssetFile(assetId);
  if (!file || !file.asset.mimeType.startsWith("image/")) return null;

  const compressed = await compressImageBuffer(file.buffer, options);
  return `data:${compressed.mimeType};base64,${compressed.buffer.toString("base64")}`;
}

export async function compressImageBuffer(
  input: Buffer,
  options: { maxDimension?: number; maxBytes?: number } = {},
) {
  const maxDimension = options.maxDimension ?? 1920;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const source = sharp(input, { failOn: "error" }).rotate();
  const metadata = await source.metadata();
  const resized = source.resize({
    width: maxDimension,
    height: maxDimension,
    fit: "inside",
    withoutEnlargement: true,
  });
  const hasAlpha = Boolean(metadata.hasAlpha);
  const buffer = hasAlpha
    ? await resized.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer();

  if (buffer.byteLength > maxBytes) {
    throw new Error("压缩后的参考图片仍超过 2MB，请选择尺寸更小的图片");
  }

  const mimeType = hasAlpha ? "image/png" : "image/jpeg";
  return { buffer, mimeType };
}

export function validateRemoteOutputUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("供应商返回了不安全的输出地址");
  }
  return url;
}

export async function saveRemoteOutputAsset(input: {
  conversationId: string;
  remoteUrl: string;
  kind: "IMAGE_OUTPUT" | "VIDEO_OUTPUT";
  provider: string;
  model: string;
  originalName?: string;
  fallbackMimeType: string;
  maxBytes: number;
}) {
  const remoteUrl = validateRemoteOutputUrl(input.remoteUrl);
  const response = await fetch(remoteUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`下载供应商输出失败（${response.status}）`);
  }
  validateRemoteOutputUrl(response.url || remoteUrl.toString());

  const length = Number(response.headers.get("content-length") || 0);
  if (length > input.maxBytes) throw new Error("供应商输出文件超过本地保存上限");

  const mimeType = response.headers.get("content-type")?.split(";")[0] || input.fallbackMimeType;
  const id = randomUUID();
  const ext = extensionFromMime(mimeType);
  const folders = dateFolder();
  const filename = `${id}.${ext}`;
  const relativePath = relativeFor("outputs", ...folders, filename);
  const absoluteDir = path.join(outputRoot, ...folders);
  const absolutePath = path.join(absoluteDir, filename);
  const temporaryPath = `${absolutePath}.part`;
  let sizeBytes = 0;

  await mkdir(absoluteDir, { recursive: true });
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > input.maxBytes) {
        callback(new Error("供应商输出文件超过本地保存上限"));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      limiter,
      createWriteStream(temporaryPath, { flags: "wx" }),
    );
    await rename(temporaryPath, absolutePath);
    return await prisma.asset.create({
      data: {
        id,
        conversationId: input.conversationId,
        kind: input.kind,
        filename,
        originalName: input.originalName ?? filename,
        mimeType,
        sizeBytes,
        relativePath,
        publicPath: `/api/assets/${id}`,
        provider: input.provider,
        model: input.model,
        remoteUrl: input.remoteUrl,
      },
    });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function attachAssetsToConversation(assetIds: string[], conversationId: string) {
  if (!assetIds.length) return;

  await prisma.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { conversationId },
  });
}

export function svgPlaceholderBase64(prompt: string) {
  const escaped = prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#f8fafc" offset="0"/>
      <stop stop-color="#dfe7e1" offset="0.55"/>
      <stop stop-color="#f5f5f0" offset="1"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="48" fill="url(#g)"/>
  <circle cx="512" cy="430" r="170" fill="#ffffff" opacity="0.42"/>
  <text x="512" y="520" font-family="Arial, sans-serif" text-anchor="middle" font-size="32" fill="#111827">AI Image Preview</text>
  <foreignObject x="172" y="575" width="680" height="180">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font: 28px Arial, sans-serif; color: #4b5563; line-height: 1.45; text-align: center;">${escaped}</div>
  </foreignObject>
</svg>`;

  return Buffer.from(svg, "utf8").toString("base64");
}
