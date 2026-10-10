"use client";

/**
 * A sheet: Base UI's dialog drawn against an edge of the screen. It slides
 * in over 200 ms (none under reduced motion, which the stylesheet's switch
 * turns off), traps focus while open, and closes on Escape, a press outside
 * or its Close button. The page behind dims in ink, without blur.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

const sheetVariants = cva(
  "bg-background text-foreground border-rule fixed z-50 flex flex-col overflow-hidden shadow-[0_8px_32px_-8px_color-mix(in_oklch,var(--foreground)_28%,transparent)] transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] outline-none",
  {
    variants: {
      side: {
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] border-t pb-[env(safe-area-inset-bottom)] data-ending-style:translate-y-full data-starting-style:translate-y-full",
        full: "inset-0 pb-[env(safe-area-inset-bottom)] data-ending-style:translate-y-full data-starting-style:translate-y-full",
        left: "inset-y-0 left-0 w-[min(20rem,calc(100vw-3rem))] border-r data-ending-style:-translate-x-full data-starting-style:-translate-x-full",
        right:
          "inset-y-0 right-0 w-[min(22rem,calc(100vw-3rem))] border-l data-ending-style:translate-x-full data-starting-style:translate-x-full",
      },
    },
    defaultVariants: { side: "left" },
  }
);

function SheetContent({
  className,
  children,
  side = "left",
  title,
  ...props
}: DialogPrimitive.Popup.Props & {
  readonly side?: "bottom" | "full" | "left" | "right";
  /** The sheet's name, drawn in its head beside Close. */
  readonly title: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Backdrop
        className="fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--foreground)_22%,transparent)] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0"
        data-slot="sheet-overlay"
      />
      <DialogPrimitive.Popup
        className={cn(sheetVariants({ side }), className)}
        data-slot="sheet-content"
        {...props}
      >
        <div className="border-rule flex h-12 shrink-0 items-center justify-between gap-3 border-b pr-2 pl-4">
          <DialogPrimitive.Title className="text-ui font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close render={<Button size="sm" variant="ghost" />}>
            <XIcon aria-hidden="true" />
            Close
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
