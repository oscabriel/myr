import { docEntries } from "@repo/agent-kit/docs/entries";
import type { DocPart } from "@repo/agent-kit/docs/entries";

import { AppLink } from "../link.tsx";
import { docsPath } from "../paths.ts";

const PARTS = [
  { part: "guide", title: "Guides" },
  { part: "reference", title: "Reference" },
] as const satisfies readonly { part: DocPart; title: string }[];

const EXACT = { exact: true, includeSearch: false } as const;

const LINK =
  "text-ui text-muted-foreground hover:text-foreground hover:bg-surface aria-[current=page]:text-foreground flex min-h-8 items-center px-2 no-underline transition-colors duration-[120ms] aria-[current=page]:font-medium";

/** The docs shell's tree: every page by its part, the one being read current. */
export const DocsNav = () => (
  <nav aria-label="Docs" className="flex flex-col gap-4">
    {PARTS.map(({ part, title }) => (
      <div className="flex flex-col gap-1" key={part}>
        <h2 className="text-ui px-2 font-semibold">{title}</h2>
        <ul className="flex flex-col gap-px">
          {docEntries
            .filter((entry) => entry.part === part)
            .map(({ slug, title: pageTitle }) => (
              <li key={slug}>
                <AppLink
                  activeOptions={EXACT}
                  className={LINK}
                  to={docsPath(slug)}
                >
                  {pageTitle}
                </AppLink>
              </li>
            ))}
        </ul>
      </div>
    ))}
  </nav>
);
