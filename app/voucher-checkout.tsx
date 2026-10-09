"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/finance";
export default function VoucherCheckout({
  branchId,
  customerId,
  serviceIds,
  onDiscount,
}: {
  branchId: string;
  customerId?: string;
  serviceIds: string[];
  onDiscount: (value: string) => void;
}) {
  const [code, setCode] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setMessage("");
    onDiscount("0");
  }, [branchId, customerId, JSON.stringify(serviceIds), code]);
  async function preview() {
    setBusy(true);
    setMessage("");
    onDiscount("0");
    try {
      const r = await fetch("/api/marketing/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, branchId, customerId, serviceIds }),
        }),
        v = await r.json();
      if (!r.ok) throw new Error(v.error);
      onDiscount(v.discount);
      setMessage(
        `${v.name}: ${money(v.discount)} discount. Eligibility is checked again when the sale is saved.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Voucher unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="voucher-checkout">
      <label>
        Voucher or promotion code
        <input
          name="voucherCode"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter code (optional)"
          maxLength={80}
        />
      </label>
      <button
        type="button"
        disabled={busy || !code || !customerId || !serviceIds.length}
        onClick={preview}
      >
        {busy ? "Checking…" : "Check voucher"}
      </button>
      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}
      <small>
        Select a registered customer. A voucher cannot be combined with a manual
        discount.
      </small>
    </div>
  );
}
