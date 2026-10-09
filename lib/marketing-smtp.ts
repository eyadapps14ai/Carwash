import nodemailer from "nodemailer";
export async function sendSMTP(
  delivery: {
    id: string;
    destination: string;
    body: string;
    unsubscribeToken: string;
    voucher: { campaign: { name: string } };
  },
  sender: string,
  createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
) {
  const port = Number(process.env.SMTP_PORT ?? "587");
  if (
    ![465, 587].includes(port) ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER
  )
    return { status: "FAILED", reason: "SMTP configuration invalid" };
  const auth = process.env.SMTP_ACCESS_TOKEN
    ? {
        type: "OAuth2" as const,
        user: process.env.SMTP_USER,
        accessToken: process.env.SMTP_ACCESS_TOKEN,
      }
    : { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
  const transport = createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  try {
    const origin = process.env.PUBLIC_APP_ORIGIN!,
      domain = new URL(origin).hostname;
    const result = await transport.sendMail({
      from: sender,
      to: delivery.destination,
      subject: delivery.voucher.campaign.name,
      text: delivery.body,
      messageId: `<protune-${delivery.id}@${domain}>`,
      list: {
        unsubscribe: {
          url: `${origin}/unsubscribe/${delivery.unsubscribeToken}`,
        },
      },
    });
    if (result.accepted?.length)
      return { status: "ACCEPTED", reason: "", providerId: result.messageId };
    return { status: "FAILED", reason: "SMTP server rejected the recipient" };
  } catch (e) {
    const code = (e as { responseCode?: number }).responseCode;
    return {
      status: code && code >= 400 && code < 600 ? "FAILED" : "UNKNOWN",
      reason: code
        ? `SMTP rejection (${code})`
        : "SMTP acceptance uncertain; verify provider logs before retry",
    };
  } finally {
    transport.close();
  }
}
