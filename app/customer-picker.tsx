"use client";
import { useState, useEffect } from "react";
type Row = Record<string, any>;
export default function CustomerPicker({
  crm,
  branchId,
  onSelect,
}: {
  crm: Row;
  branchId: string;
  onSelect: (v: Row | null) => void;
}) {
  const [customerId, setCustomer] = useState(""),
    [vehicleId, setVehicle] = useState("");
  useEffect(() => {
    setCustomer("");
    setVehicle("");
    onSelect(null);
  }, [branchId, onSelect]);
  if (!crm?.enabled) return null;
  const customers = crm.customers.filter(
      (c: Row) =>
        c.active && c.branches.some((b: Row) => b.branchId === branchId),
    ),
    customer = customers.find((c: Row) => c.id === customerId);
  return (
    <div className="crm-picker">
      <label>
        Registered customer
        <select
          name="customerId"
          value={customerId}
          onChange={(e) => {
            const c = customers.find((c: Row) => c.id === e.target.value);
            setCustomer(e.target.value);
            setVehicle("");
            onSelect(c ? { customer: c } : null);
          }}
        >
          <option value="">Walk-in / no profile link</option>
          {customers.map((c: Row) => (
            <option value={c.id} key={c.id}>
              {c.name}
              {c.mobile ? ` · ${c.mobile}` : ""}
              {c.sample ? " · SAMPLE" : ""}
            </option>
          ))}
        </select>
      </label>
      {customer && (
        <label>
          Registered vehicle
          <select
            name="vehicleId"
            value={vehicleId}
            onChange={(e) => {
              setVehicle(e.target.value);
              onSelect({
                customer,
                vehicle: customer.vehicles.find(
                  (v: Row) => v.id === e.target.value,
                ),
              });
            }}
          >
            <option value="">Use manually entered vehicle plate</option>
            {customer.vehicles
              .filter((v: Row) => v.active)
              .map((v: Row) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.make} {v.model}
                </option>
              ))}
          </select>
        </label>
      )}
      <small>
        Linked visits appear in the customer and vehicle history. Walk-in
        checkout remains available.
      </small>
    </div>
  );
}
