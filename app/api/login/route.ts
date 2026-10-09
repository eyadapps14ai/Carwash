import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sameOrigin, tokenHash, verifyPasswordAsync } from "@/lib/auth";
import { boundedForm, RequestError } from "@/lib/request-security";
import { allowLogin, loginClient } from "@/lib/login-security";
export async function POST(req: Request) {
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const form = await boundedForm(req),
      email = String(form.get("email") || "")
        .toLowerCase()
        .trim(),
      password = String(form.get("password") || "");
    if (email.length > 254 || password.length > 256)
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 },
      );
    if (!(await allowLogin(email, loginClient(req))))
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429, headers: { "Retry-After": "900" } },
      );
    const user = await db.user.findUnique({ where: { email } });
    if (
      !user ||
      !user.active ||
      password.length > 256 ||
      !(await verifyPasswordAsync(password, user.passwordHash))
    )
      return NextResponse.redirect(
        new URL("/?error=Invalid+credentials", process.env.APP_ORIGIN!),
        303,
      );
    await db.loginAttempt.update({
      where: { key: tokenHash(email) },
      data: { count: 0 },
    });
    const token = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 28800000),
      },
    });
    const res = NextResponse.redirect(
      new URL("/", process.env.APP_ORIGIN!),
      303,
    );
    res.cookies.set("protune_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 28800,
      path: "/",
    });
    return res;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : "Sign-in temporarily unavailable",
      },
      { status: error instanceof RequestError ? error.status : 503 },
    );
  }
}
