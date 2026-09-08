import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { videoConfig } from "@/lib/config";
import { referencesForVideoMode } from "@/lib/video-draft";
import { getPublicModels, resolveServerModel } from "@/server/model-catalog";
import { parseByteRange } from "@/server/http-range";
import { compressImageBuffer, validateRemoteOutputUrl } from "@/server/storage";
import {
  normalizeVideoParams,
  parseVideoTask,
  sanitizedVideoRequest,
  videoCreationBody,
  videoStatusEndpoint,
} from "@/server/video-provider";

const flashId = process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5-flash";
const standardId = process.env.AGNES_VIDEO_REFERENCE_MODEL || "agnes-video-2.5";

test("video catalog is ordered Flash then standard with distinct capabilities", () => {
  const models = getPublicModels("video");
  assert.deepEqual(models.map((model) => model.id), [flashId, standardId]);
  assert.deepEqual(models[0].videoCapabilities?.sizes, ["720P"]);
  assert.equal(models[0].videoCapabilities?.supportsVideoReferences, false);
  assert.equal(models[1].videoCapabilities?.supportsVideoReferences, true);
  assert.deepEqual(models[1].videoCapabilities?.sizes, ["720P", "960P", "2K"]);
  assert.equal(resolveServerModel("image", flashId), undefined);
});

test("mode switching preserves state while request references stay mutually exclusive", () => {
  const references = {
    referenceImageAssetIds: ["image-1"],
    firstFrameAssetId: "first-1",
    lastFrameAssetId: "last-1",
    referenceVideoAssetId: "video-1",
  };
  assert.deepEqual(referencesForVideoMode("text", references), {
    referenceImageAssetIds: [],
  });
  assert.deepEqual(referencesForVideoMode("keyframe", references), {
    referenceImageAssetIds: [],
    firstFrameAssetId: "first-1",
    lastFrameAssetId: "last-1",
  });
  assert.deepEqual(referencesForVideoMode("reference", references), {
    referenceImageAssetIds: ["image-1"],
    referenceVideoAssetId: "video-1",
  });
  assert.deepEqual(references.referenceImageAssetIds, ["image-1"]);
});

test("video payloads keep modes mutually exclusive and normalize Flash size", () => {
  const flash = resolveServerModel("video", flashId)!;
  const standard = resolveServerModel("video", standardId)!;
  const flashParams = normalizeVideoParams(flash, {
    ...videoConfig.defaults,
    model: flash.id,
    size: "2K",
  });
  assert.equal(flashParams.size, "720P");
  assert.deepEqual(
    videoCreationBody({ model: flash, prompt: "scene", params: flashParams }),
    {
      model: flash.id,
      prompt: "scene",
      mode: "text",
      seconds: "5",
      size: "720P",
      aspect_ratio: "16:9",
      n: 1,
    },
  );

  const keyframe = videoCreationBody({
    model: flash,
    prompt: "move",
    params: { ...flashParams, mode: "keyframe" },
    firstFrame: "data:image/jpeg;base64,secret",
  });
  assert.equal(keyframe.first_frame, "data:image/jpeg;base64,secret");
  assert.equal(keyframe.images, undefined);
  assert.deepEqual(sanitizedVideoRequest(keyframe).first_frame, "[image]");
  assert.equal(JSON.stringify(sanitizedVideoRequest(keyframe)).includes("secret"), false);

  const reference = videoCreationBody({
    model: standard,
    prompt: "follow <Video 1>",
    params: { ...flashParams, model: standard.id, mode: "reference", size: "2K" },
    images: ["https://example.com/image.png"],
    referenceVideoUrl: "https://example.com/video.mp4",
  });
  assert.deepEqual(reference.videos, [
    { url: "https://example.com/video.mp4", start_seconds: 0, require_audio: false },
  ]);
  assert.equal(reference.first_frame, undefined);
});

test("status parsing and endpoint preserve model_name and completion URL", () => {
  const model = resolveServerModel("video", standardId)!;
  const endpoint = new URL(videoStatusEndpoint(model, "video_1"));
  assert.equal(endpoint.searchParams.get("video_id"), "video_1");
  assert.equal(endpoint.searchParams.get("model_name"), standardId);
  assert.deepEqual(
    parseVideoTask({
      id: "task_1",
      video_id: "video_1",
      status: "completed",
      progress: 100,
      metadata: { url: "https://example.com/out.mp4" },
    }),
    {
      taskId: "task_1",
      videoId: "video_1",
      status: "completed",
      progress: 100,
      remoteUrl: "https://example.com/out.mp4",
      errorMessage: undefined,
      raw: {
        id: "task_1",
        video_id: "video_1",
        status: "completed",
        progress: 100,
        metadata: { url: "https://example.com/out.mp4" },
      },
    },
  );
  assert.equal(parseVideoTask({ status: "failed", error: { message: "bad media" } }).errorMessage, "bad media");
  assert.equal(
    parseVideoTask({ status: "completed", progress: 100, url: "https://example.com/flash.mp4" })
      .remoteUrl,
    "https://example.com/flash.mp4",
  );
});

test("image compression honors transparency and byte limits", async () => {
  const transparent = await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const compressed = await compressImageBuffer(transparent);
  assert.equal(compressed.mimeType, "image/png");
  await assert.rejects(() => compressImageBuffer(transparent, { maxBytes: 1 }), /超过 2MB/);
});

test("remote outputs require HTTPS and byte ranges reject invalid requests", () => {
  assert.equal(validateRemoteOutputUrl("https://cdn.example.com/video.mp4").protocol, "https:");
  assert.throws(() => validateRemoteOutputUrl("http://example.com/video.mp4"), /不安全/);
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-50", 1000), { start: 950, end: 999 });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.equal(parseByteRange("bytes=1000-1001", 1000), null);
  assert.equal(parseByteRange("bytes=0-1,4-5", 1000), null);
});
