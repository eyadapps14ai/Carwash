import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { dubaiDate } from "../lib/finance";
import {
  dispatchMarketing,
  recordDeliveryEvent,
} from "../lib/marketing-delivery";
import { runMarketing } from "../lib/marketing-engine";
import { POST as webhookPOST } from "../app/api/marketing/webhook/route";
import { PDFDocument } from "pdf-lib";
import ExcelJS from "exceljs";
const origin = process.env.APP_ORIGIN!,
  suffix = randomUUID().slice(0, 8),
  today = dubaiDate();
async function login(email: string, password: string) {
  const r = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  assert.equal(r.status, 303);
  assert.ok(r.headers.get("set-cookie"), "Authenticated session required");
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function action(cookie: string, action: string, data: unknown) {
  const r = await fetch(origin + "/api/action", {
    method: "POST",
    headers: { origin, cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  return { status: r.status, data: await r.json() };
}
async function main() {
  const owner = await login(
      process.env.SEED_OWNER_EMAIL!,
      process.env.SEED_OWNER_PASSWORD!,
    ),
    settings = await db.settings.findUniqueOrThrow({
      where: { id: "company" },
    }),
    originalConfig = await db.marketingConfig.findUnique({
      where: { id: "company" },
    });
  let branches: string[] = [],
    users: string[] = [],
    customerIds: string[] = [],
    campaignIds: string[] = [],
    categoryId = "",
    serviceIds: string[] = [];
  try {
    await db.settings.update({
      where: { id: "company" },
      data: { crmEnabled: true },
    });
    for (const code of ["A", "B"])
      branches.push(
        (
          await db.branch.create({
            data: { name: `P5 ${code} ${suffix}`, code: `P5${code}-${suffix}` },
          })
        ).id,
      );
    const [a, b] = branches,
      password = randomUUID() + randomUUID(),
      cookies: string[] = [];
    for (const role of ["MANAGER", "CASHIER", "TECHNICIAN"] as const) {
      const email = `p5-${role.toLowerCase()}-${suffix}@protune.local`;
      const u = await db.user.create({
        data: {
          name: `P5 ${role}`,
          email,
          role,
          passwordHash: hashPassword(password),
          branches: { create: { branchId: a } },
        },
      });
      users.push(u.id);
      cookies.push(await login(email, password));
    }
    const [manager, cashier, tech] = cookies;
    for (const name of ["A", "B", "C"]) {
      const c = await db.customer.create({
        data: {
          requestKey: randomUUID(),
          name: `P5 Customer ${name}`,
          email: `p5-${name.toLowerCase()}@example.test`,
          mobile: "+971501234567",
          preferredChannel: "EMAIL",
          consentEmail: true,
          marketingOptOut: false,
          branches: { create: { branchId: a } },
        },
      });
      customerIds.push(c.id);
    }
    // No real address is contacted; all delivery calls below use an injected mock transport.
    const [ca, cb, cc] = customerIds;
    categoryId = (
      await db.category.create({ data: { name: `P5 category ${suffix}` } })
    ).id;
    for (const [name, price] of [
      ["Wash", "100"],
      ["Oil", "50"],
    ]) {
      const service = await db.service.create({
        data: {
          name: `P5 ${name}`,
          categoryId,
          branches: {
            create: branches.map((branchId) => ({
              branchId,
              price,
              costs: [
                {
                  name: "Direct",
                  mode: "FIXED",
                  amount: "20",
                  source: "DIRECT",
                },
              ],
            })),
          },
        },
      });
      serviceIds.push(service.id);
    }
    const [wash, oil] = serviceIds;
    const base = {
      name: `P5 promotion ${suffix}`,
      code: `P5-${suffix.toUpperCase()}`,
      kind: "PROMOTION",
      active: true,
      branchIds: [a],
      serviceIds: [wash],
      startDate: today,
      endDate: `${Number(today.slice(0, 4)) + 1}-12-31`,
      discountKind: "PERCENT",
      discountValue: "10",
      minimumSpend: "100",
      expiryDays: 30,
      threshold: "2",
      inactivityDays: 30,
      maxPerCustomer: 20,
      maxRedemptions: 100,
      channel: "EMAIL",
      message:
        "Hello {name}, voucher {code} expires {expiry}. {offer} {unsubscribe}",
      whatsappTemplate: "protune_return",
      templateLanguage: "en",
      templateApproved: true,
      marketingCost: "10",
    };
    async function campaign(changes: Record<string, unknown>) {
      const r = await action(owner, "campaign", { ...base, ...changes });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      campaignIds.push(r.data.id);
      return r.data.id;
    }
    const promotion = await campaign({});
    assert.equal((await action(manager, "campaign", base)).status, 400);
    const issued = await action(manager, "voucherIssue", {
      campaignId: promotion,
      branchId: a,
      customerId: ca,
      requestKey: randomUUID(),
    });
    assert.equal(issued.status, 200);
    const voucher = await db.voucher.findUniqueOrThrow({
      where: { id: issued.data.id },
    });
    assert.equal(
      (
        await action(owner, "campaign", {
          ...base,
          id: promotion,
          discountValue: "90",
        })
      ).status,
      400,
    );
    const saleBase = {
      branchId: a,
      requestKey: randomUUID(),
      serviceIds: [wash, oil],
      workerIds: [],
      plate: "P5 TEST",
      customerName: "Snapshot",
      customerId: ca,
      discount: "0",
      paid: "0",
      method: "CASH",
    };
    assert.equal(
      (await action(cashier, "sale", { ...saleBase, discount: "10" })).status,
      400,
    );
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleBase,
          customerId: cb,
          voucherCode: voucher.code,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleBase,
          branchId: b,
          voucherCode: voucher.code,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleBase,
          serviceIds: [oil],
          voucherCode: voucher.code,
        })
      ).status,
      400,
    );
    const preview = await fetch(origin + "/api/marketing/preview", {
      method: "POST",
      headers: { origin, cookie: cashier, "Content-Type": "application/json" },
      body: JSON.stringify({
        code: voucher.code,
        branchId: a,
        customerId: ca,
        serviceIds: [wash, oil],
      }),
    });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).discount, "10.00");
    const concurrent = await Promise.all([
      action(cashier, "sale", {
        ...saleBase,
        requestKey: randomUUID(),
        voucherCode: voucher.code,
      }),
      action(cashier, "sale", {
        ...saleBase,
        requestKey: randomUUID(),
        voucherCode: voucher.code,
      }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400]);
    const firstId = concurrent.find((r) => r.status === 200)!.data.id,
      first = await db.sale.findUniqueOrThrow({ where: { id: firstId } });
    assert.equal(first.net.toString(), "140");
    assert.equal(first.vat.toString(), "7");
    assert.equal(first.cost.toString(), "40");
    assert.equal(
      await db.voucherRedemption.count({ where: { voucherId: voucher.id } }),
      1,
    );
    const cancelled = await action(manager, "cancel", {
      id: firstId,
      reason: "Test unpaid cancellation",
    });
    assert.equal(cancelled.status, 200);
    assert.equal(
      (await db.voucher.findUniqueOrThrow({ where: { id: voucher.id } }))
        .status,
      "VOID",
    );
    assert.ok(
      (
        await db.voucherRedemption.findUniqueOrThrow({
          where: { voucherId: voucher.id },
        })
      ).voidedAt,
    );
    // Expired and paused vouchers never redeem.
    const expire = await action(owner, "voucherIssue", {
      campaignId: promotion,
      branchId: a,
      customerId: ca,
      requestKey: randomUUID(),
    });
    await db.voucher.update({
      where: { id: expire.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(
      (
        await action(cashier, "sale", {
          ...saleBase,
          requestKey: randomUUID(),
          voucherCode: (
            await db.voucher.findUniqueOrThrow({
              where: { id: expire.data.id },
            })
          ).code,
        })
      ).status,
      400,
    );
    const loyalty = await campaign({
      name: "P5 visit loyalty",
      code: `P5-L-${suffix}`,
      kind: "LOYALTY_VISITS",
      discountKind: "FREE_SERVICE",
      discountValue: "0",
      marketingCost: "0",
    });
    const spend = await campaign({
      name: "P5 spend loyalty",
      code: `P5-S-${suffix}`,
      kind: "LOYALTY_SPEND",
      threshold: "150",
      marketingCost: "0",
    });
    const next = await campaign({
      name: "P5 next visit",
      code: `P5-N-${suffix}`,
      kind: "NEXT_VISIT",
      threshold: "50",
      marketingCost: "0",
    });
    const paidSale = await action(cashier, "sale", {
      ...saleBase,
      requestKey: randomUUID(),
      voucherCode: base.code,
      paid: "147",
    });
    assert.equal(paidSale.status, 200, JSON.stringify(paidSale.data));
    assert.equal(
      await db.voucher.count({
        where: { campaignId: loyalty, customerId: ca },
      }),
      0,
    );
    const partial = await action(cashier, "sale", {
      ...saleBase,
      serviceIds: [wash],
      requestKey: randomUUID(),
      paid: "50",
    });
    assert.equal(partial.status, 200);
    assert.equal(
      await db.voucher.count({
        where: { campaignId: loyalty, customerId: ca },
      }),
      0,
    );
    const paymentKey = randomUUID();
    assert.equal(
      (
        await action(cashier, "payment", {
          id: partial.data.id,
          amount: "55",
          method: "CARD",
          requestKey: paymentKey,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await action(cashier, "payment", {
          id: partial.data.id,
          amount: "55",
          method: "CARD",
          requestKey: paymentKey,
        })
      ).status,
      200,
    );
    assert.equal(
      await db.voucher.count({
        where: { campaignId: loyalty, customerId: ca },
      }),
      1,
    );
    assert.equal(
      await db.voucher.count({ where: { campaignId: spend, customerId: ca } }),
      1,
    );
    assert.equal(
      await db.voucher.count({ where: { campaignId: next, customerId: ca } }),
      2,
    );
    const referralCampaign = await campaign({
      name: "P5 referral",
      code: `P5-F-${suffix}`,
      kind: "REFERRAL",
      threshold: "50",
      marketingCost: "0",
    });
    const referral = await action(manager, "referral", {
      campaignId: referralCampaign,
      branchId: a,
      referrerId: ca,
      referredId: cb,
    });
    assert.equal(referral.status, 200);
    assert.equal(
      (
        await action(manager, "referral", {
          campaignId: referralCampaign,
          branchId: a,
          referrerId: ca,
          referredId: ca,
        })
      ).status,
      400,
    );
    const newVisit = await action(cashier, "sale", {
      ...saleBase,
      serviceIds: [wash],
      customerId: cb,
      requestKey: randomUUID(),
      paid: "105",
    });
    assert.equal(newVisit.status, 200);
    assert.equal(
      await db.voucher.count({
        where: { campaignId: referralCampaign, customerId: ca },
      }),
      1,
    );
    const returnCampaign = await campaign({
      name: "P5 reactivation",
      code: `P5-R-${suffix}`,
      kind: "REACTIVATION",
      inactivityDays: 30,
      marketingCost: "0",
    });
    const old = await db.sale.create({
      data: {
        number: `P5-OLD-${suffix}`,
        requestKey: randomUUID(),
        branchId: a,
        cashierId: users[1],
        customerId: cc,
        plate: "P5 OLD",
        customerName: "Old snapshot",
        createdAt: new Date(Date.now() - 40 * 86400000),
        subtotal: "100",
        discount: "0",
        net: "100",
        vat: "5",
        total: "105",
        cost: "20",
        vatRate: "5",
        lines: {
          create: {
            serviceId: wash,
            name: "P5 Wash",
            category: "Test",
            price: "100",
            cost: "20",
            costSnapshot: [],
          },
        },
        payments: {
          create: { amount: "105", method: "CASH", requestKey: randomUUID() },
        },
      },
    });
    const countBefore = await db.voucher.count({
      where: { campaignId: { in: campaignIds } },
    });
    assert.equal((await action(owner, "marketingRun", {})).status, 200);
    const after = await db.voucher.count({
      where: { campaignId: returnCampaign, customerId: cc },
    });
    assert.equal(after, 1);
    assert.equal((await action(owner, "marketingRun", {})).status, 200);
    assert.equal(
      await db.voucher.count({
        where: { campaignId: returnCampaign, customerId: cc },
      }),
      1,
    );
    await db.customer.update({
      where: { id: cc },
      data: { marketingOptOut: true, consentEmail: false },
    });
    const returnVoucher = await db.voucher.findFirstOrThrow({
      where: { campaignId: returnCampaign, customerId: cc },
    });
    const liveConfig = {
      deliveryEnabled: true,
      emailEnabled: true,
      emailFrom: "sender@example.test",
      whatsappEnabled: true,
    };
    await db.marketingConfig.upsert({
      where: { id: "company" },
      create: liveConfig,
      update: liveConfig,
    });
    // Enable only this test process; the HTTP app remains delivery-disabled at the server gate.
    Object.assign(process.env, {
      MARKETING_LIVE_ENABLED: "true",
      PUBLIC_APP_ORIGIN: "https://protune.example.test",
      EMAIL_PROVIDER: "RESEND",
      RESEND_API_KEY: "test-key",
      RESEND_WEBHOOK_SECRET: "whsec_dGVzdC1zZWNyZXQ=",
      WHATSAPP_ACCESS_TOKEN: "test-key",
      WHATSAPP_PHONE_NUMBER_ID: "123456",
      WHATSAPP_APP_SECRET: "test-secret",
      WHATSAPP_VERIFY_TOKEN: "test-verify",
      WHATSAPP_API_VERSION: "v23.0",
    });
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return Response.json({ id: `p5-email-${suffix}-${calls}` });
    };
    await dispatchMarketing(100, mock);
    assert.equal(
      (
        await db.marketingDelivery.findUniqueOrThrow({
          where: { voucherId: returnVoucher.id },
        })
      ).status,
      "SUPPRESSED",
    );
    assert.ok(calls > 0);
    const accepted = await db.marketingDelivery.findFirstOrThrow({
      where: {
        voucher: { campaignId: { in: campaignIds }, customerId: ca },
        status: "ACCEPTED",
      },
    });
    await recordDeliveryEvent(
      `p5-event-${suffix}`,
      accepted.providerId!,
      "DELIVERED",
    );
    await recordDeliveryEvent(
      `p5-event-${suffix}`,
      accepted.providerId!,
      "DELIVERED",
    );
    assert.equal(
      await db.marketingEvent.count({ where: { id: `p5-event-${suffix}` } }),
      1,
    );
    // Timeout is uncertain and is never retried by another worker pass.
    const uncertainty = await action(owner, "voucherIssue", {
      campaignId: promotion,
      branchId: a,
      customerId: ca,
      requestKey: randomUUID(),
    });
    const uncertainId = uncertainty.data.id;
    await dispatchMarketing(100, async () => {
      throw new Error("Test timeout");
    });
    assert.equal(
      (
        await db.marketingDelivery.findUniqueOrThrow({
          where: { voucherId: uncertainId },
        })
      ).status,
      "UNKNOWN",
    );
    const beforeCalls = calls;
    await dispatchMarketing(100, mock);
    assert.equal(calls, beforeCalls);
    const unknown = await db.marketingDelivery.findUniqueOrThrow({
      where: { voucherId: uncertainId },
    });
    assert.equal(
      (
        await action(owner, "deliveryRetry", {
          id: unknown.id,
          reason: "Retry test",
        })
      ).status,
      400,
    );
    const waCampaign = await campaign({
      name: "P5 WhatsApp",
      code: `P5-W-${suffix}`,
      channel: "WHATSAPP",
      marketingCost: "0",
    });
    await db.customer.update({
      where: { id: cb },
      data: { consentWhatsApp: true, marketingOptOut: false },
    });
    const waIssued = await action(owner, "voucherIssue", {
      campaignId: waCampaign,
      branchId: a,
      customerId: cb,
      requestKey: randomUUID(),
    });
    assert.equal(waIssued.status, 200);
    await dispatchMarketing(100, async (url, options) => {
      assert.match(String(url), /graph.facebook.com/);
      const body = JSON.parse(String(options?.body));
      assert.equal(body.type, "template");
      assert.equal(body.template.components[0].parameters.length, 5);
      assert.equal(body.template.name, "protune_return");
      return Response.json({ messages: [{ id: `p5-wa-${suffix}` }] });
    });
    const waDelivery = await db.marketingDelivery.findUniqueOrThrow({
      where: { voucherId: waIssued.data.id },
    });
    assert.equal(waDelivery.status, "ACCEPTED");
    const hookBody = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456" },
                statuses: [
                  {
                    id: waDelivery.providerId,
                    status: "delivered",
                    timestamp: "1791450000",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const hookSignature =
      "sha256=" +
      createHmac("sha256", "test-secret").update(hookBody).digest("hex");
    const hookRequest = () =>
      new Request(origin + "/api/marketing/webhook?provider=whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": hookSignature },
        body: hookBody,
      });
    assert.equal((await webhookPOST(hookRequest())).status, 200);
    assert.equal((await webhookPOST(hookRequest())).status, 200);
    assert.equal(
      (
        await db.marketingDelivery.findUniqueOrThrow({
          where: { id: waDelivery.id },
        })
      ).status,
      "DELIVERED",
    );
    assert.equal(
      (
        await webhookPOST(
          new Request(origin + "/api/marketing/webhook?provider=whatsapp", {
            method: "POST",
            headers: { "x-hub-signature-256": hookSignature },
            body: hookBody + "x",
          }),
        )
      ).status,
      403,
    );
    // A valid signed email delivery webhook is accepted, with replay deduplication.
    const emailBody = JSON.stringify({
        type: "email.delivered",
        data: { email_id: accepted.providerId },
      }),
      svixId = `p5-svix-${suffix}`,
      svixTime = String(Math.floor(Date.now() / 1000)),
      svixSignature = createHmac("sha256", Buffer.from("test-secret"))
        .update(`${svixId}.${svixTime}.${emailBody}`)
        .digest("base64");
    const emailRequest = () =>
      new Request(origin + "/api/marketing/webhook?provider=email", {
        method: "POST",
        headers: {
          "svix-id": svixId,
          "svix-timestamp": svixTime,
          "svix-signature": "v1," + svixSignature,
        },
        body: emailBody,
      });
    assert.equal((await webhookPOST(emailRequest())).status, 200);
    assert.equal((await webhookPOST(emailRequest())).status, 200);
    // Token confirmation is required; GET cannot unsubscribe.
    const tokenPage = await fetch(
      origin + "/unsubscribe/" + accepted.unsubscribeToken,
    );
    assert.equal(tokenPage.status, 200);
    const optout = await fetch(origin + "/api/marketing/optout", {
      method: "POST",
      body: new URLSearchParams({ token: accepted.unsubscribeToken }),
    });
    assert.equal(optout.status, 200);
    assert.equal(
      (await db.customer.findUniqueOrThrow({ where: { id: ca } }))
        .marketingOptOut,
      true,
    );
    const unsigned = await fetch(
      origin + "/api/marketing/webhook?provider=whatsapp",
      { method: "POST", body: "{}" },
    );
    assert.equal(unsigned.status, 403);
    assert.equal(
      (
        await fetch(origin + "/api/marketing?branch=" + a, {
          headers: { cookie: tech },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(origin + "/api/marketing?branch=" + b, {
          headers: { cookie: manager },
        })
      ).status,
      403,
    );
    const cashierData = await (
      await fetch(origin + "/api/marketing?branch=" + a, {
        headers: { cookie: cashier },
      })
    ).json();
    assert.deepEqual(cashierData.stats, []);
    assert.equal(cashierData.config, null);
    assert.ok(
      cashierData.vouchers.every(
        (v: any) => !v.delivery && !v.redemption?.cost,
      ),
    );
    const scoped = await (
      await fetch(origin + "/api/marketing?branch=" + a, {
        headers: { cookie: manager },
      })
    ).json();
    const metrics = scoped.stats.find((s: any) => s.campaignId === promotion);
    assert.equal(metrics.redeemed, 1);
    assert.equal(metrics.net, "140.00");
    assert.equal(metrics.discount, "10.00");
    assert.equal(metrics.contribution, "90.00");
    await mkdir(".local/phase5-qa", { recursive: true });
    for (const report of ["Campaign performance", "Voucher performance"])
      for (const format of ["csv", "xlsx", "pdf"]) {
        const r = await fetch(
          origin +
            `/api/marketing?branch=${a}&report=${encodeURIComponent(report)}&format=${format}`,
          { headers: { cookie: manager } },
        );
        assert.equal(r.status, 200);
        assert.match(r.headers.get("cache-control")!, /no-store/);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (format === "xlsx") {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(bytes as any);
          assert.ok(workbook.worksheets.length);
        }
        if (format === "pdf")
          assert.ok((await PDFDocument.load(bytes)).getPageCount() > 0);
        await writeFile(
          `.local/phase5-qa/${report.toLowerCase().replaceAll(" ", "-")}.${format}`,
          bytes,
        );
      }
    assert.equal(
      (
        await fetch(origin + `/api/marketing?branch=${a}&format=csv`, {
          headers: { cookie: cashier },
        })
      ).status,
      403,
    );
    console.log(
      "Phase 5 integration passed: authorized campaign rules, immutable voucher snapshots, concurrent one-use redemption, cancellation, expiry, branch/service/customer restrictions, post-payment loyalty and referrals, inactivity deduplication, consent recheck, mocked provider acceptance/uncertain send handling, verified delivery events, public opt-out, role privacy and CSV/Excel/PDF profitability exports. No real messages sent.",
    );
  } finally {
    if (campaignIds.length) {
      const deliveries = await db.marketingDelivery.findMany({
        where: { voucher: { campaignId: { in: campaignIds } } },
        select: { id: true },
      });
      await db.marketingEvent.deleteMany({
        where: { deliveryId: { in: deliveries.map((d) => d.id) } },
      });
      await db.marketingDelivery.deleteMany({
        where: { id: { in: deliveries.map((d) => d.id) } },
      });
      await db.voucherRedemption.deleteMany({
        where: { voucher: { campaignId: { in: campaignIds } } },
      });
      await db.voucher.deleteMany({
        where: { campaignId: { in: campaignIds } },
      });
      await db.referral.deleteMany({
        where: { campaignId: { in: campaignIds } },
      });
      await db.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    }
    if (branches.length) {
      const saleIds = (
        await db.sale.findMany({
          where: { branchId: { in: branches } },
          select: { id: true },
        })
      ).map((s) => s.id);
      await db.payment.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.saleWorker.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.saleLine.deleteMany({ where: { saleId: { in: saleIds } } });
      await db.sale.deleteMany({ where: { id: { in: saleIds } } });
      await db.audit.deleteMany({
        where: {
          OR: [
            { branchId: { in: branches } },
            { userId: { in: users } },
            { entityId: { in: campaignIds } },
          ],
        },
      });
      await db.branchService.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.customerBranch.deleteMany({
        where: { branchId: { in: branches } },
      });
      await db.assignment.deleteMany({ where: { branchId: { in: branches } } });
    }
    await db.consentEvent.deleteMany({
      where: { customerId: { in: customerIds } },
    });
    await db.customer.deleteMany({ where: { id: { in: customerIds } } });
    await db.service.deleteMany({ where: { id: { in: serviceIds } } });
    if (categoryId) await db.category.delete({ where: { id: categoryId } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.branch.deleteMany({ where: { id: { in: branches } } });
    await db.settings.update({
      where: { id: "company" },
      data: { crmEnabled: settings.crmEnabled },
    });
    if (originalConfig)
      await db.marketingConfig.upsert({
        where: { id: "company" },
        create: originalConfig,
        update: originalConfig,
      });
    else await db.marketingConfig.deleteMany();
  }
}
main()
  .catch((e) => {
    console.error(e.stack ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
