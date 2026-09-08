import { assetToDto } from "@/server/storage";

type AssetLike = Parameters<typeof assetToDto>[0];

type ConversationLike = {
  id: string;
  type: string;
  title: string;
  activeAssetId: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    role: string;
    content: string | null;
    sequence: number;
    status: string;
    attachments: unknown;
    providerResponseId: string | null;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  imageTurns?: Array<{
    id: string;
    sequence: number;
    prompt: string;
    status: string;
    params: unknown;
    referenceAssetIds: unknown;
    outputAssetIds: unknown;
    baseAssetId: string | null;
    activeAssetId: string | null;
    errorMessage: string | null;
    createdAt: Date;
  }>;
  videoTurns?: Array<{
    id: string;
    clientRequestId: string;
    sequence: number;
    model: string;
    mode: string;
    prompt: string;
    status: string;
    progress: number;
    params: unknown;
    referenceAssetIds: unknown;
    taskId: string | null;
    videoId: string | null;
    remoteUrl: string | null;
    outputAssetId: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }>;
  assets?: AssetLike[];
};

function previewFor(conversation: ConversationLike) {
  const lastMessage = conversation.messages?.at(-1);
  const lastTurn = conversation.imageTurns?.at(-1);
  const lastVideoTurn = conversation.videoTurns?.at(-1);

  if (conversation.type === "VIDEO" && lastVideoTurn?.prompt) {
    return lastVideoTurn.prompt;
  }

  if (conversation.type === "IMAGE" && lastTurn?.prompt) {
    return lastTurn.prompt;
  }

  return lastMessage?.content || "";
}

export function conversationListItem(conversation: ConversationLike) {
  const activeAsset = conversation.assets?.find(
    (asset) => asset.id === conversation.activeAssetId,
  );

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    preview: previewFor(conversation),
    activeAssetId: conversation.activeAssetId,
    activeAssetUrl: activeAsset?.publicPath ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function conversationDetail(conversation: ConversationLike) {
  return {
    ...conversationListItem(conversation),
    messages:
      conversation.messages?.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sequence: message.sequence,
        status: message.status,
        attachments: message.attachments,
        providerResponseId: message.providerResponseId,
        errorMessage: message.errorMessage,
        createdAt: message.createdAt.toISOString(),
      })) ?? [],
    imageTurns:
      conversation.imageTurns?.map((turn) => ({
        id: turn.id,
        sequence: turn.sequence,
        prompt: turn.prompt,
        status: turn.status,
        params: turn.params,
        referenceAssetIds: turn.referenceAssetIds,
        outputAssetIds: turn.outputAssetIds,
        baseAssetId: turn.baseAssetId,
        activeAssetId: turn.activeAssetId,
        errorMessage: turn.errorMessage,
        createdAt: turn.createdAt.toISOString(),
      })) ?? [],
    videoTurns: conversation.videoTurns?.map(videoTurnToDto) ?? [],
    assets: conversation.assets?.map(assetToDto) ?? [],
  };
}

export function videoTurnToDto(turn: NonNullable<ConversationLike["videoTurns"]>[number]) {
  return {
    id: turn.id,
    clientRequestId: turn.clientRequestId,
    sequence: turn.sequence,
    model: turn.model,
    mode: turn.mode,
    prompt: turn.prompt,
    status: turn.status,
    progress: turn.progress,
    params: turn.params,
    referenceAssetIds: turn.referenceAssetIds,
    taskId: turn.taskId,
    videoId: turn.videoId,
    remoteUrl: turn.remoteUrl,
    outputAssetId: turn.outputAssetId,
    errorMessage: turn.errorMessage,
    createdAt: turn.createdAt.toISOString(),
    updatedAt: turn.updatedAt.toISOString(),
    completedAt: turn.completedAt?.toISOString() ?? null,
  };
}
