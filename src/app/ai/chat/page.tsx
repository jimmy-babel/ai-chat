import { randomInt } from "node:crypto";
import { ChatHome } from "@/components/chat/chat-home";
import { getPublicModels } from "@/server/model-catalog";

const greetings = [
  "准备好了，随时开始",
  "今天想一起处理什么？",
  "把问题交给我，我们慢慢拆",
  "Hi，有什么我可以帮你处理的吗？",
];

export default function ChatPage() {
  return <ChatHome greeting={greetings[randomInt(greetings.length)]} models={getPublicModels("chat")} />;
}
