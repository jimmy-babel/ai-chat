export type ByteRange = { start: number; end: number };

export function parseByteRange(value: string, sizeBytes: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return null;
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, sizeBytes - suffixLength);
    end = sizeBytes - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), sizeBytes - 1) : sizeBytes - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start > end ||
    start >= sizeBytes
  ) {
    return null;
  }
  return { start, end };
}
