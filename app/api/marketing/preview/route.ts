import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser, sameOrigin, canBranch } from "@/lib/auth";
import { voucherDiscount } from "@/lib/marketing";
import { snapshotService } from "@/lib/operations-actions";
import { dubaiDate } from "@/lib/finance";
import { boundedJSON, safeError, RequestError } from "@/lib/request-security";
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const u = await currentUser();
  if (!u || u.role === "TECHNICIAN")
    return new Response("Forbidden", { status: 403 });
  try {
    const v = z
      .object({
        code: z.string().trim().toUpperCase().min(1).max(80),
        customerId: z.string().min(1),
        branchId: z.string().min(1),
        serviceIds: z.array(z.string()).min(1).max(30),
      })
      .parse(await boundedJSON(req, 8192));
    if (!canBranch(u, v.branchId))
      return new Response("Forbidden", { status: 403 });
    const result = await db.$transaction(async (tx) => {
      if (
        !(await tx.settings.findUniqueOrThrow({ where: { id: "company" } }))
          .crmEnabled
      )
        throw new Error("Customer management is disabled");
      if (
        !(await tx.customer.findFirst({
          where: {
            id: v.customerId,
            active: true,
            branches: { some: { branchId: v.branchId } },
          },
        }))
      )
        throw new Error("Customer unavailable");
      const voucher = await tx.voucher.findUnique({
          where: { code: v.code },
          include: { campaign: true },
        }),
        c =
          voucher?.campaign ??
          (await tx.campaign.findUnique({ where: { code: v.code } }));
      if (
        !c ||
        !c.active ||
        dubaiDate() < c.startDate ||
        dubaiDate() > c.endDate ||
        (!voucher && c.kind !== "PROMOTION")
      )
        throw new Error("Invalid or inactive code");
      if (
        voucher &&
        (voucher.customerId !== v.customerId ||
          voucher.status !== "ISSUED" ||
          voucher.expiresAt <= new Date())
      )
        throw new Error("Voucher is unavailable for this customer");
      if (
        (await tx.voucherRedemption.count({
          where: {
            voucher: { campaignId: c.id, customerId: v.customerId },
            voidedAt: null,
          },
        })) >= c.maxPerCustomer
      )
        throw new Error("Customer usage limit reached");
      const rules = voucher?.rules ?? {
        branchIds: c.branchIds,
        serviceIds: c.serviceIds,
        discountKind: c.discountKind,
        discountValue: c.discountValue.toString(),
        minimumSpend: c.minimumSpend.toString(),
        campaignName: c.name,
      };
      const lines = [];
      for (const serviceId of v.serviceIds)
        lines.push(await snapshotService(tx, v.branchId, serviceId));
      return {
        discount: voucherDiscount(
          rules as any,
          v.branchId,
          lines.map((l) => ({ serviceId: l.serviceId, price: l.price })),
        ).toFixed(2),
        name: c.name,
      };
    });
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Select customer and services first"
            : e instanceof Error
              ? safeError(e)
              : "Voucher unavailable",
      },
      { status: e instanceof RequestError ? e.status : 400 },
    );
  }
}
