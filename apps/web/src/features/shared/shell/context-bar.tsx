import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button.tsx";
import { useCopy } from "../copy-action.tsx";
import { useNumberedCommand } from "../keys.tsx";
import { AppLink } from "../link.tsx";
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

export const CopyCommand = ({ command }: { readonly command: string }) => {
  const { copied, copy } = useCopy(command);
  const number = useNumberedCommand(command);

  return (
    <Button
      onClick={copy}
      size="sm"
      title={
        number === undefined
          ? `Copy: ${command}`
          : `Copy (${number}): ${command}`
      }
      variant="outline"
    >
      {copied ? (
        <Check aria-hidden="true" strokeWidth={1.75} />
      ) : (
        <Copy aria-hidden="true" strokeWidth={1.75} />
      )}
      <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
      <code className="sr-only">
        {copied ? `Copied ${command}` : `Copy ${command}`}
      </code>
    </Button>
  );
};

export const ContextBar = ({
  count,
  crumbs,
  end,
  primaryCommand,
  state,
}: {
  readonly count?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly end?: ReactNode;
  readonly primaryCommand?: string | undefined;
  readonly state?: ReactNode;
}) => (
  <div className="border-rule bg-background tablet:px-5 shell:sticky shell:top-0 shell:px-6 z-20 flex h-11 shrink-0 items-center gap-3 border-b px-4">
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
      {primaryCommand === undefined ? null : (
        <CopyCommand command={primaryCommand} />
      )}
      {end}
    </div>
  </div>
);
