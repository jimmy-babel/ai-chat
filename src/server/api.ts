export function jsonOk<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

export function getRequestId(headers: Headers) {
  return (
    headers.get("x-request-id") ||
    headers.get("openai-request-id") ||
    headers.get("request-id") ||
    undefined
  );
}
