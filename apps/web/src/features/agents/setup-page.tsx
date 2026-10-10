/**
 * The Agents page: each way an agent connects, as `@repo/agent-kit`'s
 * `agentSetup` gives it, so the page has no text of its own for a snippet
 * (principle 4). A shell line is a `CommandLine`; JSON and text to paste
 * sit in a block with the same copy affordance. A view: channels in,
 * markup out.
 */
import type { SetupChannel, SetupSnippet } from "@repo/agent-kit/agent-setup";

import { LINK, Region } from "../ask/fields.tsx";
import { CopyButton } from "../code/copy.tsx";
import { CommandLine } from "../shared/command.tsx";

/** A channel's heading id, from its title: `agents-remote-mcp`. */
const idOf = (title: string) =>
  `agents-${title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}`;

const SnippetBlock = ({ snippet }: { readonly snippet: SetupSnippet }) => (
  <div className="border-rule bg-surface flex max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3">
    <pre className="min-w-0 flex-1 overflow-x-auto py-0.5 font-mono text-[0.8125rem] leading-6 whitespace-pre-wrap">
      <code className="[overflow-wrap:anywhere] select-all">
        {snippet.text}
      </code>
    </pre>
    <div className="shrink-0">
      <CopyButton label="Copy" text={snippet.text} />
    </div>
  </div>
);

const Snippet = ({ snippet }: { readonly snippet: SetupSnippet }) => (
  <figure className="flex min-w-0 flex-col gap-1.5">
    <figcaption className="text-muted-foreground text-sm">
      {snippet.label}
    </figcaption>
    {snippet.language === "sh" ? (
      <CommandLine command={snippet.text} />
    ) : (
      <SnippetBlock snippet={snippet} />
    )}
  </figure>
);

export const AgentSetupView = ({
  channels,
}: {
  readonly channels: readonly SetupChannel[];
}) => (
  <>
    <p className="max-w-[70ch]">
      Pick the way your agent works. Each one reaches the same asks, claims and
      verdicts; an agent that reads Markdown can read{" "}
      <a className={LINK} href="/agents.md">
        this page as Markdown
      </a>
      .
    </p>
    {channels.map((channel) => (
      <Region
        id={idOf(channel.title)}
        key={channel.title}
        title={channel.title}
      >
        <p className="max-w-[70ch]">{channel.useWhen}</p>
        <div className="flex max-w-[80ch] flex-col gap-4">
          {channel.snippets.map((snippet) => (
            <Snippet key={snippet.label} snippet={snippet} />
          ))}
        </div>
      </Region>
    ))}
  </>
);
