import { ArrowRight } from "lucide-react";

import { AppLink } from "../shared/link.tsx";

const LINK = "decoration-rule underline hover:decoration-current";

export const Onward = ({
  children,
  to,
}: {
  readonly children: string;
  readonly to: string;
}) => (
  <AppLink
    className="text-ui decoration-rule inline-flex items-center gap-1.5 self-start underline hover:decoration-current"
    to={to}
  >
    {children}
    <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
  </AppLink>
);

/** A server route, so a plain link. */
export const ForAgents = ({ href }: { readonly href: string }) => (
  <p className="text-ui text-muted-foreground border-rule border-t pt-3 first:border-t-0">
    For agents:{" "}
    <a className={`text-foreground text-mono font-mono ${LINK}`} href={href}>
      {href.slice(1)}
    </a>
  </p>
);

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
