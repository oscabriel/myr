/**
 * The guided walkthrough: six steps, each one sentence, the command that
 * runs it (the page's `1` to `6` keys copy them) and a screen drawn by the
 * real components over example data. The refusal is the renderer's own
 * words, through the landing's transcript, so it cannot drift from git's.
 */
import { Brand } from "@repo/brand";
import type { ReactNode } from "react";

import { Brief } from "../ask/ask-page.tsx";
import { Output } from "../landing/gate-drawing.tsx";
import {
  CLAIM,
  claimReceipt,
  EXAMPLE,
  landedPush,
  PUSH,
  refusedPush,
} from "../landing/transcript.ts";
import { LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { CreditTrailers } from "../shared/credits.tsx";
import { TerritoryFacts } from "../shared/facts.tsx";
import { AppLink } from "../shared/link.tsx";
import { StageStrip } from "../shared/outcome.tsx";
import {
  ASKS_PATH,
  INSTALL_PATH,
  LANDING_NOW_ANCHOR,
} from "../shared/paths.ts";
import { AskRow, RowList } from "../shared/row.tsx";
import { GUTTER } from "../shared/shell/gutter.ts";
import {
  ASK,
  claimOf,
  LANDING,
  LISTING,
  VERDICT,
  WHY_LOCATION,
} from "./example.ts";
import type { TourLive } from "./read.ts";
import { EXAMPLE_NOTE, TOUR_LEDE, TOUR_TITLE } from "./words.ts";

/** The six commands, in the order the keys number them. */
export const TOUR_COMMANDS = {
  ask: `${Brand.cli} ask ${EXAMPLE.ask} --project ${EXAMPLE.project}`,
  check: `${Brand.cli} check`,
  claim: CLAIM,
  front: `${Brand.cli} front`,
  push: PUSH,
  why: `${Brand.cli} why ${WHY_LOCATION} --project ${EXAMPLE.project}`,
} as const;

interface StepWords {
  readonly id: string;
  readonly title: string;
  readonly sentence: string;
  readonly command: string;
}

const WORDS = {
  claim: {
    command: TOUR_COMMANDS.claim,
    id: "claim",
    sentence:
      "A claim is exclusive and expires unless you push; it gives you a fork of your own at the platform.",
    title: "Claim it",
  },
  credit: {
    command: TOUR_COMMANDS.why,
    id: "credit",
    sentence:
      "The landing commit credits the asker and the answerer in its trailers; an agent is disclosed, never credited. Any line's history leads back to them.",
    title: "See the credit",
  },
  find: {
    command: TOUR_COMMANDS.front,
    id: "find",
    sentence:
      "Every open ask across every public project, each a change its maintainers want and will land.",
    title: "Find an ask",
  },
  land: {
    command: TOUR_COMMANDS.check,
    id: "land",
    sentence:
      "Put the file back, run the checks locally, push again: the gate merges the answer onto main, runs every check on that exact tree, and lands it.",
    title: "Fix it, and land",
  },
  read: {
    command: TOUR_COMMANDS.ask,
    id: "read",
    sentence:
      "The brief says what done means, the territory which files an answer may change, and the check what judges it.",
    title: "Read it",
  },
  refused: {
    command: TOUR_COMMANDS.push,
    id: "refused",
    sentence:
      "A push that strays outside the territory is refused in git's own output, with the reason, the command to run next and whether trying again can help.",
    title: "Push, and hear why not",
  },
} as const satisfies Record<string, StepWords>;

/** The six steps in the order the page walks them, and the keys number their commands. */
export const STEPS: readonly StepWords[] = [
  WORDS.find,
  WORDS.read,
  WORDS.claim,
  WORDS.refused,
  WORDS.land,
  WORDS.credit,
];

const Step = ({
  children,
  live,
  number,
  words,
}: {
  readonly children: ReactNode;
  readonly live?: ReactNode;
  readonly number: number;
  readonly words: StepWords;
}) => (
  <li
    className="border-rule flex min-w-0 flex-col gap-4 border-t py-8"
    data-step={words.id}
  >
    <div className="flex max-w-(--measure) flex-col gap-2">
      <h2 className="text-title flex items-baseline gap-3" id={words.id}>
        <span className="text-muted-foreground tabular-nums">{number}.</span>
        {words.title}
      </h2>
      <p className="text-body text-muted-foreground">{words.sentence}</p>
    </div>
    <CommandLine command={words.command} numbered />
    <div
      className="border-rule bg-card flex min-w-0 flex-col gap-4 rounded-md border p-4"
      data-screen={words.id}
    >
      {children}
    </div>
    {live}
  </li>
);

const Live = ({
  children,
  to,
  hash,
}: {
  readonly children: string;
  readonly to: string;
  readonly hash?: string;
}) => (
  <p className="text-ui" data-live="">
    See it live:{" "}
    <AppLink className={LINK} to={to} {...(hash === undefined ? {} : { hash })}>
      {children}
    </AppLink>
  </p>
);

export const TourView = ({
  live,
  platformUrl,
}: {
  readonly live: TourLive;
  readonly platformUrl: string;
}) => {
  const claim = claimOf(platformUrl);

  return (
    <main
      className={`flex min-w-0 flex-1 flex-col gap-8 pt-8 pb-16 outline-none ${GUTTER}`}
      id="main"
      tabIndex={-1}
    >
      <div className="flex max-w-(--measure) flex-col gap-3">
        <h1 className="text-headline">{TOUR_TITLE}</h1>
        <p className="text-want text-muted-foreground font-normal">
          {TOUR_LEDE}
        </p>
        <p className="text-ui text-muted-foreground" data-example-note="">
          {EXAMPLE_NOTE}
        </p>
      </div>

      <ol className="flex min-w-0 flex-col">
        <Step
          live={live.asks ? <Live to={ASKS_PATH}>the open asks</Live> : null}
          number={1}
          words={WORDS.find}
        >
          <RowList label="Open asks">
            {LISTING.map((listing) => (
              <AskRow
                key={listing.ask}
                listing={listing}
                project={EXAMPLE.project}
                showProject
                takeable={!listing.claimed}
              />
            ))}
          </RowList>
        </Step>

        <Step number={2} words={WORDS.read}>
          <Brief ask={ASK} />
          <TerritoryFacts ask={ASK} />
        </Step>

        <Step number={3} words={WORDS.claim}>
          <Output
            caption="The receipt: what you hold, until when, the fork, and the three commands that follow."
            outcome="claimed"
            transcript={claimReceipt(claim)}
          />
        </Step>

        <Step number={4} words={WORDS.refused}>
          <Output
            caption="Refused at the shape stage, before any check ran: the tag, the reason, the next command, and whether retrying can help."
            outcome="refused"
            transcript={refusedPush(platformUrl)}
          />
        </Step>

        <Step
          live={
            live.landings ? (
              <Live hash={LANDING_NOW_ANCHOR} to="/">
                the latest landings
              </Live>
            ) : null
          }
          number={5}
          words={WORDS.land}
        >
          <Output
            caption="Taken at the push; once every later stage passed, it landed as a commit crediting every person."
            outcome="landed"
            transcript={landedPush()}
          />
          <StageStrip
            holds={{ decided: false, heldBack: false }}
            outcome={VERDICT.outcome}
            stage={VERDICT.stage}
          />
        </Step>

        <Step number={6} words={WORDS.credit}>
          <CreditTrailers
            assisted={LANDING.assisted}
            credits={LANDING.credits}
            label="title"
          />
        </Step>
      </ol>

      <p className="text-ui text-muted-foreground">
        Next:{" "}
        <AppLink className={`text-foreground ${LINK}`} to={ASKS_PATH}>
          browse the open asks
        </AppLink>
        , or{" "}
        <AppLink className={`text-foreground ${LINK}`} to={INSTALL_PATH}>
          install the CLI
        </AppLink>
        .
      </p>
    </main>
  );
};
