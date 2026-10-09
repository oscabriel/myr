/**
 * What a page shows while its reads are on their way, and when the platform
 * did not answer: the page's own title over rows that hold its place, or a
 * plain sentence. Neither is a refusal: a refusal is the platform's answer,
 * and these are the absence of one.
 */
import { CloudOff } from "lucide-react";

import { Skeleton } from "../../components/ui/skeleton.tsx";
import { PageShell } from "../shared/layout.tsx";

const ROWS = ["first", "second", "third"] as const;

/** Rows that hold a list's place while the platform answers. */
export const ReadingRows = () => (
  <div aria-busy="true" className="flex flex-col">
    <output className="sr-only">Reading from the platform</output>
    {ROWS.map((row) => (
      <div className="border-rule flex flex-col gap-2 border-t py-4" key={row}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-full max-w-[60ch]" />
        <Skeleton className="h-4 w-56" />
      </div>
    ))}
  </div>
);

export const Reading = ({ title }: { readonly title: string }) => (
  <PageShell title={title}>
    <ReadingRows />
  </PageShell>
);

export const Unreachable = ({ title }: { readonly title: string }) => (
  <PageShell title={title}>
    <p className="flex items-start gap-2" role="alert">
      <CloudOff
        aria-hidden="true"
        className="text-muted-foreground mt-1 size-4 shrink-0"
      />
      <span>
        The platform did not answer. Reload the page to ask again; git and the
        CLI reach it directly.
      </span>
    </p>
  </PageShell>
);
