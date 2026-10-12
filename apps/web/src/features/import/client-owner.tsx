import type { Owner } from "@repo/protocol/ids";
import { ClientOnly } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { lazy, Suspense } from "react";

export interface OwnerSelectProps {
  readonly choices: readonly Owner[];
  readonly labelledBy: string;
  readonly describedBy: string;
  readonly onChange: (value: Owner) => void;
  readonly value: Owner | undefined;
}

export const TRIGGER =
  "tablet:text-ui tablet:h-9 h-11 w-full max-w-sm text-base";

const SelectLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./owner-select.tsx"));

const StandIn = ({ describedBy, labelledBy, value }: OwnerSelectProps) => (
  <>
    <button
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
      className={`border-input flex items-center justify-between gap-1.5 border bg-transparent py-2 pr-2 pl-2.5 ${TRIGGER}`}
      data-slot="select-trigger"
      disabled
      type="button"
    >
      {value}
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground size-4"
        strokeWidth={1.75}
      />
    </button>
    <input name="owner" type="hidden" value={value ?? ""} />
  </>
);

export const ClientOwnerSelect = (props: OwnerSelectProps) => {
  const fallback = <StandIn {...props} />;

  return SelectLater === undefined ? (
    fallback
  ) : (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        <SelectLater {...props} />
      </Suspense>
    </ClientOnly>
  );
};
