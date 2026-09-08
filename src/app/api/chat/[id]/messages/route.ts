import { ApiKind, AssetKind, MessageRole, RecordStatus } from "@/generated/prisma/enums";
import { chatMessageSchema } from "@/lib/schemas";
import { compactTitle, sleep } from "@/lib/utils";
import { getErrorMessage, getRequestId, jsonError } from "@/server/api";
import { getDefaultUser, prisma } from "@/server/db";
import {
  canReusePreviousResponse,
  chatEndpoint,
  completedResponse,
  extractResponseText,
  isModelConfigured,
  postResponsesStream,
  reasoningPayload,
  responseTerminalError,
  visibleResponseDelta,
} from "@/server/ai-providers";
import { resolveServerModel } from "@/server/model-catalog";
import { assetAsDataUrl, attachAssetsToConversation, assetToDto } from "@/server/storage";

export const runtime = "nodejs";

const encoder = new TextEncoder();

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractDoneText(event: unknown) {
  if (!event || typeof event !== "object") return "";
  const record = event as Record<string, unknown>;
  if (record.type === "response.output_text.done" && typeof record.text === "string") {
    return record.text;
  }
  return "";
}

async function buildResponsesInput(conversationId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      status: RecordStatus.COMPLETED,
    },
    orderBy: { sequence: "asc" },
  });

  const input = [];

  for (const message of messages) {
    if (message.role === MessageRole.SYSTEM || message.role === MessageRole.DEVELOPER) continue;

    const role = message.role === MessageRole.ASSISTANT ? "assistant" : "user";
    const content: Array<Record<string, string>> = [];

    if (message.content) {
      content.push({
        type: role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      });
    }

    if (role === "user" && Array.isArray(message.attachments)) {
      for (const attachment of message.attachments) {
        const id =
          typeof attachment === "string"
            ? attachment
            : typeof attachment === "object" &&
                attachment &&
                "id" in attachment &&
                typeof attachment.id === "string"
              ? attachment.id
              : null;

        if (!id) continue;
        const dataUrl = await assetAsDataUrl(id);
        if (!dataUrl) continue;
        content.push({ type: "input_image", image_url: dataUrl });
      }
    }

    if (content.length > 0) {
      input.push({ role, content });
    }
  }

  return input;
}

async function nextSequence(conversationId: string) {
  const aggregate = await prisma.chatMessage.aggregate({
    where: { conversationId },
    _max: { sequence: true },
  });

  return (aggregate._max.sequence ?? 0) + 1;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = chatMessageSchema.safeParse(await request.json());
  if (!parsed.success) return jsonError("消息参数不正确", 422, parsed.error.flatten());
  if (!parsed.data.content && parsed.data.assetIds.length === 0) {
    return jsonError("请输入消息或上传图片", 400);
  }

  const model = resolveServerModel("chat", parsed.data.model);
  if (!model) return jsonError("不支持的聊天模型", 422);
  if (!model.reasoningEfforts.includes(parsed.data.reasoningEffort)) {
    return jsonError("该模型不支持所选推理等级", 422);
  }
  if (parsed.data.assetIds.length > 0 && !model.supportsChatImages) {
    return jsonError("当前模型暂不支持本地图片附件", 400);
  }

  const user = await getDefaultUser();
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id, deletedAt: null, type: "CHAT" },
  });

  if (!conversation) return jsonError("聊天会话不存在", 404);

  await attachAssetsToConversation(parsed.data.assetIds, id);
  const attachedAssets = parsed.data.assetIds.length
    ? await prisma.asset.findMany({
        where: { id: { in: parsed.data.assetIds }, kind: AssetKind.CHAT_INPUT },
      })
    : [];

  const firstSequence = await nextSequence(id);
  const previousAssistant = await prisma.chatMessage.findFirst({
    where: {
      conversationId: id,
      role: MessageRole.ASSISTANT,
      providerResponseId: { not: null },
    },
    orderBy: { sequence: "desc" },
    include: {
      apiLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const userMessage = await prisma.chatMessage.create({
    data: {
      conversationId: id,
      role: MessageRole.USER,
      content: parsed.data.content,
      sequence: firstSequence,
      attachments: attachedAssets.map(assetToDto),
      status: RecordStatus.COMPLETED,
    },
  });

  const assistantMessage = await prisma.chatMessage.create({
    data: {
      conversationId: id,
      role: MessageRole.ASSISTANT,
      sequence: firstSequence + 1,
      status: RecordStatus.STREAMING,
      previousResponseId: previousAssistant?.providerResponseId,
    },
  });

  await prisma.conversation.update({
    where: { id },
    data: {
      title:
        conversation.title === "新聊天" && parsed.data.content
          ? compactTitle(parsed.data.content)
          : conversation.title,
      lastMessageAt: new Date(),
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let finalText = "";
      let rawResponse: unknown = null;
      let providerResponseId: string | undefined;
      let statusCode: number | undefined;
      let requestId: string | undefined;
      const providerEndpoint = chatEndpoint(model);

      controller.enqueue(
        sse("meta", {
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          attachments: attachedAssets.map(assetToDto),
        }),
      );

      try {
        if (!isModelConfigured(model)) {
          const text =
            `已选择 ${model.displayName}。请配置对应的 ${model.providerLabel} API key 后，我会切换到真实模型流式回复。`;
          for (const char of text) {
            finalText += char;
            controller.enqueue(sse("delta", { text: char }));
            await sleep(14);
          }
        } else {
          const input = await buildResponsesInput(id);
          const payload: Record<string, unknown> = {
            model: model.id,
            input,
            stream: true,
          };

          const reasoning = reasoningPayload(model, parsed.data.reasoningEffort);
          if (reasoning) payload.reasoning = reasoning;

          const previousLog = previousAssistant?.apiLogs[0];
          const previousResponseId = previousAssistant?.providerResponseId;
          if (
            previousResponseId &&
            canReusePreviousResponse({
              model,
              providerResponseId: previousResponseId,
              previousModel: previousLog?.model,
              previousEndpoint: previousLog?.endpoint,
            })
          ) {
            payload.previous_response_id = previousResponseId;
          }

          const response = await postResponsesStream(model, payload);
          statusCode = response.status;
          requestId = getRequestId(response.headers);

          if (!response.ok || !response.body) {
            const errorText = await response.text().catch(() => "");
            throw new Error(errorText || `Responses API failed with ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";

            for (const chunk of chunks) {
              const lines = chunk
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("data:"));

              for (const line of lines) {
                const raw = line.replace(/^data:\s*/, "");
                if (!raw || raw === "[DONE]") continue;

                const event = JSON.parse(raw) as unknown;
                const terminalError = responseTerminalError(event);
                if (terminalError) throw new Error(terminalError);

                const delta = visibleResponseDelta(event);
                if (delta) {
                  finalText += delta;
                  controller.enqueue(sse("delta", { text: delta }));
                }

                const doneText = extractDoneText(event);
                if (doneText) {
                  finalText = doneText;
                }

                const completed = completedResponse(event);
                if (completed) {
                  rawResponse = completed;
                  const completedId = (completed as { id?: unknown }).id;
                  if (
                    model.supportsPreviousResponseId &&
                    typeof completedId === "string" &&
                    completedId.length <= 191
                  ) {
                    providerResponseId = completedId;
                  }
                  const completedText = extractResponseText(completed);
                  if (!finalText && completedText) finalText = completedText;
                }
              }
            }
          }

          if (buffer.trim()) {
            const lines = buffer
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("data:"));

            for (const line of lines) {
              const raw = line.replace(/^data:\s*/, "");
              if (!raw || raw === "[DONE]") continue;
              const event = JSON.parse(raw) as unknown;
              const terminalError = responseTerminalError(event);
              if (terminalError) throw new Error(terminalError);
              const delta = visibleResponseDelta(event);
              if (delta) {
                finalText += delta;
                controller.enqueue(sse("delta", { text: delta }));
              }
              const doneText = extractDoneText(event);
              if (doneText) finalText = doneText;

              const completed = completedResponse(event);
              if (completed) {
                rawResponse = completed;
                const completedId = (completed as { id?: unknown }).id;
                if (
                  model.supportsPreviousResponseId &&
                  typeof completedId === "string" &&
                  completedId.length <= 191
                ) {
                  providerResponseId = completedId;
                }
              }
            }
          }
        }

        await prisma.chatMessage.update({
          where: { id: assistantMessage.id },
          data: {
            content: finalText,
            status: RecordStatus.COMPLETED,
            providerResponseId,
            rawResponse: rawResponse === null ? undefined : rawResponse,
          },
        });

        await prisma.conversation.update({
          where: { id },
          data: { lastMessageAt: new Date() },
        });

        await prisma.apiUsageLog.create({
          data: {
            conversationId: id,
            chatMessageId: assistantMessage.id,
            kind: ApiKind.RESPONSES,
            model: model.id,
            endpoint: providerEndpoint,
            statusCode,
            requestId,
            durationMs: Date.now() - startedAt,
          },
        });

        controller.enqueue(sse("done", { text: finalText }));
      } catch (error) {
        const message = getErrorMessage(error);

        await prisma.chatMessage.update({
          where: { id: assistantMessage.id },
          data: {
            status: RecordStatus.FAILED,
            errorMessage: message,
            content: finalText || null,
          },
        });

        await prisma.apiUsageLog.create({
          data: {
            conversationId: id,
            chatMessageId: assistantMessage.id,
            kind: ApiKind.RESPONSES,
            model: model.id,
            endpoint: providerEndpoint,
            statusCode,
            requestId,
            durationMs: Date.now() - startedAt,
            errorMessage: message,
          },
        });

        controller.enqueue(sse("error", { message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
