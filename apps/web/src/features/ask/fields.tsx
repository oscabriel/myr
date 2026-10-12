import type { ReactNode } from "react";

export const Fields = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <dl
    aria-label={label}
    className="border-rule text-ui grid grid-cols-[minmax(6.5rem,max-content)_minmax(0,1fr)] gap-x-6 border-t lg:grid-cols-[minmax(6.5rem,max-content)_minmax(0,1fr)_minmax(6.5rem,max-content)_minmax(0,1fr)]"
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
    <dt className="text-label text-muted-foreground">{label}</dt>
    <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

export const Definitions = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) => (
  <dl aria-label={label} className="border-rule flex min-w-0 flex-col border-t">
    {children}
  </dl>
);

export const Definition = ({
  children,
  term,
}: {
  readonly children: ReactNode;
  readonly term: ReactNode;
}) => (
  <div className="border-rule shell:grid shell:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] shell:gap-4 flex min-w-0 flex-col gap-0.5 border-b py-2.5">
    <dt className="text-label text-muted-foreground shell:pt-px">{term}</dt>
    <dd className="text-ui min-w-0 [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

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
    <h2 className="text-title" id={id}>
      {title}
    </h2>
    {children}
  </section>
);
