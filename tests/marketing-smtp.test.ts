import test from "node:test";
import assert from "node:assert/strict";
import { sendSMTP } from "../lib/marketing-smtp";
test("SMTP uses verified TLS, a single recipient and a stable message ID; uncertain failures stay uncertain", async () => {
  const old = { ...process.env };
  Object.assign(process.env, {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "sender@example.test",
    SMTP_PASSWORD: "test-only",
    PUBLIC_APP_ORIGIN: "https://protune.example.test",
  });
  delete process.env.SMTP_ACCESS_TOKEN;
  let closed = 0;
  const d = {
    id: "test-delivery",
    destination: "customer@example.test",
    body: "Voucher test",
    unsubscribeToken: "a".repeat(64),
    voucher: { campaign: { name: "Test offer" } },
  };
  const factory = ((options: any) => {
    assert.equal(options.requireTLS, true);
    assert.equal(options.secure, false);
    assert.equal(options.logger, false);
    return {
      sendMail: async (msg: any) => {
        assert.equal(msg.to, d.destination);
        assert.equal(
          msg.messageId,
          "<protune-test-delivery@protune.example.test>",
        );
        assert.match(msg.list.unsubscribe.url, /unsubscribe/);
        return { accepted: [d.destination], messageId: msg.messageId };
      },
      close: () => closed++,
    };
  }) as any;
  try {
    const result = await sendSMTP(d, "sender@example.test", factory);
    assert.equal(result.status, "ACCEPTED");
    assert.equal(closed, 1);
    const timeout = await sendSMTP(d, "sender@example.test", (() => ({
      sendMail: async () => {
        throw new Error("Timeout");
      },
      close: () => {},
    })) as any);
    assert.equal(timeout.status, "UNKNOWN");
    const rejection = await sendSMTP(d, "sender@example.test", (() => ({
      sendMail: async () => {
        throw { responseCode: 550 };
      },
      close: () => {},
    })) as any);
    assert.equal(rejection.status, "FAILED");
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
  }
});
