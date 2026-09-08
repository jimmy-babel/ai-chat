"use client";

import {
  Clapperboard,
  ChevronRight,
  ImageIcon,
  MessageCircle,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  SquarePen,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import type { ConversationItem } from "@/lib/api-types";
import {
  deleteConversation,
  fetchHistory,
  refreshHistory,
  renameConversation,
} from "@/lib/client-api";
import { cn, formatRelativeGroup } from "@/lib/utils";
import { SearchDialog } from "@/components/app-shell/search-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen overflow-hidden bg-white text-zinc-950">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          onSearch={() => setSearchOpen(true)}
        />
        <main className="h-screen min-w-0 flex-1 overflow-y-auto">{children}</main>
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </TooltipProvider>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  onSearch,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = React.useState<ConversationItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [recentOpen, setRecentOpen] = React.useState(true);

  const load = React.useCallback(async (nextCursor?: string | null, replace = false) => {
    setLoading(true);
    try {
      const result = await fetchHistory(nextCursor);
      setItems((current) => (replace ? result.items : [...current, ...result.items]));
      setCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    queueMicrotask(() => void load(null, true));
    const handler = () => void load(null, true);
    window.addEventListener("ai-history-refresh", handler);
    return () => window.removeEventListener("ai-history-refresh", handler);
  }, [load]);

  const grouped = React.useMemo(() => {
    return items.reduce<Record<string, ConversationItem[]>>((acc, item) => {
      const key = formatRelativeGroup(item.lastMessageAt);
      acc[key] ??= [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items]);

  const widthClass = collapsed ? "w-[68px]" : "w-[220px]";

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 border-r border-zinc-200 bg-zinc-50/80 transition-[width] duration-200 md:flex md:flex-col",
        widthClass,
      )}
    >
      <div className="flex h-12 items-center px-3" style={{justifyContent:!collapsed?"space-between":"center"}}>
        {!collapsed ? (
          <Link href="/ai/chat" className="truncate text-lg font-semibold tracking-tight">
            OPEN <span className="text-zinc-500">CHAT</span>
          </Link>
        ) : <div></div>
        // (
        //   <Button asChild variant="ghost" size="iconSm" aria-label="首页">
        //     <Link href="/ai/chat">
        //       <Menu className="size-4" />
        //     </Link>
        //   </Button>
        // )
        }
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" onClick={onToggle} aria-label="折叠侧边栏">
              <PanelLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>折叠侧边栏</TooltipContent>
        </Tooltip>
      </div>

      <nav className="space-y-1 px-2 py-2">
        <NavButton
          collapsed={collapsed}
          active={pathname === "/ai/chat"}
          icon={<SquarePen className="size-4" />}
          label="新聊天"
          href="/ai/chat"
        />
        <NavButton
          collapsed={collapsed}
          active={pathname.startsWith("/ai/image")}
          icon={<ImageIcon className="size-4" />}
          label="创作图片"
          href="/ai/image"
        />
        <NavButton
          collapsed={collapsed}
          active={pathname.startsWith("/ai/video")}
          icon={<Clapperboard className="size-4" />}
          label="创作视频"
          href="/ai/video"
        />
        <NavButton
          collapsed={collapsed}
          icon={<Search className="size-4" />}
          label="搜索记录"
          onClick={onSearch}
        />
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        {!collapsed && (
          <button
            type="button"
            onClick={() => setRecentOpen((value) => !value)}
            className="mb-2 flex h-8 w-full items-center justify-between px-3 text-left text-sm font-semibold text-zinc-950"
            aria-expanded={recentOpen}
          >
            <span>最近</span>
            <ChevronRight
              className={cn(
                "size-4 text-zinc-400 transition-transform duration-200",
                recentOpen && "rotate-90",
              )}
            />
          </button>
        )}
        {recentOpen && (
          <ScrollArea className="min-h-0 flex-1 px-2">
            <div className="space-y-4 pb-4">
              {Object.entries(grouped).map(([group, groupItems]) => (
                <div key={group} className="space-y-1">
                  {!collapsed && (
                    <div className="px-2 py-1 text-xs text-zinc-500">{group}</div>
                  )}
                  {groupItems.map((item) => (
                    <HistoryItem
                      key={item.id}
                      collapsed={collapsed}
                      item={item}
                      active={pathname.endsWith(`/${item.id}`)}
                      onOpen={() =>
                        router.push(itemPath(item))
                      }
                    />
                  ))}
                </div>
              ))}
              {!items.length && !loading && !collapsed && (
                <div className="rounded-2xl bg-white p-4 text-sm text-zinc-400 shadow-sm">
                  还没有最近会话
                </div>
              )}
              {cursor && !collapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={loading}
                  onClick={() => load(cursor)}
                >
                  {loading ? "加载中..." : "加载更多"}
                </Button>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      <div className="h-10 rounded-tr-3xl bg-white" />
    </aside>
  );
}

function NavButton({
  collapsed,
  icon,
  label,
  href,
  active,
  onClick,
}: {
  collapsed: boolean;
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200/70",
    active && "bg-zinc-200/80",
    collapsed && "justify-center px-0",
  );

  const content = (
    <>
      {icon}
      {!collapsed && <span className="text-sm">{label}</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function HistoryItem({
  item,
  active,
  collapsed,
  onOpen,
}: {
  item: ConversationItem;
  active: boolean;
  collapsed: boolean;
  onOpen: () => void;
}) {
  const [renaming, setRenaming] = React.useState(false);

  async function handleRename() {
    const nextTitle = window.prompt("重命名会话", item.title);
    if (!nextTitle || nextTitle === item.title) return;
    await renameConversation(item.id, nextTitle);
    refreshHistory();
  }

  async function handleDelete() {
    if (!window.confirm("删除这个会话？")) return;
    setRenaming(true);
    try {
      await deleteConversation(item.id);
      refreshHistory();
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center rounded-lg text-sm transition hover:bg-zinc-200/70",
        active && "bg-zinc-200/80",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 text-left",
          collapsed && "justify-center px-0",
        )}
      >
        {item.type === "IMAGE" ? (
          <ImageIcon className="size-4 shrink-0 text-zinc-600" />
        ) : item.type === "VIDEO" ? (
          <Clapperboard className="size-4 shrink-0 text-zinc-600" />
        ) : (
          <MessageCircle className="size-4 shrink-0 text-zinc-600" />
        )}
        {!collapsed && <span className="truncate">{item.title}</span>}
      </button>
      {!collapsed && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              className="mr-1 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              disabled={renaming}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleRename}>
              <Pencil className="size-4" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDelete}>
              <Trash2 className="size-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function itemPath(item: ConversationItem) {
  if (item.type === "IMAGE") return `/ai/image/${item.id}`;
  if (item.type === "VIDEO") return `/ai/video/${item.id}`;
  return `/ai/chat/${item.id}`;
}
