import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { jsonError } from "@/server/api";
import { parseByteRange } from "@/server/http-range";
import { findAssetOnDisk } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const file = await findAssetOnDisk(id);

  if (!file) return jsonError("资源不存在", 404);

  const commonHeaders = {
    "Content-Type": file.asset.mimeType,
    "Cache-Control": "private, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  const range = request.headers.get("range");
  if (!range) {
    const stream = createReadStream(file.absolutePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { ...commonHeaders, "Content-Length": String(file.sizeBytes) },
    });
  }

  const parsedRange = parseByteRange(range, file.sizeBytes);
  if (!parsedRange) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${file.sizeBytes}` },
    });
  }
  const { start, end } = parsedRange;
  const stream = createReadStream(file.absolutePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${file.sizeBytes}`,
    },
  });
}
