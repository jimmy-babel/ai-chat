import { ChatDetail } from "@/components/chat/chat-detail";
import { getPublicModels } from "@/server/model-catalog";

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatDetail id={id} models={getPublicModels("chat")} />;
}
