import assert from "node:assert/strict";
import test from "node:test";
import { imageConfig } from "@/lib/config";
import { findPublicModel, validReasoningEffort } from "@/lib/models";
import {
  agnesImageEditBody,
  canReusePreviousResponse,
  chatEndpoint,
  imageGenerationBody,
  normalizeImageParams,
  reasoningPayload,
  responseTerminalError,
  visibleResponseDelta,
} from "@/server/ai-providers";
import { getPublicModels, resolveServerModel } from "@/server/model-catalog";

test("model catalog keeps the required provider order and defaults", () => {
  const chatModels = getPublicModels("chat");
  const imageModels = getPublicModels("image");
  assert.deepEqual(chatModels.map((model) => model.provider), ["openai", "deepseek", "agnes"]);
  assert.deepEqual(imageModels.map((model) => model.provider), ["openai", "agnes"]);
  assert.equal(chatModels[0].defaultReasoningEffort, "high");
  assert.equal(findPublicModel(chatModels, "missing"), undefined);
  assert.equal(validReasoningEffort(chatModels[0], "not-valid"), "high");
});

test("chat capabilities and reasoning payload are provider-specific", () => {
  const openai = resolveServerModel("chat", process.env.OPENAI_CHAT_MODEL || "gpt-5.5")!;
  const deepseek = resolveServerModel(
    "chat",
    process.env.DEEPSEEK_CHAT_MODEL || "deepseek-v4-flash",
  )!;
  const agnes = resolveServerModel("chat", process.env.AGNES_CHAT_MODEL || "agnes-2.5-flash")!;
  assert.equal(openai.supportsChatImages, true);
  assert.equal(deepseek.supportsChatImages, false);
  assert.deepEqual(reasoningPayload(deepseek, "max"), { effort: "max" });
  assert.equal(reasoningPayload(agnes, "high"), undefined);
});

test("response chain is reused only for the same OpenAI model and endpoint", () => {
  const openai = resolveServerModel("chat", process.env.OPENAI_CHAT_MODEL || "gpt-5.5")!;
  const deepseek = resolveServerModel(
    "chat",
    process.env.DEEPSEEK_CHAT_MODEL || "deepseek-v4-flash",
  )!;
  assert.equal(
    canReusePreviousResponse({
      model: openai,
      providerResponseId: "resp_1",
      previousModel: openai.id,
      previousEndpoint: chatEndpoint(openai),
    }),
    true,
  );
  assert.equal(
    canReusePreviousResponse({
      model: deepseek,
      providerResponseId: "resp_1",
      previousModel: deepseek.id,
      previousEndpoint: chatEndpoint(deepseek),
    }),
    false,
  );
});

test("stream parser exposes answer text but never reasoning text", () => {
  assert.equal(
    visibleResponseDelta({ type: "response.output_text.delta", delta: "answer" }),
    "answer",
  );
  assert.equal(
    visibleResponseDelta({ type: "response.reasoning_text.delta", delta: "secret" }),
    "",
  );
  assert.equal(
    responseTerminalError({
      type: "response.incomplete",
      response: { incomplete_details: { reason: "max_output_tokens" } },
    }),
    "响应未完成：max_output_tokens",
  );
});

test("AGNES image generation and edit payloads request URL output", () => {
  const agnes = resolveServerModel(
    "image",
    process.env.AGNES_IMAGE_MODEL || "agnes-image-2.1-flash",
  )!;
  const params = normalizeImageParams(agnes, {
    ...imageConfig.defaults,
    model: agnes.id,
    aspectRatio: "16:9",
    n: 8,
    outputFormat: "webp",
  });
  assert.equal(params.n, 1);
  assert.equal(params.outputFormat, "png");
  assert.deepEqual(imageGenerationBody({ model: agnes, prompt: "test", params }), {
    model: agnes.id,
    prompt: "test",
    size: "1K",
    ratio: "16:9",
    return_base64: false,
    extra_body: { response_format: "url" },
  });
  assert.deepEqual(
    agnesImageEditBody({ model: agnes, prompt: "edit", params, images: ["data:image/png;base64,AA=="] }),
    {
      model: agnes.id,
      prompt: "edit",
      size: "1K",
      ratio: "16:9",
      extra_body: {
        image: ["data:image/png;base64,AA=="],
        response_format: "url",
      },
    },
  );
});
