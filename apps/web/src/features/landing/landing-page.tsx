import { installCommand } from "@repo/agent-kit/install";
import type { ReactNode } from "react";

import { buttonVariants } from "../../components/ui/button.tsx";
import { ID, LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH, EXPLORE_PATH, INSTALL_PATH } from "../shared/paths.ts";
import { GUTTER } from "../shared/shell/gutter.ts";
import { GateDrawing } from "./gate-drawing.tsx";
import { LandingNowList } from "./landing-now-list.tsx";
import type { LandingNow } from "./landing-now.ts";
import { MusicBox } from "./music-box/music-box.tsx";
import { WaysIn } from "./ways-in.tsx";
import { HEADLINE, HERO_LEDE } from "./words.ts";

/** The page's one main action, a size up from a toolbar's button. */
const PRIMARY = buttonVariants({
  className: "text-want h-11 px-6 no-underline",
  size: "lg",
});

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={ID}>{children}</code>
);

const MAIN = "main";

/** The headline's two sentences, one line each from `tablet`: the want, then the gate. */
const Headline = () => {
  const [first, ...rest] = HEADLINE.split(/(?<=\.)\s+/u);

  return (
    <>
      <span className="tablet:block">{first}</span>{" "}
      <span className="tablet:block">{rest.join(" ")}</span>
    </>
  );
};

/** The lede, with `main` set as the ref it is, in mono at the lede's own size. */
const Lede = () => {
  const [before, after] = HERO_LEDE.split(MAIN);

  return (
    <>
      {before}
      <code className="font-mono">{MAIN}</code>
      {after}
    </>
  );
};

/**
 * A section of the page under a rule that runs rail to rail: its heading
 * first, then a link beside it, then its body.
 */
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
  <section
    aria-labelledby={id}
    className={`border-rule flex flex-col gap-6 border-t py-12 ${GUTTER}`}
  >
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-headline" id={id}>
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
    className="flex min-w-0 flex-1 flex-col pb-8 outline-none"
    id="main"
    tabIndex={-1}
  >
    {/* The hero: the headline and its lede centred between the rails, the one action under them, then Fig 1 across the frame. */}
    <div
      className={`tablet:pt-20 flex flex-col items-center gap-12 pt-12 pb-16 ${GUTTER}`}
      data-hero=""
    >
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-display text-balance">
          <Headline />
        </h1>
        <p className="text-lede text-muted-foreground max-w-(--measure-lede) text-pretty">
          <Lede />
        </p>
      </div>
      <div className="flex max-w-full flex-col items-center gap-4">
        <AppLink className={PRIMARY} data-action="asks" to={ASKS_PATH}>
          Browse open asks
        </AppLink>
        <div className="max-w-full min-w-0">
          <CommandLine command={installCommand(webUrl)} />
        </div>
      </div>
      <div className="w-full max-w-(--container-figure)">
        <MusicBox />
      </div>
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
