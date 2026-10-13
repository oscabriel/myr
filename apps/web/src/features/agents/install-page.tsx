import type { SetupInput, SetupSnippet } from "@repo/agent-kit/agent-setup";
import { installChannels } from "@repo/agent-kit/install-channels";
import type {
  InstallChannel,
  InstallLink,
} from "@repo/agent-kit/install-channels";
import { Check, Copy } from "lucide-react";
import { Fragment } from "react";

import { Button } from "../../components/ui/button.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs.tsx";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { useCopy } from "../shared/copy-action.tsx";
import { AppLink } from "../shared/link.tsx";
import { docsPath, EXPLORE_PATH } from "../shared/paths.ts";
import { GUTTER } from "../shared/shell/gutter.ts";

export const INSTALL_TITLE = "Install";

export const INSTALL_LEDE =
  "Every way in reaches the same gate and hears the same refusals. Install the CLI for a terminal, connect an agent over MCP, or point anything that reads text at llms.txt.";

/** A config file or a sentence to paste: kept as written, scrolled sideways, never wrapped. */
const SnippetBlock = ({ snippet }: { readonly snippet: SetupSnippet }) => {
  const { copied, copy } = useCopy(snippet.text);

  return (
    <div className="border-rule bg-surface flex max-w-full min-w-0 items-start gap-2 border py-1 pr-1 pl-3">
      <pre
        aria-label={snippet.label}
        className={`text-mono leading-terminal min-w-0 flex-1 overflow-x-auto py-0.5 font-mono ${
          snippet.language === "text" ? "whitespace-pre-wrap" : "whitespace-pre"
        }`}
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

/** One snippet at a time, each in its panel; every panel is in the page, so the HTML carries every snippet. */
const SnippetTabs = ({
  snippets,
}: {
  readonly snippets: readonly SetupSnippet[];
}) => (
  <Tabs defaultValue={snippets[0]?.name}>
    <TabsList variant="line">
      {snippets.map(({ name }) => (
        <TabsTrigger key={name} value={name}>
          {name}
        </TabsTrigger>
      ))}
    </TabsList>
    {snippets.map((snippet) => (
      <TabsContent
        className="pt-2"
        keepMounted
        key={snippet.name}
        value={snippet.name}
      >
        <Snippet snippet={snippet} />
      </TabsContent>
    ))}
  </Tabs>
);

/** A page of the web through the router; a file the web serves as a plain link. */
const Reference = ({ link }: { readonly link: InstallLink }) =>
  link.page ? (
    <AppLink className={`text-foreground ${LINK}`} to={link.path}>
      {link.label}
    </AppLink>
  ) : (
    <a className={`text-foreground ${LINK}`} href={link.path}>
      {link.label}
    </a>
  );

const References = ({ links }: { readonly links: readonly InstallLink[] }) =>
  links.length === 0 ? null : (
    <p className="text-ui text-muted-foreground mt-auto pt-1">
      {links.map((link, index) => (
        <Fragment key={link.path}>
          {index === 0 ? null : " · "}
          <Reference link={link} />
        </Fragment>
      ))}
    </p>
  );

/** None for a channel with no command, tabs where a channel offers one of several, else each in turn. */
const Snippets = ({ channel }: { readonly channel: InstallChannel }) => {
  if (channel.snippets.length === 0) {
    return null;
  }

  return channel.tabbed ? (
    <SnippetTabs snippets={channel.snippets} />
  ) : (
    <div className="flex min-w-0 flex-col gap-4">
      {channel.snippets.map((snippet) => (
        <Snippet key={snippet.name} snippet={snippet} />
      ))}
    </div>
  );
};

const ChannelCard = ({ channel }: { readonly channel: InstallChannel }) => (
  <section
    aria-labelledby={channel.id}
    className={`bg-card flex min-w-0 flex-col gap-3 rounded-md border p-4 ${
      channel.planned ? "border-rule border-dashed" : "border-rule"
    }`}
  >
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      {/* The anchor's target: its margin clears the sticky top bar. */}
      <h2 className="text-title scroll-mt-20" id={channel.id}>
        {channel.title}
      </h2>
      <p className="text-label text-muted-foreground ml-auto">
        {channel.audience}
      </p>
    </div>
    <p className="max-w-(--measure)">{channel.summary}</p>
    <Snippets channel={channel} />
    <References links={channel.links} />
  </section>
);

export const InstallView = (input: SetupInput) => (
  <main
    className={`flex min-w-0 flex-1 flex-col gap-8 pt-8 pb-16 outline-none ${GUTTER}`}
    id="main"
    tabIndex={-1}
  >
    <div className="flex max-w-(--measure) flex-col gap-3">
      <h1 className="text-headline">{INSTALL_TITLE}</h1>
      <p className="text-want text-muted-foreground font-normal">
        {INSTALL_LEDE}
      </p>
    </div>
    <div className="columns:grid-cols-2 grid gap-5">
      {installChannels(input).map((channel) => (
        <ChannelCard channel={channel} key={channel.id} />
      ))}
    </div>
    <p className="text-ui text-muted-foreground">
      Next:{" "}
      <AppLink
        className={`text-foreground ${LINK}`}
        to={docsPath("answer-an-ask")}
      >
        answer an ask
      </AppLink>
      , or{" "}
      <AppLink className={`text-foreground ${LINK}`} to={EXPLORE_PATH}>
        explore the projects
      </AppLink>
      .
    </p>
  </main>
);
