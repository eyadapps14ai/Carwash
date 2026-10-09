import { createHmac, timingSafeEqual } from "node:crypto";
const matches = (a: Buffer, b: Buffer) =>
  a.length === b.length && timingSafeEqual(a, b);
export function verifyMeta(
  body: string,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  return matches(
    createHmac("sha256", secret).update(body).digest(),
    Buffer.from(signature.slice(7), "hex"),
  );
}
export function verifyResend(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get("svix-id"),
    timestamp = headers.get("svix-timestamp"),
    signature = headers.get("svix-signature");
  if (
    !id ||
    !timestamp ||
    !signature ||
    !secret ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
    expected = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${body}`)
      .digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return (
      version === "v1" && !!sig && matches(expected, Buffer.from(sig, "base64"))
    );
  });
}
