/**
 * A report sheet's fields: a label, then its value, one ruled row each, as
 * the header of a test certificate reads (DESIGN.md). From `lg` two fields
 * share a row. Values that are code (ids, paths, SHAs) wrap anywhere, so a
 * phone never scrolls sideways.
 */
import type { ReactNode } from "react";

/** Text that is code: an id, a path, a SHA, a command's name. */
export const CODE = "font-mono text-[0.8125rem] [overflow-wrap:anywhere]";

/** A link in running text: underlined in the rule colour, darker on hover. */
export const LINK = "decoration-rule underline hover:decoration-current";

export const Fields = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <dl
    aria-label={label}
    className="border-rule grid grid-cols-[minmax(6.5rem,max-content)_minmax(0,1fr)] gap-x-6 border-t text-sm lg:grid-cols-[minmax(6.5rem,max-content)_minmax(0,1fr)_minmax(6.5rem,max-content)_minmax(0,1fr)]"
  >
    {children}
  </dl>
);

export const Field = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <div className="border-rule col-span-2 grid grid-cols-subgrid items-baseline border-b py-2">
    <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
    <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

/** A titled region of a page: a heading over its content, 32 px from the next. */
export const Region = ({
  children,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) => (
  <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
    <h2 className="text-lg font-semibold tracking-[-0.01em]" id={id}>
      {title}
    </h2>
    {children}
  </section>
);
