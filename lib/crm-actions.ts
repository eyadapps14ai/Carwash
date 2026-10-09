import { Prisma } from "@prisma/client";
import { z } from "zod";
import { assertAccess, canBranch } from "./auth";
import { lockBranch, businessDate } from "./finance-actions";
import { normalizeMobile, plateKey } from "./crm";
type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: string; branches: { branchId: string }[] };
const id = z.string().min(1).max(100),
  text = z.string().trim().min(1).max(200),
  notes = z.string().trim().max(2000);
export async function requireCRM(tx: Tx) {
  await tx.$queryRaw`SELECT id FROM "Settings" WHERE id='company' FOR SHARE`;
  if (
    !(await tx.settings.findUniqueOrThrow({ where: { id: "company" } }))
      .crmEnabled
  )
    throw new Error("Customer management is disabled");
}
async function writableCustomer(tx: Tx, u: Actor, customerId: string) {
  const c = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { branches: true },
  });
  assertAccess(u, ["OWNER", "MANAGER"]);
  if (!c.branches.every((b) => canBranch(u, b.branchId)))
    throw new Error(
      "This shared profile requires the owner or a manager with access to all its branches",
    );
  for (const b of c.branches.map((b) => b.branchId).sort())
    await lockBranch(tx, b);
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId} FOR UPDATE`;
  const current = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { branches: true },
  });
  if (!current.branches.every((b) => canBranch(u, b.branchId)))
    throw new Error(
      "Shared profile permissions changed; refresh before editing",
    );
  return current;
}
async function audit(
  tx: Tx,
  u: Actor,
  action: string,
  entityId: string,
  branchIds: string[],
  detail: unknown,
) {
  for (const branchId of branchIds)
    await tx.audit.create({
      data: {
        userId: u.id,
        action,
        entityId,
        branchId,
        detail: JSON.parse(JSON.stringify(detail)),
      },
    });
}
export async function resolveCustomerSelection(
  tx: Tx,
  u: Actor,
  branchId: string,
  customerId?: string,
  vehicleId?: string,
): Promise<{
  customerId?: string;
  vehicleId?: string | null;
  customerName?: string;
  customerPhone?: string;
  plate?: string;
  vehicle?: string;
}> {
  if (!customerId && !vehicleId) return {};
  await requireCRM(tx);
  assertAccess(u, ["OWNER", "MANAGER", "CASHIER"], branchId);
  if (!customerId) throw new Error("Select the vehicle owner");
  const c = await tx.customer.findFirst({
    where: { id: customerId, active: true, branches: { some: { branchId } } },
  });
  if (!c) throw new Error("Customer is unavailable at this branch");
  const v = vehicleId
    ? await tx.vehicle.findFirst({
        where: { id: vehicleId, customerId: c.id, active: true },
      })
    : null;
  if (vehicleId && !v)
    throw new Error("Vehicle does not belong to this customer or is inactive");
  return {
    customerId: c.id,
    vehicleId: v?.id ?? null,
    customerName: c.name,
    customerPhone: c.mobile,
    ...(v
      ? {
          plate: v.plate,
          vehicle: [v.make, v.model, v.year].filter(Boolean).join(" "),
        }
      : {}),
  };
}
export async function crmAction(
  tx: Tx,
  u: Actor,
  action: string,
  input: unknown,
): Promise<string | undefined> {
  if (action === "crmSettings") {
    assertAccess(u, ["OWNER"]);
    const v = z.object({ crmEnabled: z.boolean() }).parse(input);
    await tx.settings.update({ where: { id: "company" }, data: v });
    await audit(tx, u, action, "company", [], v);
    await tx.audit.create({
      data: { userId: u.id, action, entityId: "company", detail: v },
    });
    return "company";
  }
  if (
    ![
      "customer",
      "vehicle",
      "customerConsent",
      "customerBranches",
      "recommendation",
      "linkCustomer",
    ].includes(action)
  )
    return undefined;
  await requireCRM(tx);
  if (action === "customer") {
    const v = z
      .object({
        id: id.optional(),
        branchId: id,
        requestKey: z.string().uuid(),
        name: text,
        mobile: z.string().max(50),
        email: z.union([z.literal(""), z.string().email().max(200)]),
        preferredChannel: z.enum(["NONE", "EMAIL", "WHATSAPP", "PHONE"]),
        notes,
        active: z.boolean(),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER", "CASHIER"], v.branchId);
    if (!v.id) await lockBranch(tx, v.branchId);
    if (
      !(await tx.branch.findUniqueOrThrow({ where: { id: v.branchId } })).active
    )
      throw new Error("Branch inactive");
    const mobileKey = normalizeMobile(v.mobile);
    const profile = {
      name: v.name,
      mobile: mobileKey ?? "",
      mobileKey,
      email: v.email.trim().toLowerCase(),
      preferredChannel: v.preferredChannel,
      notes: v.notes,
      active: v.active,
    };
    if (v.id) {
      const c = await writableCustomer(tx, u, v.id);
      if (!c.branches.some((b) => b.branchId === v.branchId))
        throw new Error("Customer is unavailable at this branch");
      const emailPermission = c.consentEmail && c.email === profile.email;
      const whatsAppPermission =
        c.consentWhatsApp && c.mobile === profile.mobile;
      const optOut =
        c.marketingOptOut || (!emailPermission && !whatsAppPermission);
      await tx.customer.update({
        where: { id: c.id },
        data: {
          ...profile,
          consentEmail: emailPermission,
          consentWhatsApp: whatsAppPermission,
          marketingOptOut: optOut,
          ...(c.email !== profile.email || c.mobile !== profile.mobile
            ? {
                consentEvents: {
                  create: {
                    email: emailPermission,
                    whatsApp: whatsAppPermission,
                    optOut,
                    evidence:
                      "Contact changed; previous permission does not apply to a new address or number",
                    recordedBy: u.id,
                  },
                },
              }
            : {}),
        },
      });
      await tx.customerBranch.updateMany({
        where: { customerId: c.id },
        data: { mobileKey },
      });
      await audit(
        tx,
        u,
        action,
        c.id,
        c.branches.map((b) => b.branchId),
        {
          fields: [
            "name",
            "mobile",
            "email",
            "preferredChannel",
            "notes",
            "active",
          ],
        },
      );
      return c.id;
    }
    if (u.role === "CASHIER" && (v.notes || !v.active))
      throw new Error(
        "Only management can enter internal notes or deactivate profiles",
      );
    const old = await tx.customer.findUnique({
      where: { requestKey: v.requestKey },
      include: { branches: true },
    });
    if (old) {
      if (!old.branches.some((b) => b.branchId === v.branchId))
        throw new Error("Request key already used");
      return old.id;
    }
    const c = await tx.customer.create({
      data: {
        ...profile,
        requestKey: v.requestKey,
        branches: { create: { branchId: v.branchId, mobileKey } },
      },
    });
    await audit(tx, u, action, c.id, [v.branchId], { created: true });
    return c.id;
  }
  if (action === "customerBranches") {
    assertAccess(u, ["OWNER"]);
    const v = z
      .object({ id, branchIds: z.array(id).min(1).max(100) })
      .parse(input);
    const branches = [...new Set(v.branchIds)].sort();
    const initial = await tx.customer.findUniqueOrThrow({
      where: { id: v.id },
      include: { branches: true },
    });
    for (const b of [
      ...new Set([...branches, ...initial.branches.map((b) => b.branchId)]),
    ].sort())
      await lockBranch(tx, b);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${v.id} FOR UPDATE`;
    if (
      (await tx.branch.count({
        where: { id: { in: branches }, active: true },
      })) !== branches.length
    )
      throw new Error("Select valid active branches");
    const c = await tx.customer.findUniqueOrThrow({
      where: { id: v.id },
      include: { branches: true, vehicles: { where: { active: true } } },
    });
    if (
      await tx.vehicle.count({
        where: {
          active: true,
          plateKey: { in: c.vehicles.map((vehicle) => vehicle.plateKey) },
          customerId: { not: c.id },
          customer: { branches: { some: { branchId: { in: branches } } } },
        },
      })
    )
      throw new Error("An active vehicle plate conflicts in a selected branch");
    const removed = c.branches.filter((b) => !branches.includes(b.branchId));
    for (const b of removed) {
      if (
        (await tx.sale.count({
          where: { customerId: c.id, branchId: b.branchId },
        })) ||
        (await tx.jobCard.count({
          where: { customerId: c.id, branchId: b.branchId },
        })) ||
        (await tx.recommendation.count({
          where: { customerId: c.id, branchId: b.branchId },
        })) ||
        (await tx.voucher.count({
          where: { customerId: c.id, branchId: b.branchId },
        })) ||
        (await tx.referral.count({
          where: {
            branchId: b.branchId,
            OR: [{ referrerId: c.id }, { referredId: c.id }],
          },
        }))
      )
        throw new Error("Branches with linked history cannot be removed");
    }
    await tx.customerBranch.deleteMany({
      where: { customerId: c.id, branchId: { notIn: branches } },
    });
    for (const branchId of branches)
      await tx.customerBranch.upsert({
        where: { customerId_branchId: { customerId: c.id, branchId } },
        create: { customerId: c.id, branchId, mobileKey: c.mobileKey },
        update: {},
      });
    await audit(
      tx,
      u,
      action,
      c.id,
      [...new Set([...branches, ...removed.map((b) => b.branchId)])],
      { branchIds: branches },
    );
    return c.id;
  }
  if (action === "vehicle") {
    const v = z
      .object({
        id: id.optional(),
        customerId: id,
        plate: text,
        make: z.string().trim().max(100),
        model: z.string().trim().max(100),
        year: z
          .number()
          .int()
          .min(1900)
          .max(new Date().getFullYear() + 1)
          .nullable(),
        category: text,
        active: z.boolean(),
      })
      .parse(input);
    const c = await writableCustomer(tx, u, v.customerId);
    const key = plateKey(v.plate);
    if (!key) throw new Error("Vehicle plate is required");
    const clash = await tx.vehicle.findFirst({
      where: {
        id: { not: v.id ?? "" },
        plateKey: key,
        active: true,
        customer: {
          branches: {
            some: { branchId: { in: c.branches.map((b) => b.branchId) } },
          },
        },
      },
    });
    if (v.active && clash)
      throw new Error(
        "An active vehicle with this plate already exists in an assigned branch; use its existing profile",
      );
    const { id: vehicleId, ...profile } = v;
    const value = {
      ...profile,
      plate: v.plate.trim().toUpperCase(),
      plateKey: key,
    };
    if (vehicleId) {
      const old = await tx.vehicle.findUniqueOrThrow({
        where: { id: vehicleId },
      });
      if (old.customerId !== c.id)
        throw new Error(
          "Vehicle ownership cannot be changed; archive it and create the new ownership record",
        );
      await tx.vehicle.update({ where: { id: vehicleId }, data: value });
    } else {
      const veh = await tx.vehicle.create({ data: value });
      await audit(
        tx,
        u,
        action,
        veh.id,
        c.branches.map((b) => b.branchId),
        { customerId: c.id },
      );
      return veh.id;
    }
    await audit(
      tx,
      u,
      action,
      vehicleId!,
      c.branches.map((b) => b.branchId),
      { customerId: c.id },
    );
    return vehicleId!;
  }
  if (action === "customerConsent") {
    const v = z
      .object({
        id,
        email: z.boolean(),
        whatsApp: z.boolean(),
        optOut: z.boolean(),
        evidence: z.string().trim().min(1).max(1000),
      })
      .parse(input);
    const c = await writableCustomer(tx, u, v.id);
    if (!c.active && !v.optOut)
      throw new Error("Inactive customers cannot opt into marketing");
    if (v.optOut && (v.email || v.whatsApp))
      throw new Error("Opt-out requires both channel permissions to be off");
    if ((v.email && !c.email) || (v.whatsApp && !c.mobile))
      throw new Error("Add the channel contact before recording consent");
    await tx.customer.update({
      where: { id: c.id },
      data: {
        consentEmail: v.email,
        consentWhatsApp: v.whatsApp,
        marketingOptOut: v.optOut,
        consentEvents: {
          create: {
            email: v.email,
            whatsApp: v.whatsApp,
            optOut: v.optOut,
            evidence: v.evidence,
            recordedBy: u.id,
          },
        },
      },
    });
    await audit(
      tx,
      u,
      action,
      c.id,
      c.branches.map((b) => b.branchId),
      { email: v.email, whatsApp: v.whatsApp, optOut: v.optOut },
    );
    return c.id;
  }
  if (action === "recommendation") {
    const v = z
      .object({
        id: id.optional(),
        customerId: id,
        vehicleId: id.nullable(),
        branchId: id,
        title: text,
        notes,
        dueDate: businessDate,
        status: z.enum(["OPEN", "DONE", "CANCELLED"]),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER"], v.branchId);
    await lockBranch(tx, v.branchId);
    const customer = await tx.customer.findFirst({
      where: {
        id: v.customerId,
        active: true,
        branches: { some: { branchId: v.branchId } },
      },
    });
    if (!customer) throw new Error("Customer unavailable at branch");
    if (
      v.vehicleId &&
      !(await tx.vehicle.findFirst({
        where: { id: v.vehicleId, customerId: v.customerId },
      }))
    )
      throw new Error("Vehicle belongs to another customer");
    const { id: recommendationId, ...data } = v;
    const value = { ...data, dueDate: new Date(v.dueDate + "T12:00:00+04:00") };
    if (recommendationId) {
      const old = await tx.recommendation.findUniqueOrThrow({
        where: { id: recommendationId },
      });
      if (old.branchId !== v.branchId || old.customerId !== v.customerId)
        throw new Error("Recommendation branch and customer cannot be changed");
      await tx.recommendation.update({
        where: { id: recommendationId },
        data: value,
      });
      await audit(tx, u, action, recommendationId, [v.branchId], {
        status: v.status,
      });
      return recommendationId;
    }
    const r = await tx.recommendation.create({
      data: { ...value, createdBy: u.id },
    });
    await audit(tx, u, action, r.id, [v.branchId], {
      customerId: v.customerId,
    });
    return r.id;
  }
  if (action === "linkCustomer") {
    const v = z
      .object({
        id,
        type: z.enum(["SALE", "JOB"]),
        customerId: id,
        vehicleId: id.nullable(),
      })
      .parse(input);
    assertAccess(u, ["OWNER", "MANAGER"]);
    if (v.type === "SALE")
      await tx.$queryRaw`SELECT id FROM "Sale" WHERE id=${v.id} FOR UPDATE`;
    else
      await tx.$queryRaw`SELECT id FROM "JobCard" WHERE id=${v.id} FOR UPDATE`;
    const record =
      v.type === "SALE"
        ? await tx.sale.findUniqueOrThrow({ where: { id: v.id } })
        : await tx.jobCard.findUniqueOrThrow({ where: { id: v.id } });
    assertAccess(u, ["OWNER", "MANAGER"], record.branchId);
    await lockBranch(tx, record.branchId);
    const selection = await resolveCustomerSelection(
      tx,
      u,
      record.branchId,
      v.customerId,
      v.vehicleId ?? undefined,
    );
    if (record.customerId && record.customerId !== v.customerId)
      throw new Error("Existing customer attribution cannot be replaced");
    if (record.vehicleId && record.vehicleId !== v.vehicleId)
      throw new Error("Existing vehicle attribution cannot be replaced");
    if (v.vehicleId) {
      const vehicle = await tx.vehicle.findUniqueOrThrow({
        where: { id: v.vehicleId },
      });
      if (plateKey(record.plate) !== vehicle.plateKey)
        throw new Error(
          "Selected vehicle plate does not match the historical record",
        );
    }
    if (v.type === "SALE")
      await tx.sale.update({
        where: { id: v.id },
        data: {
          customerId: selection.customerId,
          vehicleId: selection.vehicleId,
        },
      });
    else {
      await tx.jobCard.update({
        where: { id: v.id },
        data: {
          customerId: selection.customerId,
          vehicleId: selection.vehicleId,
        },
      });
      if ("saleId" in record && record.saleId) {
        const s = await tx.sale.findUniqueOrThrow({
          where: { id: record.saleId },
        });
        if (
          (s.customerId && s.customerId !== v.customerId) ||
          (s.vehicleId && s.vehicleId !== v.vehicleId)
        )
          throw new Error("Linked invoice attribution conflicts");
        await tx.sale.update({
          where: { id: s.id },
          data: {
            customerId: selection.customerId,
            vehicleId: selection.vehicleId,
          },
        });
      }
    }
    await audit(tx, u, action, v.id, [record.branchId], {
      customerId: v.customerId,
      vehicleId: v.vehicleId,
      type: v.type,
    });
    return v.id;
  }
  return undefined;
}
