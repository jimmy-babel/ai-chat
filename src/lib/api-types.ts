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

export type ConversationItem = {
  id: string;
  type: "CHAT" | "IMAGE" | "VIDEO";
  title: string;
  preview: string;
  activeAssetId: string | null;
  activeAssetUrl: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageDto = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "DEVELOPER";
  content: string | null;
  sequence: number;
  status: string;
  attachments: unknown;
  providerResponseId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ImageTurnDto = {
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
  createdAt: string;
};

export type VideoTurnDto = {
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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ConversationDetail = ConversationItem & {
  messages: ChatMessageDto[];
  imageTurns: ImageTurnDto[];
  videoTurns: VideoTurnDto[];
  assets: AssetDto[];
};

export type ChatDraft = {
  content: string;
  assetIds: string[];
  model: string;
  reasoningEffort: string;
};

export type ImageDraft = {
  prompt: string;
  params: Record<string, unknown>;
  referenceAssetIds: string[];
  baseAssetId?: string;
  activeAssetId?: string;
};

export type VideoDraft = {
  prompt: string;
  params: Record<string, unknown>;
  referenceImageAssetIds: string[];
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceVideoAssetId?: string;
  stagedAssets?: AssetDto[];
};
