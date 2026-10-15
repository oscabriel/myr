import { installCommand } from "@repo/agent-kit/install";
import type { ReactNode } from "react";

import { buttonVariants } from "../../components/ui/button.tsx";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { AppLink } from "../shared/link.tsx";
import {
  ASKS_PATH,
  EXPLORE_PATH,
  IMPORT_PATH,
  LANDING_NOW_ANCHOR,
  TOUR_PATH,
} from "../shared/paths.ts";
import { GUTTER } from "../shared/shell/gutter.ts";
import { GateDrawing } from "./gate-drawing.tsx";
import { LandingNowList } from "./landing-now-list.tsx";
import type { LandingNow } from "./landing-now.ts";
import { MusicBox } from "./music-box/music-box.tsx";
import { WaysIn } from "./ways-in.tsx";
import { HEADLINE, HERO_LEDE, RUN_A_PROJECT } from "./words.ts";

/** The page's main action, a size up from a toolbar's button. */
const PRIMARY = buttonVariants({
  className: "text-want h-11 px-6 no-underline",
  size: "lg",
});

/** The maintainer's way in, beside it at the same size, outlined. */
const SECONDARY = buttonVariants({
  className: "text-want h-11 px-6 no-underline",
  size: "lg",
  variant: "outline",
});

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

/** A sentence with `main` set as the ref it is, in mono at the sentence's own size. */
const WithMain = ({ text }: { readonly text: string }) => {
  const [before, after] = text.split(MAIN);

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
    {/* The hero: the headline and its one lede centred between the rails, the two ways in under them, then Fig 1 across the frame. */}
    <div
      className={`tablet:pt-20 flex flex-col items-center gap-12 pt-12 pb-16 ${GUTTER}`}
      data-hero=""
    >
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-display text-balance">
          <Headline />
        </h1>
        <p className="text-lede text-muted-foreground max-w-(--measure-lede) text-pretty">
          <WithMain text={HERO_LEDE} />
        </p>
      </div>
      <div className="flex max-w-full flex-col items-center gap-4">
        <div className="flex max-w-full flex-wrap justify-center gap-3">
          <AppLink className={PRIMARY} data-action="asks" to={ASKS_PATH}>
            Browse open asks
          </AppLink>
          <AppLink className={SECONDARY} data-action="import" to={IMPORT_PATH}>
            {RUN_A_PROJECT}
          </AppLink>
        </div>
        <div className="max-w-full min-w-0">
          <CommandLine command={installCommand(webUrl)} />
        </div>
        <AppLink className={`text-ui ${LINK}`} to={TOUR_PATH}>
          Take the tour
        </AppLink>
      </div>
      <div className="w-full max-w-(--container-figure)">
        <MusicBox />
      </div>
    </div>

    <Part id="gate" title="The gate">
      <GateDrawing platformUrl={platformUrl} />
    </Part>

    <Part
      aside={<More to={EXPLORE_PATH}>Explore projects</More>}
      id={LANDING_NOW_ANCHOR}
      title="Landing now"
    >
      <LandingNowList landings={landings} />
    </Part>

    <Part id="ways-in" title="Every way in">
      <WaysIn platformUrl={platformUrl} webUrl={webUrl} />
    </Part>
  </main>
);
