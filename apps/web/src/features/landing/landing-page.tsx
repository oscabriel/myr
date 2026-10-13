import { installCommand } from "@repo/agent-kit/install";
import type { ReactNode } from "react";

import { buttonVariants } from "../../components/ui/button.tsx";
import { ID, LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH, EXPLORE_PATH, INSTALL_PATH } from "../shared/paths.ts";
import { GUTTER } from "../shared/shell/gutter.ts";
import { Comparison } from "./comparison.tsx";
import { GateDrawing } from "./gate-drawing.tsx";
import { LandingNowList } from "./landing-now-list.tsx";
import type { LandingNow } from "./landing-now.ts";
import { WaysIn } from "./ways-in.tsx";
import { HEADLINE, HERO_LEDE } from "./words.ts";

const PRIMARY = buttonVariants({ className: "no-underline", size: "lg" });

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={ID}>{children}</code>
);

const MAIN = "main";

/** The lede, with `main` set as the ref it is. */
const Lede = () => {
  const [before, after] = HERO_LEDE.split(MAIN);

  return (
    <>
      {before}
      <Code>{MAIN}</Code>
      {after}
    </>
  );
};

/** A section of the page: its heading first, then a link beside it, then its body. */
const Part = ({
  aside,
  children,
  id,
  title,
}: {
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) => (
  <section aria-labelledby={id} className="flex flex-col gap-5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-title" id={id}>
        {title}
      </h2>
      {aside}
    </div>
    {children}
  </section>
);

const More = ({
  children,
  to,
}: {
  readonly children: string;
  readonly to: string;
}) => (
  <AppLink className={`text-ui ${LINK}`} to={to}>
    {children}
  </AppLink>
);

interface Noun {
  readonly noun: string;
  readonly means: ReactNode;
}

/** GLOSSARY.md's definitions, word for word. */
const NOUNS: readonly Noun[] = [
  {
    means: (
      <>
        A file on <Code>main</Code> in which a project states one change it
        wants: a behavioural want, a territory, and a check that fails on{" "}
        <Code>main</Code>.
      </>
    ),
    noun: "Ask",
  },
  {
    means: "A commit in a claimant's fork offered to satisfy one ask.",
    noun: "Answer",
  },
  {
    means:
      "The predicate that judges an answer: the ask's own check plus the project's checks, run by the platform on the exact merged tree.",
    noun: "Check",
  },
  {
    means:
      "One or more members of the closed, typed union the platform returns instead of landing, all from the cheapest failing stage, each with a reason, a reproducing command, a next step, and whether retrying can help.",
    noun: "Refusal",
  },
];

const Nouns = () => (
  <dl className="tablet:grid-cols-2 columns:grid-cols-4 grid gap-x-8 gap-y-6">
    {NOUNS.map(({ means, noun }) => (
      <div
        className="border-rule flex flex-col gap-1.5 border-t pt-4"
        data-noun={noun.toLowerCase()}
        key={noun}
      >
        <dt className="text-title">{noun}</dt>
        <dd className="text-ui text-muted-foreground">{means}</dd>
      </div>
    ))}
  </dl>
);

export const LandingView = ({
  landings,
  platformUrl,
  webUrl,
}: {
  readonly landings: LandingNow;
  readonly platformUrl: string;
  readonly webUrl: string;
}) => (
  <main
    className={`flex min-w-0 flex-1 flex-col gap-16 pt-12 pb-20 outline-none ${GUTTER}`}
    id="main"
    tabIndex={-1}
  >
    <div className="flex flex-col gap-10">
      <div className="flex max-w-(--measure) flex-col gap-4">
        <h1 className="text-headline text-balance">{HEADLINE}</h1>
        <p className="text-body">
          <Lede />
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <AppLink className={PRIMARY} data-action="asks" to={ASKS_PATH}>
          Browse open asks
        </AppLink>
        <div className="max-w-full min-w-0">
          <CommandLine command={installCommand(webUrl)} />
        </div>
      </div>
      <Comparison />
    </div>

    <Part id="gate" title="The gate">
      <GateDrawing platformUrl={platformUrl} />
    </Part>

    <Part id="nouns" title="Four words">
      <Nouns />
    </Part>

    <Part
      aside={<More to={EXPLORE_PATH}>Explore projects</More>}
      id="landing-now"
      title="Landing now"
    >
      <LandingNowList landings={landings} />
    </Part>

    <Part
      aside={<More to={INSTALL_PATH}>All the ways in</More>}
      id="ways-in"
      title="Every way in"
    >
      <WaysIn platformUrl={platformUrl} webUrl={webUrl} />
    </Part>
  </main>
);
