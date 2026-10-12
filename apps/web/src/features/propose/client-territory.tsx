/**
 * `import.meta.env.SSR` is `true` in the Worker's build, so the dynamic import
 * below is dead code there and the Worker bundles none of it.
 */
import { ClientOnly } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { lazy, Suspense } from "react";

import type { TerritorySelectProps } from "./territory-select.tsx";

const SelectLater = import.meta.env.SSR
  ? undefined
  : lazy(() => import("./territory-select.tsx"));

const StandIn = ({ choices, labelledBy, value }: TerritorySelectProps) => (
  <>
    <button
      aria-labelledby={labelledBy}
      className="border-input tablet:text-ui tablet:h-9 flex h-11 w-full max-w-xs items-center justify-between gap-1.5 border bg-transparent py-2 pr-2 pl-2.5 text-base"
      data-slot="select-trigger"
      disabled
      type="button"
    >
      {choices.find((choice) => choice.value === value)?.label ?? value}
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground size-4"
        strokeWidth={1.75}
      />
    </button>
    <input name="territory" type="hidden" value={value} />
  </>
);

export const ClientTerritorySelect = (props: TerritorySelectProps) => {
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
