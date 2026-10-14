import { installChannels } from "@repo/agent-kit/install-channels";

import { commands } from "../agents/catalog.ts";
import { AppLink } from "../shared/link.tsx";
import { INSTALL_PATH } from "../shared/paths.ts";

/** Every way in that works today, each a link to its place on the Install page. */
export const WaysIn = ({
  platformUrl,
  webUrl,
}: {
  readonly platformUrl: string;
  readonly webUrl: string;
}) => (
  <ul className="tablet:grid-cols-2 columns:grid-cols-3 grid gap-x-8 gap-y-6">
    {installChannels({ commands, platformUrl, webUrl })
      .filter(({ planned }) => !planned)
      .map(({ audience, id, summary, title }) => (
        <li
          className="border-rule flex min-w-0 flex-col gap-1.5 border-t pt-4"
          data-way={id}
          key={id}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-title">
              <AppLink
                className="no-underline hover:underline"
                hash={id}
                to={INSTALL_PATH}
              >
                {title}
              </AppLink>
            </h3>
            <p className="text-label text-muted-foreground ml-auto">
              {audience}
            </p>
          </div>
          <p className="text-ui text-muted-foreground">{summary}</p>
        </li>
      ))}
  </ul>
);
