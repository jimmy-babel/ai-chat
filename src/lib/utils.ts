import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function compactTitle(value: string, fallback = "新聊天") {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return fallback;
  return title.length > 28 ? `${title.slice(0, 28)}...` : title;
}

export function formatRelativeGroup(dateLike: string | Date) {
  const date = new Date(dateLike);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  if (date >= startOfToday) return "今天";
  if (date >= startOfYesterday) return "昨天";
  return "更早";
}

export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}
