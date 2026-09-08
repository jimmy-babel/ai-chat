"use client";

import { Clapperboard, ImageIcon, MessageCircle, SquarePen, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ConversationItem } from "@/lib/api-types";
import { searchConversations } from "@/lib/client-api";
import { formatRelativeGroup } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("ALL");
  const [items, setItems] = React.useState<ConversationItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await searchConversations(query, type);
        setItems(result.items);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(id);
  }, [open, query, type]);

  const grouped = React.useMemo(() => {
    return items.reduce<Record<string, ConversationItem[]>>((acc, item) => {
      const key = formatRelativeGroup(item.lastMessageAt);
      acc[key] ??= [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items]);

  function openConversation(item: ConversationItem) {
    onOpenChange(false);
    if (item.type === "IMAGE") router.push(`/ai/image/${item.id}`);
    else if (item.type === "VIDEO") router.push(`/ai/video/${item.id}`);
    else router.push(`/ai/chat/${item.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(680px,calc(100vh-80px))] p-0">
        <DialogTitle className="sr-only">搜索关键字</DialogTitle>
        <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-5">
          <Search className="size-5 text-zinc-400" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索关键字"
            className="h-12 border-0 px-0 text-base shadow-none focus:ring-0"
          />
        </div>
        <div className="border-b border-zinc-100 px-4 py-2">
          <Tabs value={type} onValueChange={setType}>
            <TabsList>
              <TabsTrigger value="ALL">全部</TabsTrigger>
              <TabsTrigger value="CHAT">聊天</TabsTrigger>
              <TabsTrigger value="IMAGE">图片</TabsTrigger>
              <TabsTrigger value="VIDEO">视频</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ScrollArea className="h-[calc(100%-116px)]">
          <div className="space-y-5 p-4">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                router.push("/ai/chat");
              }}
              className="flex h-10 w-full items-center gap-3 rounded-lg bg-zinc-100 px-4 text-sm font-medium hover:bg-zinc-200"
            >
              <SquarePen className="size-4" />
              新聊天
            </button>

            {Object.entries(grouped).map(([group, groupItems]) => (
              <section key={group} className="space-y-2">
                <div className="px-3 text-xs text-zinc-500">{group}</div>
                {groupItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openConversation(item)}
                    className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-zinc-100"
                  >
                    {item.type === "IMAGE" ? (
                      <ImageIcon className="size-4 shrink-0" />
                    ) : item.type === "VIDEO" ? (
                      <Clapperboard className="size-4 shrink-0" />
                    ) : (
                      <MessageCircle className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </section>
            ))}

            {!loading && items.length === 0 && (
              <div className="py-12 text-center text-sm text-zinc-400">没有找到相关会话</div>
            )}
            {loading && <div className="py-12 text-center text-sm text-zinc-400">搜索中...</div>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
