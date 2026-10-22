"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function Confirm({
  trigger,
  title,
  body,
  action,
  onConfirm,
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  body: string;
  action: string;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl border-white/15 bg-[#0a0a0a] p-6 sm:max-w-sm" showCloseButton={false}>
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
          <DialogDescription className="text-white/60">{body}</DialogDescription>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setOpen(false)} className="h-12 rounded-2xl border border-white/15 font-semibold">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-black disabled:opacity-60"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {action}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
