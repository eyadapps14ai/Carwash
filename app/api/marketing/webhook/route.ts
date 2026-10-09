import { NextResponse } from "next/server";
import { verifyMeta, verifyResend } from "@/lib/webhook-signature";
import { recordDeliveryEvent } from "@/lib/marketing-delivery";
import { db } from "@/lib/db";
import { optOut } from "@/lib/marketing-optout";
import { boundedText, RequestError } from "@/lib/request-security";
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (
    process.env.WHATSAPP_VERIFY_TOKEN &&
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
  )
    return new Response(p.get("hub.challenge") ?? "");
  return new Response("Forbidden", { status: 403 });
}
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 262144)
    return new Response("Too large", { status: 413 });
  let body: string;
  try {
    body = await boundedText(req, 262144);
  } catch (e) {
    return new Response("Invalid webhook request", {
      status: e instanceof RequestError ? e.status : 400,
    });
  }
  if (body.length > 262144) return new Response("Too large", { status: 413 });
  const provider = new URL(req.url).searchParams.get("provider");
  if (provider === "email") {
    if (
      !verifyResend(body, req.headers, process.env.RESEND_WEBHOOK_SECRET ?? "")
    )
      return new Response("Forbidden", { status: 403 });
    try {
      const event = JSON.parse(body),
        status =
          event.type === "email.delivered"
            ? "DELIVERED"
            : [
                  "email.bounced",
                  "email.failed",
                  "email.complained",
                  "email.suppressed",
                ].includes(event.type)
              ? "FAILED"
              : event.type === "email.sent"
                ? "ACCEPTED"
                : null;
      if (status && typeof event.data?.email_id === "string")
        await recordDeliveryEvent(
          `resend:${req.headers.get("svix-id")}`,
          event.data.email_id,
          status,
        );
      if (["email.complained", "email.bounced"].includes(event.type)) {
        const d = await db.marketingDelivery.findUnique({
          where: { providerId: event.data.email_id },
          include: { voucher: true },
        });
        if (d)
          await optOut(
            d.voucher.customerId,
            "Verified email provider complaint/bounce",
          );
      }
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }
  } else if (provider === "whatsapp") {
    if (
      !verifyMeta(
        body,
        req.headers.get("x-hub-signature-256"),
        process.env.WHATSAPP_APP_SECRET ?? "",
      )
    )
      return new Response("Forbidden", { status: 403 });
    try {
      const payload = JSON.parse(body);
      for (const entry of payload.entry ?? [])
        for (const change of entry.changes ?? []) {
          if (
            change.value?.metadata?.phone_number_id !==
            process.env.WHATSAPP_PHONE_NUMBER_ID
          )
            continue;
          for (const s of change.value?.statuses ?? []) {
            const state =
              s.status === "delivered" || s.status === "read"
                ? "DELIVERED"
                : s.status === "failed"
                  ? "FAILED"
                  : s.status === "sent"
                    ? "ACCEPTED"
                    : null;
            if (state)
              await recordDeliveryEvent(
                `meta:${s.id}:${s.status}:${s.timestamp}`,
                s.id,
                state,
              );
          }
          for (const m of change.value?.messages ?? [])
            if (
              ["STOP", "UNSUBSCRIBE", "CANCEL"].includes(
                String(m.text?.body ?? "")
                  .trim()
                  .toUpperCase(),
              )
            ) {
              const customers = await db.customer.findMany({
                where: { mobile: "+" + m.from },
              });
              for (const c of customers)
                await optOut(c.id, "Verified WhatsApp STOP message");
            }
        }
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }
  } else return new Response("Invalid provider", { status: 400 });
  return NextResponse.json({ received: true });
}
