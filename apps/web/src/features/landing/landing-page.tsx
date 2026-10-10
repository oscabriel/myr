/**
 * The landing: what the platform is, said once, and the way to the open
 * asks first. Its evidence is the screen `git push` prints when the gate
 * refuses, set as git sets it, not a picture of one. Every sentence on it is
 * the README's or the glossary's. A view: the platform's address, the web's
 * own and the projects in; markup out.
 */
import { Brand } from "@repo/brand";
import type { ReactNode } from "react";

import { Skeleton } from "../../components/ui/skeleton.tsx";
import { signInHref } from "../auth/session-slot.tsx";
import { postureLabel } from "../project/posture-label.ts";
import { CommandLine } from "../shared/command.tsx";
import { SkipLink } from "../shared/layout.tsx";
import { AppLink } from "../shared/link.tsx";
import {
  ASKS_PATH,
  docsPath,
  HOME_PATH,
  projectPath,
} from "../shared/paths.ts";
import { LandingProjects } from "./projects.ts";
import { pushTranscript } from "./transcript.ts";

/** The README's opening line: what the platform is. */
const WHAT_IT_IS =
  "A Git platform for the boundary between a project and everyone else.";

/** Running text's link: ink, underlined in the hairline colour. */
const LINK =
  "decoration-rule hover:decoration-foreground underline underline-offset-4";

/** A link in a plain row: muted, ink on hover, no underline. */
const QUIET =
  "text-muted-foreground hover:text-foreground no-underline transition-colors duration-150";

/** Text git prints or takes, inside a sentence. */
const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono">{children}</code>
);

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

/** The four nouns a contributor meets, in the README's words. */
const NOUNS: readonly (readonly [string, string, ReactNode])[] = [
  [
    "ask",
    "An ask",
    <>
      a file on <Code>main</Code> stating one change the project wants, with a
      territory and a check that fails on <Code>main</Code>.
    </>,
  ],
  [
    "answer",
    "An answer",
    "a commit in the claimant's fork, offered for one ask.",
  ],
  [
    "check",
    "A check",
    "what judges the answer, run by the platform on the exact merged tree.",
  ],
  ["refusal", "A refusal", "what the platform returns instead of landing."],
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

/** What a platform can do that a setting on a code host cannot, one sentence each. */
const CAN: readonly (readonly [string, ReactNode])[] = [
  [
    "Judge with checks the answer cannot touch.",
    <>
      A push that edits the files that decide what the checks do, or adds a{" "}
      <Code>.skip</Code> or a lint disable without a reason, is refused at the
      push.
    </>,
  ],
  [
    "Hold checks back.",
    "A maintainer's held-back checks run on every answer, and the answerer learns one result per area.",
  ],
  [
    "Refuse in git's own words.",
    <>
      A refusal is a member of one closed, typed union, printed in{" "}
      <Code>git push</Code>&apos;s <Code>remote:</Code> lines with the command
      to run next and whether retrying can help.
    </>,
  ],
  [
    "Give an ask one claimant.",
    "A claim is an exclusive, expiring right to answer an ask, so two agents never race on the same change.",
  ],
  [
    "Credit the asker too.",
    <>
      A landing names every person by trailer (<Code>Asked-by</Code>,{" "}
      <Code>Signed-off-by</Code>, <Code>Decided-by</Code> and more), and an
      agent is disclosed, never credited.
    </>,
  ],
];

/** The wordmark and the ways in, as a plain row. */
const Top = () => (
  <header className="border-rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-4">
    <AppLink className="text-want font-semibold no-underline" to="/">
      {Brand.name}
    </AppLink>
    <nav aria-label="Site" className="text-ui flex flex-wrap gap-x-5 gap-y-1">
      <AppLink className={QUIET} to={ASKS_PATH}>
        Asks
      </AppLink>
      <AppLink className={QUIET} to={docsPath()}>
        Docs
      </AppLink>
      <AppLink className={QUIET} to="/agents">
        For agents
      </AppLink>
      <a className={QUIET} href={signInHref(HOME_PATH)}>
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

/** The projects on the platform, each with its posture, and the way to every ask. */
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
            <span
              className="text-ui text-muted-foreground"
              data-posture={posture}
            >
              {postureLabel(posture)}
            </span>
          </li>
        ))}
      </ul>
    ),
    Pending: () => (
      <div aria-busy="true" className="flex flex-col">
        <output className="sr-only">Reading from the platform</output>
        {["first", "second", "third"].map((row) => (
          <div
            aria-hidden="true"
            className="border-rule flex h-11 items-center border-b"
            key={row}
          >
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    ),
    Unreachable: () => (
      <p className="text-body">
        The projects did not come: the platform did not answer. Git and the CLI
        reach it directly.
      </p>
    ),
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
    <main className="flex flex-1 flex-col gap-12 py-12" id="main">
      <div className="flex flex-col gap-8">
        <div className="flex max-w-[60ch] flex-col gap-3">
          <h1 className="text-headline text-balance">{WHAT_IT_IS}</h1>
          <p className="text-body">
            Everything a project ships is public, its contribution process is
            typed code on <Code>main</Code>, and a push lands only by passing a
            typed gate.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <AppLink
            className="bg-primary text-primary-foreground hover:bg-primary/80 text-ui inline-flex h-9 items-center px-3 font-medium no-underline transition-colors duration-150"
            data-action="asks"
            to={ASKS_PATH}
          >
            See the open asks
          </AppLink>
          <CommandLine command={`curl -fsSL ${webUrl}/install.sh | sh`} />
        </div>
        <Transcript platformUrl={platformUrl} />
      </div>

      <Part id="nouns" title="Four nouns">
        <dl className="flex flex-col gap-3">
          {NOUNS.map(([noun, term, meaning]) => (
            <div
              className="tablet:grid tablet:grid-cols-[8rem_1fr] tablet:gap-4 flex flex-col gap-0.5"
              data-noun={noun}
              key={noun}
            >
              <dt className="text-want font-semibold">{term}</dt>
              <dd className="text-body">{meaning}</dd>
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
          {CAN.map(([lead, sentence]) => (
            <li className="text-body" key={lead}>
              <span className="font-semibold">{lead}</span> {sentence}
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
      <AppLink className={QUIET} to={docsPath()}>
        Docs
      </AppLink>
      <AppLink className={QUIET} to="/agents">
        For agents
      </AppLink>
      <a className={QUIET} href="/llms.txt">
        /llms.txt
      </a>
      <a className={`${QUIET} text-mono font-mono`} href={platformUrl}>
        {platformUrl.replace(/^https?:\/\//u, "")}
      </a>
    </footer>
  </div>
);
