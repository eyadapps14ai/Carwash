export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function boundedText(req: Request, limit: number) {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new RequestError("Request too large", 413);
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RequestError("Request too large", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function boundedJSON(req: Request, limit = 262144) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new RequestError("Use application/json", 415);
  try {
    return JSON.parse(await boundedText(req, limit));
  } catch (e) {
    if (e instanceof RequestError) throw e;
    throw new RequestError("Invalid JSON request", 400);
  }
}
export async function boundedForm(req: Request, limit = 8192) {
  if (
    !req.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new RequestError("Use an encoded form", 415);
  return new URLSearchParams(await boundedText(req, limit));
}
export function isDatabaseError(e: unknown) {
  return (
    e instanceof Error &&
    (/^Prisma/.test(e.constructor.name) || /PrismaClient/.test(e.name))
  );
}
export function safeError(
  e: unknown,
  fallback = "Data is temporarily unavailable",
) {
  return isDatabaseError(e)
    ? fallback
    : e instanceof RequestError
      ? e.message
      : e instanceof SyntaxError
        ? "Invalid request"
        : e instanceof Error
          ? e.message
          : fallback;
}
