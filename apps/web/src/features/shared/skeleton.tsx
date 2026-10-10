/**
 * What holds a row's or a fact block's place while it is read in the
 * browser (a selection's facts, a live fold, a route change): the same
 * size as what replaces it, drawn as hairline bars at 1.5:1 or more, still.
 * No shimmer: the wait is a fact, not a show. The lists themselves arrive
 * with the page, so these are only for what the browser reads after it.
 */
import { Skeleton } from "../../components/ui/skeleton.tsx";

/** A two-line row's place: 64 px, the want's bar over the metadata's. */
export const RowSkeleton = () => (
  <div
    aria-hidden="true"
    className="border-rule flex h-16 flex-col justify-center gap-2.5 border-b pl-8"
  >
    <Skeleton className="h-3 w-full max-w-[28rem]" />
    <Skeleton className="h-2.5 w-full max-w-[14rem]" />
  </div>
);

/** The inspector's place: each block's label as it will read, its values as bars. */
export const FactsSkeleton = ({
  labels,
}: {
  readonly labels: readonly string[];
}) => (
  <div aria-busy="true" className="flex flex-col">
    <output className="sr-only">Reading from the platform</output>
    {labels.map((label) => (
      <div
        className="border-rule flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0"
        key={label}
      >
        <p className="text-label text-muted-foreground">{label}</p>
        <Skeleton className="h-3 w-full max-w-[12rem]" />
        <Skeleton className="h-3 w-full max-w-[8rem]" />
      </div>
    ))}
  </div>
);
