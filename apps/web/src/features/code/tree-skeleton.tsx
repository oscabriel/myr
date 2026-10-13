import { Skeleton } from "../../components/ui/skeleton.tsx";

const ROWS = ["w-32", "w-24", "w-40", "w-28", "w-36", "w-20", "w-44"] as const;

/** The file tree's shape while its body and its read are on the way, so the column never stands empty. */
export const TreeSkeleton = () => (
  <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
    <output className="sr-only">Reading the files</output>
    <div aria-hidden="true" className="flex flex-col gap-3 px-3">
      <Skeleton className="h-9 w-full sm:h-8" />
      {ROWS.map((width) => (
        <Skeleton className={`h-3 max-w-full ${width}`} key={width} />
      ))}
    </div>
  </div>
);
