import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sameOrigin, tokenHash } from "@/lib/auth";
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const token = (await cookies()).get("protune_session")?.value;
  if (token)
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  const res = NextResponse.redirect(new URL("/", process.env.APP_ORIGIN!), 303);
  res.cookies.delete("protune_session");
  return res;
}
