import {
  agentEndpoints,
  agentLimits,
  agentSetup,
  synopsis,
} from "@repo/agent-kit/agent-setup";
import type {
  SetupChannel,
  SetupInput,
  SetupSnippet,
} from "@repo/agent-kit/agent-setup";
import { Check, Copy } from "lucide-react";

import { Button } from "../../components/ui/button.tsx";
import { CommandLine } from "../shared/command.tsx";
import { useCopy } from "../shared/copy-action.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import {
  Endpoints,
  Limits,
  LINK,
  ReferenceSection,
  Refusals,
  Synopsis,
} from "./reference.tsx";

const SECTIONS = [
  { id: "synopsis", title: "Synopsis" },
  { id: "connect", title: "Connect" },
  { id: "endpoints", title: "Endpoints" },
  { id: "limits", title: "Limits" },
  { id: "refusals", title: "Refusals" },
] as const;

const SnippetBlock = ({ snippet }: { readonly snippet: SetupSnippet }) => {
  const { copied, copy } = useCopy(snippet.text);

  return (
    <div className="border-rule bg-surface flex max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3">
      <pre
        aria-label={snippet.label}
        className="text-mono leading-terminal min-w-0 flex-1 overflow-x-auto py-0.5 font-mono whitespace-pre"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must take focus to be scrolled without a pointer (WCAG 2.1.1)
        tabIndex={0}
      >
        <code className="select-all">{snippet.text}</code>
      </pre>
      <Button
        className="shrink-0"
        onClick={copy}
        size="sm"
        type="button"
        variant="ghost"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
};

const Snippet = ({ snippet }: { readonly snippet: SetupSnippet }) => (
  <figure className="flex min-w-0 flex-col gap-1.5">
    <figcaption className="text-ui text-muted-foreground">
      {snippet.label}
    </figcaption>
    {snippet.language === "sh" ? (
      <CommandLine command={snippet.text} />
    ) : (
      <SnippetBlock snippet={snippet} />
    )}
  </figure>
);

const Channel = ({ channel }: { readonly channel: SetupChannel }) => (
  <div className="border-rule flex min-w-0 flex-col gap-3 border-t pt-4">
    <h3 className="text-want font-semibold">{channel.title}</h3>
    <p className="max-w-[70ch]">{channel.useWhen}</p>
    <div className="flex max-w-[80ch] flex-col gap-4">
      {channel.snippets.map((snippet) => (
        <Snippet key={snippet.label} snippet={snippet} />
      ))}
    </div>
  </div>
);

const Contents = () => (
  <nav aria-label="Contents">
    <ul className="flex flex-col">
      {SECTIONS.map(({ id, title }) => (
        <li key={id}>
          {/* An anchor in this page, not a page of its own. */}
          <a
            className="text-ui hover:bg-surface -mx-2 flex h-8 items-center px-2 transition-colors duration-[120ms]"
            href={`#${id}`}
          >
            {title}
          </a>
        </li>
      ))}
    </ul>
  </nav>
);

export const AgentsView = (input: SetupInput) => (
  <Workspace
    facts={<Contents />}
    factsHeading="Contents"
    meta={
      <>
        Every way in reaches the same asks, claims and verdicts. As Markdown:{" "}
        {/* A server route, not a page of the app. */}
        <a className={`text-foreground ${LINK}`} href="/agents.md">
          agents.md
        </a>
      </>
    }
    title="For agents"
  >
    <ReferenceSection id="synopsis" title="Synopsis">
      <Synopsis lines={synopsis(input.commands)} />
    </ReferenceSection>
    <ReferenceSection id="connect" title="Connect">
      {agentSetup(input).map((channel) => (
        <Channel channel={channel} key={channel.title} />
      ))}
    </ReferenceSection>
    <ReferenceSection id="endpoints" title="Endpoints">
      <Endpoints endpoints={agentEndpoints(input)} />
    </ReferenceSection>
    <ReferenceSection id="limits" title="Limits">
      <Limits limits={agentLimits()} />
    </ReferenceSection>
    <ReferenceSection id="refusals" title="Refusals">
      <Refusals />
    </ReferenceSection>
  </Workspace>
);
