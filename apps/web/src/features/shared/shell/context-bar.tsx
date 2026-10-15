import type { ReactNode } from "react";

import { AppLink } from "../link.tsx";
import { GUTTER } from "./gutter.ts";
import type { Crumb } from "./sections.ts";

export const Breadcrumb = ({
  crumbs,
}: {
  readonly crumbs: readonly Crumb[];
}) => (
  <nav aria-label="Breadcrumb" className="min-w-0">
    <ol className="text-ui flex min-w-0 items-center gap-1.5">
      {crumbs.map(({ label, mono = false, to }, index) => {
        const last = index === crumbs.length - 1;
        const face = mono ? "text-mono font-mono" : "";

        return (
          <li
            className={`${last ? "flex" : "tablet:flex hidden"} min-w-0 items-center gap-1.5`}
            key={`${index}:${label}`}
          >
            {index === 0 ? null : (
              <span
                aria-hidden="true"
                className={`text-muted-foreground ${last ? "tablet:inline hidden" : ""}`}
              >
                /
              </span>
            )}
            {last || to === undefined ? (
              <span
                aria-current={last ? "page" : undefined}
                className={`min-w-0 truncate ${last ? "text-foreground font-medium" : "text-muted-foreground"} ${face}`}
                title={label}
              >
                {label}
              </span>
            ) : (
              <AppLink
                activeOptions={{ exact: true, includeSearch: false }}
                className={`text-muted-foreground hover:text-foreground max-w-[14rem] min-w-0 truncate no-underline transition-colors duration-[120ms] ${face}`}
                title={label}
                to={to}
              >
                {label}
              </AppLink>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

export const ContextBar = ({
  count,
  crumbs,
  state,
}: {
  readonly count?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly state?: ReactNode;
}) => (
  <div
    className={`border-rule bg-background flex h-11 shrink-0 items-center gap-3 border-b ${GUTTER}`}
  >
    <Breadcrumb crumbs={crumbs} />
    <div className="ml-auto flex shrink-0 items-center gap-3">
      {count === undefined ? null : (
        <p className="text-ui text-muted-foreground truncate tabular-nums">
          {count}
        </p>
      )}
      {state === undefined ? null : (
        <div className="text-ui flex items-center">{state}</div>
      )}
    </div>
  </div>
);
