"use client";
import { useEffect } from "react";
export default function DialogAccessibility() {
  useEffect(() => {
    let dialog: HTMLElement | null = null,
      previous: HTMLElement | null = null;
    const focusable = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
            ),
          ).filter((e) => e.getClientRects().length)
        : [];
    const sync = () => {
      const next = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-modal="true"]',
      );
      if (next === dialog) return;
      if (!next) {
        if (previous?.isConnected) previous.focus();
        dialog = null;
        previous = null;
        return;
      }
      previous = document.activeElement as HTMLElement;
      dialog = next;
      requestAnimationFrame(() => focusable()[0]?.focus());
    };
    const key = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dialog
          .querySelector<HTMLButtonElement>('button[aria-label^="Close"]')
          ?.click();
      }
      if (event.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", key, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  return null;
}
