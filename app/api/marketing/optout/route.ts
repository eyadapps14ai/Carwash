import { db } from "@/lib/db";
import { optOut } from "@/lib/marketing-optout";
import { boundedForm, RequestError } from "@/lib/request-security";
export async function POST(req: Request) {
  let form: URLSearchParams;
  try {
    form = await boundedForm(req, 4096);
  } catch (e) {
    return new Response("Invalid opt-out request", {
      status: e instanceof RequestError ? e.status : 400,
    });
  }
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{64}$/.test(token))
    return new Response("Invalid opt-out link", { status: 400 });
  const d = await db.marketingDelivery.findUnique({
    where: { unsubscribeToken: token },
    include: { voucher: true },
  });
  if (!d) return new Response("Invalid opt-out link", { status: 404 });
  await optOut(
    d.voucher.customerId,
    "Customer confirmed unsubscribe using private delivery link",
  );
  return new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribed — Protune</title><body style="font:18px system-ui;padding:48px"><h1>You are unsubscribed</h1><p>Marketing messages from Protune have been disabled for your profile.</p></body></html>',
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
