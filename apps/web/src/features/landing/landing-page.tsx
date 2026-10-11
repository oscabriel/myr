/**
 * The landing: what the platform is, said once, and the way to the open
 * asks first. Its evidence is the screen `git push` prints when the gate
 * refuses, set as git sets it, not a picture of one. Every sentence on it is
 * the README's or the glossary's. A view: the platform's address, the web's
 * own and the projects in; markup out.
 */
import { installCommand } from "@repo/agent-kit/install";
import { Brand } from "@repo/brand";
import type { ReactNode } from "react";

import { buttonVariants } from "../../components/ui/button.tsx";
import { signInHref } from "../auth/session-slot.tsx";
import { postureLabel } from "../project/posture-label.ts";
import { ID, LINK } from "../shared/classes.ts";
import { CommandLine } from "../shared/command.tsx";
import { SkipLink } from "../shared/layout.tsx";
import { AppLink } from "../shared/link.tsx";
import {
  ASKS_PATH,
  docsPath,
  HOME_PATH,
  projectPath,
} from "../shared/paths.ts";
import { UnreachableNotice } from "../shared/pending.tsx";
import { PostureBadge } from "../shared/posture.tsx";
import { LandingProjects } from "./projects.ts";
import { pushTranscript } from "./transcript.ts";
import { LEDE, WHAT_IT_IS } from "./words.ts";

/** A link in a plain row (the top, the foot): ink, underlined only on hover. */
const ROW_LINK = "no-underline hover:underline";

/** The primary action: an ink button that is a link. */
const PRIMARY = buttonVariants({ className: "no-underline" });

/** Where an agent's reference is. */
const AGENTS_PATH = "/agents";

/** Text git prints or takes, inside a sentence. */
const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={ID}>{children}</code>
);

/** The branch's name, as git takes it. */
const MAIN = "main";

/** The lede, its one branch name set as git takes it. */
const Lede = () => {
  const [before, after] = LEDE.split(MAIN);

  return (
    <>
      {before}
      <Code>{MAIN}</Code>
      {after}
    </>
  );
};

/** One part of the page under its name, parted from the last by a hairline. */
const Part = ({
  children,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) => (
  <section
    aria-labelledby={id}
    className="border-rule flex flex-col gap-4 border-t pt-8"
  >
    <h2 className="text-title" id={id}>
      {title}
    </h2>
    {children}
  </section>
);

/** A noun a contributor meets, and what GLOSSARY.md says it is. */
interface Noun {
  readonly noun: string;
  readonly means: ReactNode;
}

/** The four nouns, in the glossary's words. */
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

/** The core loop, in the README's six lines. */
const LOOP: readonly ReactNode[] = [
  <>
    A decider opens an ask; <Code>{`${Brand.cli} ask open`}</Code> lands it only
    once its check fails on <Code>main</Code> twice the same way, by an
    assertion.
  </>,
  <>
    A contributor runs <Code>{`${Brand.cli} claim <ask>`}</Code> and gets a fork
    of their own.
  </>,
  "They, or their agent, work in plain git with any harness, and push to the fork through the platform's gateway.",
  <>
    The gateway checks the push against the claim, the territory and the judge
    closure, and refuses in <Code>git push</Code>&apos;s output.
  </>,
  <>
    The platform merges onto <Code>main</Code> and runs the ask&apos;s check,
    the project&apos;s checks and the held-back checks on that exact tree.
  </>,
  <>
    It lands the checked tree on <Code>main</Code> as its own commit crediting
    every person, or answers with a refusal.
  </>,
];

/** One thing a platform can do that a setting cannot: the README's lead, and its words. */
interface Power {
  readonly lead: string;
  readonly says: ReactNode;
}

/** What a platform can do that a setting on a code host cannot, in the README's words. */
const POWERS: readonly Power[] = [
  {
    lead: "Judge with checks the answer cannot touch.",
    says: (
      <>
        The files that decide what the checks do form the project&apos;s judge
        closure; a push that edits one, or adds a <Code>.skip</Code> or a lint
        disable without a reason, is refused at the push.
      </>
    ),
  },
  {
    lead: "Hold checks back.",
    says: "A maintainer's held-back checks run on every answer; the answerer learns one result per area, and each landing names the suite's salted commitment.",
  },
  {
    lead: "Refuse in git's own words.",
    says: (
      <>
        A refusal is a member of one closed, typed union about the contribution,
        printed in <Code>git push</Code>&apos;s <Code>remote:</Code> lines with
        the command to run next and whether retrying can help.
      </>
    ),
  },
  {
    lead: "Give an ask one claimant.",
    says: "A claim is an exclusive, expiring right to answer an ask, so two agents never race on the same change; racing is opt-in, for the kinds of ask where parallel attempts are the point.",
  },
  {
    lead: "Credit the asker too.",
    says: (
      <>
        A landing names every person by trailer (<Code>Asked-by</Code>,{" "}
        <Code>Signed-off-by</Code>, <Code>Decided-by</Code>,{" "}
        <Code>Finished-by</Code> and more), and a person&apos;s record carries
        across projects. An agent is disclosed, never credited.
      </>
    ),
  },
];

/** The wordmark and the ways in, as a plain row. */
const Top = () => (
  <header className="border-rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-4">
    <AppLink className="text-want font-semibold no-underline" to="/">
      {Brand.name}
    </AppLink>
    <nav aria-label="Site" className="text-ui flex flex-wrap gap-x-5 gap-y-1">
      <AppLink className={ROW_LINK} to={ASKS_PATH}>
        Asks
      </AppLink>
      <AppLink className={ROW_LINK} to={docsPath()}>
        Docs
      </AppLink>
      <AppLink className={ROW_LINK} to={AGENTS_PATH}>
        For agents
      </AppLink>
      <a className={ROW_LINK} href={signInHref(HOME_PATH)}>
        Sign in
      </a>
    </nav>
  </header>
);

/** A line of the screen, with the refusal's tag in the refused colour wherever git names it. */
const Printed = ({
  tag,
  text,
}: {
  readonly tag: string;
  readonly text: string;
}) => {
  const [before, ...after] = text.split(tag);

  return after.length === 0 ? (
    text
  ) : (
    <>
      {before}
      {after.map((rest, at) => (
        // The tag's place on its line never moves: its index is its key.
        <span key={at}>
          <span className="text-refused font-semibold">{tag}</span>
          {rest}
        </span>
      ))}
    </>
  );
};

/** The push, and what git prints back when the gate refuses it. */
const Transcript = ({ platformUrl }: { readonly platformUrl: string }) => {
  const { command, lines, tag } = pushTranscript(platformUrl);

  return (
    <figure className="flex flex-col gap-2">
      <pre
        className="border-rule border-t-refused bg-surface text-mono leading-terminal border border-t-2 px-4 py-3 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap"
        data-refusal={tag}
      >
        <span className="text-muted-foreground select-none">$ </span>
        {command}
        {"\n"}
        {lines.map(({ remote, text }, at) => (
          // A printed line never moves: its place on the screen is its key.
          <span key={at}>
            {remote ? (
              <span className="text-muted-foreground">remote: </span>
            ) : null}
            <Printed tag={tag} text={text} />
            {"\n"}
          </span>
        ))}
      </pre>
      <figcaption className="text-label text-muted-foreground">
        The gate refuses in git&apos;s own output.
      </figcaption>
    </figure>
  );
};

/** The projects on the platform, each with its posture, or that the list did not come. */
const Projects = ({ projects }: { readonly projects: LandingProjects }) =>
  LandingProjects.match(projects, {
    Listed: ({ projects: listed }) => (
      <ul className="flex flex-col">
        {listed.map(({ posture, project }) => (
          <li
            className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2.5"
            data-project={project}
            key={project}
          >
            <AppLink
              className="text-want font-medium no-underline hover:underline"
              to={projectPath(project)}
            >
              {project}
            </AppLink>
            <PostureBadge label={postureLabel(posture)} posture={posture} />
          </li>
        ))}
      </ul>
    ),
    Unreachable: () => <UnreachableNotice />,
  });

/** The landing, as everyone reads it. */
export const LandingView = ({
  platformUrl,
  projects,
  webUrl,
}: {
  readonly platformUrl: string;
  readonly projects: LandingProjects;
  readonly webUrl: string;
}) => (
  <div className="tablet:px-8 mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
    <SkipLink />
    <Top />
    <main
      className="flex flex-1 flex-col gap-12 py-12 outline-none"
      id="main"
      tabIndex={-1}
    >
      <div className="flex flex-col gap-8">
        <div className="flex max-w-[60ch] flex-col gap-3">
          <h1 className="text-headline text-balance">{WHAT_IT_IS}</h1>
          <p className="text-body">
            <Lede />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <AppLink className={PRIMARY} data-action="asks" to={ASKS_PATH}>
            See the open asks
          </AppLink>
          <CommandLine command={installCommand(webUrl)} />
        </div>
        <Transcript platformUrl={platformUrl} />
      </div>

      <Part id="nouns" title="Four nouns">
        <dl className="flex flex-col gap-3">
          {NOUNS.map(({ means, noun }) => (
            <div
              className="tablet:grid tablet:grid-cols-[8rem_1fr] tablet:gap-4 flex flex-col gap-0.5"
              data-noun={noun.toLowerCase()}
              key={noun}
            >
              <dt className="text-want font-semibold">{noun}</dt>
              <dd className="text-body">{means}</dd>
            </div>
          ))}
        </dl>
      </Part>

      <Part id="loop" title="The loop, in six lines">
        <ol className="marker:text-muted-foreground text-body flex max-w-[70ch] list-decimal flex-col gap-2 pl-6 marker:tabular-nums">
          {LOOP.map((line, at) => (
            // The loop's order is its meaning: its place is its key.
            <li className="pl-1" key={at}>
              {line}
            </li>
          ))}
        </ol>
      </Part>

      <Part
        id="platform"
        title="What a platform can do that a setting on a code host cannot"
      >
        <ul className="flex max-w-[70ch] flex-col gap-4">
          {POWERS.map(({ lead, says }) => (
            <li className="text-body" key={lead}>
              <span className="font-semibold">{lead}</span> {says}
            </li>
          ))}
        </ul>
      </Part>

      <Part id="code" title="Read the code">
        <p className="text-body max-w-[70ch]">
          Code, asks, credit and the ledger of what a project holds back are
          public to everyone.
        </p>
        <Projects projects={projects} />
        <p className="text-ui">
          <AppLink className={LINK} to={ASKS_PATH}>
            All asks
          </AppLink>
        </p>
      </Part>
    </main>
    <footer className="border-rule text-ui flex flex-wrap gap-x-5 gap-y-2 border-t py-6">
      <AppLink className={ROW_LINK} to={docsPath()}>
        Docs
      </AppLink>
      <AppLink className={ROW_LINK} to={AGENTS_PATH}>
        For agents
      </AppLink>
      <a className={`${ROW_LINK} ${ID}`} href="/llms.txt">
        /llms.txt
      </a>
      <a className={`${ROW_LINK} ${ID}`} href={platformUrl}>
        {platformUrl.replace(/^https?:\/\//u, "")}
      </a>
    </footer>
  </div>
);
