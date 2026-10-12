import { Skeleton } from "../../components/ui/skeleton.tsx";

export const RowSkeleton = () => (
  <div
    aria-hidden="true"
    className="border-rule flex h-16 flex-col justify-center gap-2.5 border-b pl-8"
  >
    <Skeleton className="h-3 w-full max-w-[28rem]" />
    <Skeleton className="h-2.5 w-full max-w-[14rem]" />
  </div>
);

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
