export const dynamic = "force-dynamic";
export default async function Unsubscribe({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PROTUNE AUTO SERVICES</span>
        <h1>Stop marketing messages</h1>
        <p>Confirm to stop email and WhatsApp marketing for your profile.</p>
        <form method="post" action="/api/marketing/optout">
          <input type="hidden" name="token" value={token} />
          <button>Unsubscribe</button>
        </form>
      </section>
    </main>
  );
}
