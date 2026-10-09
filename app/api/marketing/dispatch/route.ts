import { currentUser, sameOrigin } from "@/lib/auth";
import { dispatchMarketing } from "@/lib/marketing-delivery";
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const u = await currentUser();
  if (u?.role !== "OWNER") return new Response("Forbidden", { status: 403 });
  return Response.json(
    { results: await dispatchMarketing() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
