/**
 * A project's policy (its section reads "Policy"; its address stays
 * `/$project/people`), as its config folder states it at the landed
 * commit: who decides which paths, the vouch rule and the vouch file's
 * lines, the caps, budget and timings, and whether landings disclose
 * agents. The layers are one line that links the ledger, where who reads
 * and writes each one is told. The head says which commit and which file
 * it is read from; the inspector says how to change any of it.
 *
 * Props in, markup out: the route reads `projectPolicy` and `ledger`
 * (`src/client/{policy,ledger}.ts`) and hands them here. With no policy at
 * the landed commit, the page says why (`unevaluated`: no config folder, or
 * one that did not evaluate), names the commit and says what makes it
 * evaluate; with no reason either, nothing has landed yet. The page is
 * read-only: the one way to change any of it is to land a change to the
 * config folder, and it says so with the commands.
 */
import { Brand } from "@repo/brand";
import type { PolicyPending, PublicPolicy } from "@repo/protocol/domain/policy";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import { LockKeyhole } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";

import { Definition, Definitions, Region } from "../ask/fields.tsx";
import { blobHref, commitHref, shortSha, treeHref } from "../code/paths.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { ledgerPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";

type Vouches = PublicPolicy["vouches"];

/** The project's config file, `project.ts` in the config folder. */
const PROJECT_FILE = `${Brand.configDir}/project.ts`;

/** The config folder as a reader writes it: `<configDir>/`. */
const CONFIG_DIR = `${Brand.configDir}/`;

const HOUR_MS = 3_600_000;

const LINK = "decoration-rule underline hover:decoration-current";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** A claim timing as a reader says it: whole hours up to two days, then days. */
const spanOf = (ms: number) => {
  if (ms % HOUR_MS !== 0) {
    return plural(Math.round(ms / 60_000), "minute", "minutes");
  }

  const hours = ms / HOUR_MS;

  return hours > 48 && hours % 24 === 0
    ? plural(hours / 24, "day", "days")
    : plural(hours, "hour", "hours");
};

/** What a vouch gates, in words. */
const vouchModes = {
  all: "For everything: claiming an ask, offering a sealed answer and proposing an ask all need a vouch.",
  bansOnly:
    "Bans only: nobody needs a vouch, but a denounced person still may not claim, push or propose.",
  forCode:
    "For code: claiming an ask or offering a sealed answer needs a vouch; anyone not denounced may propose an ask.",
} as const satisfies Record<PublicPolicy["vouch"]["mode"], string>;

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono [overflow-wrap:anywhere]">
    {children}
  </code>
);

/** A file or a commit in running text: mono, linked. */
const CodeLink = ({
  children,
  to,
}: {
  readonly children: ReactNode;
  readonly to: string;
}) => (
  <AppLink className={`text-mono font-mono ${LINK}`} to={to}>
    {children}
  </AppLink>
);

/** Handles, each linked to their page, comma-separated. */
const Handles = ({ handles }: { readonly handles: readonly Handle[] }) =>
  handles.map((handle, index) => (
    <Fragment key={handle}>
      {index === 0 ? null : ", "}
      <HandleLink handle={handle} />
    </Fragment>
  ));

/** "As of 71fda27, from <config folder>/project.ts", each linked; or the platform's defaults. */
const AsOf = ({
  policy,
  project,
}: {
  readonly policy: PublicPolicy;
  readonly project: ProjectName;
}) => (
  <>
    {"As of "}
    <CodeLink to={commitHref(project, policy.at)}>
      {shortSha(policy.at)}
    </CodeLink>
    {policy.source === "config" ? (
      <>
        {", from "}
        <CodeLink to={blobHref(project, policy.at, PROJECT_FILE)}>
          {PROJECT_FILE}
        </CodeLink>
      </>
    ) : (
      ", under the platform's defaults"
    )}
  </>
);

/** Who decides each path: the path in mono, then its deciders. */
const Deciders = ({
  deciders,
}: {
  readonly deciders: PublicPolicy["deciders"];
}) => (
  <Region id="deciders" title="Deciders by path">
    <ul className="border-rule flex flex-col border-t">
      {deciders.map(({ handles, paths }) => (
        <li
          className="border-rule text-ui shell:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)] grid min-h-10 grid-cols-[minmax(7rem,40%)_minmax(0,1fr)] items-baseline gap-4 border-b py-2.5"
          data-paths={paths}
          key={paths}
        >
          <Code>{paths}</Code>
          <span className="min-w-0">
            <Handles handles={handles} />
          </span>
        </li>
      ))}
    </ul>
  </Region>
);

const VouchList = ({
  label,
  vouches,
}: {
  readonly label: string;
  readonly vouches: Vouches;
}) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <h3 className="text-label text-muted-foreground">{label}</h3>
    {vouches.length === 0 ? (
      <p className="text-ui text-muted-foreground">Nobody.</p>
    ) : (
      <ul className="text-ui flex flex-col gap-1">
        {vouches.map(({ handle, note }) => (
          <li
            className="[overflow-wrap:anywhere]"
            data-vouch={handle}
            key={handle}
          >
            <HandleLink handle={handle} />
            {note === undefined ? null : (
              <span className="text-muted-foreground">{` — ${note}`}</span>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const Vouching = ({
  policy,
  project,
}: {
  readonly policy: PublicPolicy;
  readonly project: ProjectName;
}) => {
  const { vouch, vouches } = policy;
  const denounced = vouches.filter((line) => line.denounced);
  const vouched = vouches.filter((line) => !line.denounced);

  return (
    <Region id="vouching" title="Vouching">
      <p className="max-w-[70ch]">{vouchModes[vouch.mode]}</p>
      {vouches.length === 0 ? (
        <p className="text-ui">
          <Code>{vouch.file}</Code> vouches for nobody and denounces nobody.
        </p>
      ) : (
        <div className="tablet:grid-cols-2 grid gap-6">
          <VouchList label="Vouched for" vouches={vouched} />
          <VouchList label="Denounced" vouches={denounced} />
        </div>
      )}
      {policy.source === "config" || vouches.length > 0 ? (
        <p className="text-ui text-muted-foreground">
          {"From "}
          <CodeLink to={blobHref(project, policy.at, vouch.file)}>
            {vouch.file}
          </CodeLink>
        </p>
      ) : null}
    </Region>
  );
};

/** A number a reader compares: set in tabular figures. */
const Num = ({ children }: { readonly children: string }) => (
  <span className="tabular-nums">{children}</span>
);

const Limits = ({ policy }: { readonly policy: PublicPolicy }) => {
  const { budget, caps, claims, record } = policy;

  return (
    <Region id="limits" title="Limits">
      <Definitions label="Limits">
        <Definition term="Claims">
          <Num>{`${plural(caps.claimsPerPerson, "claim", "claims")} per person at once`}</Num>
        </Definition>
        <Definition term="Proposals">
          <Num>
            {caps.proposalsPerPerson === 0
              ? "Proposals are off"
              : `${plural(caps.proposalsPerPerson, "proposal", "proposals")} per person at once`}
          </Num>
        </Definition>
        <Definition term="Budget">
          <Num>{`${plural(budget.decisionsPerDay, "decision", "decisions")} a day per decider; an undecided one takes its default after ${plural(budget.expireDays, "day", "days")}`}</Num>
        </Definition>
        <Definition term="Claim timing">
          <Num>{`warned after ${spanOf(claims.warnAfterMs)} without a push; lapses after ${spanOf(claims.lapseAfterMs)}`}</Num>
        </Definition>
        <Definition term="Record">
          <Num>{`a landing counts ${
            record.countsAfterDays === 0
              ? "from the day it lands"
              : `once it has stood ${plural(record.countsAfterDays, "day", "days")}`
          }, for ${plural(record.windowDays, "day", "days")}`}</Num>
        </Definition>
      </Definitions>
    </Region>
  );
};

const Agents = ({ policy }: { readonly policy: PublicPolicy }) => (
  <Region id="agents" title="Agents">
    <p className="max-w-[70ch]">
      {policy.agents === "trailer" ? (
        <>
          Each landing names the agents its people worked through, in an{" "}
          <Code>Assisted-by:</Code> trailer.
        </>
      ) : (
        <>
          Landings carry no <Code>Assisted-by:</Code> trailer.
        </>
      )}
    </p>
  </Region>
);

/** The layers' one line: each by name and disclosure, and a link to the ledger. */
const LayersLine = ({
  ledger,
  project,
}: {
  readonly ledger: Ledger;
  readonly project: ProjectName;
}) =>
  ledger.layers.length === 0 ? (
    <p className="text-ui text-muted-foreground" data-layers="">
      {`Open: nothing is held back. ${project} declares no layers, so everyone reads and writes the same public repo.`}
    </p>
  ) : (
    <p className="text-ui" data-layers="">
      <span className="text-sealed inline-flex items-center gap-1.5 font-medium">
        <LockKeyhole
          aria-hidden="true"
          className="size-4 shrink-0 self-center"
          strokeWidth={1.75}
        />
        {`Held back in ${plural(ledger.layers.length, "layer", "layers")}:`}
      </span>{" "}
      {ledger.layers.map((layer, index) => (
        <Fragment key={layer.name}>
          {index === 0 ? null : ", "}
          <code
            className="text-mono text-sealed font-mono"
            data-layer={layer.name}
          >
            {layer.name}
          </code>
          {` (${layer.disclose})`}
        </Fragment>
      ))}
      {". Who reads and writes each, and its history, are on "}
      <AppLink className={LINK} to={ledgerPath(project)}>
        the ledger
      </AppLink>
      .
    </p>
  );

/**
 * The layers in one line, under a heading of their own: each by name and
 * disclosure, held back, and the ledger, where who reads and writes each
 * one is told. Nothing else.
 */
const Layers = ({
  ledger,
  project,
}: {
  readonly ledger: Ledger;
  readonly project: ProjectName;
}) => (
  <Region id="layers" title="Layers">
    <LayersLine ledger={ledger} project={project} />
  </Region>
);

/** The page over an evaluated policy: each of its sections. */
const Evaluated = ({
  ledger,
  policy,
  project,
}: {
  readonly ledger: Ledger;
  readonly policy: PublicPolicy;
  readonly project: ProjectName;
}) => (
  <>
    {policy.source === "defaults" ? (
      <p className="max-w-[70ch]" data-source="defaults">
        {`This project has no ${PROJECT_FILE}: the person who set it up decides everything, under the platform's defaults.`}
      </p>
    ) : null}
    <Deciders deciders={policy.deciders} />
    <Vouching policy={policy} project={project} />
    <Limits policy={policy} />
    <Agents policy={policy} />
    <Layers ledger={ledger} project={project} />
  </>
);

/** The landed commit, short and linked: "The config at the landed commit <sha> has not been evaluated". */
const NotEvaluated = ({
  at,
  project,
}: {
  readonly at: string;
  readonly project: ProjectName;
}) => (
  <>
    {"The config at the landed commit "}
    <CodeLink to={commitHref(project, at)}>{shortSha(at)}</CodeLink>
    {" has not been evaluated"}
  </>
);

/**
 * Why the config at the landed commit has not been evaluated, and what
 * makes it evaluate: a `project.ts` naming the test command, or a fix to
 * the folder that did not evaluate. Either way, it evaluates again at
 * every landing.
 */
const Pending = ({
  pending,
  project,
}: {
  readonly pending: PolicyPending;
  readonly project: ProjectName;
}) => (
  <div
    className="border-rule flex flex-col gap-3 border border-dashed px-4 py-5"
    data-unevaluated={pending.reason}
  >
    {pending.reason === "noConfig" ? (
      <>
        <p className="max-w-[70ch] font-medium">
          <NotEvaluated at={pending.at} project={project} />
          {": the project has no "}
          <Code>{CONFIG_DIR}</Code>
          {
            " folder, and the defaults need a test command that the platform could not find in its CI or package files."
          }
        </p>
        <p className="text-ui max-w-[70ch]">
          {"To make it evaluate, a decider lands a "}
          <Code>{PROJECT_FILE}</Code>
          {
            " that names the test command. In a clone, this prints the file the CLI proposes from the repo's own files; add the test command to it, commit it, and land it as the facts say."
          }
        </p>
        <CommandLine
          command={`${Brand.cli} init --project ${project} --dry-run`}
        />
      </>
    ) : (
      <>
        <p className="max-w-[70ch] font-medium">
          <NotEvaluated at={pending.at} project={project} />
          {": "}
          <CodeLink to={treeHref(project, pending.at, Brand.configDir)}>
            {CONFIG_DIR}
          </CodeLink>
          {` at ${shortSha(pending.at)} did not evaluate.`}
        </p>
        <p className="text-ui max-w-[70ch]">
          {`Fix it by landing a change to ${CONFIG_DIR}.`}
        </p>
      </>
    )}
    <p className="text-ui text-muted-foreground">
      It is evaluated again at every landing.
    </p>
  </div>
);

/** One way to change the policy: what it does, then its command, a flag to a line. */
const Step = ({
  command,
  label,
}: {
  readonly command: string;
  readonly label: string;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <p className="text-label text-muted-foreground">{label}</p>
    <CommandLine command={command} numbered />
  </div>
);

/** `command`, then each flag with its value on a line of its own. */
const lines = (command: string, flags: readonly string[]) =>
  [command, ...flags].join(" \\\n  ");

/** How the policy changes: by a landing to the config folder, never here. */
const ChangeFacts = ({ project }: { readonly project: ProjectName }) => (
  <FactBlock label="How to change these">
    <p className="text-ui">
      {`Land a change to ${CONFIG_DIR}: open an ask for it, or, as a decider, land your own from a clone.`}
    </p>
    <Step
      command={lines(`${Brand.cli} ask open <ask>`, [
        `--project ${project}`,
        "--files <files>",
        "--yes",
      ])}
      label="Open an ask for the change"
    />
    <Step
      command={lines(`${Brand.cli} land`, [
        `--project ${project}`,
        "--base <base>",
        "--head $(git rev-parse HEAD)",
        "--message <message>",
        "--requestId land-$(git rev-parse HEAD)",
        "--yes",
      ])}
      label="Or land your own, as a decider"
    />
  </FactBlock>
);

export const PeopleView = ({
  ledger,
  policy,
  project,
  unevaluated,
}: {
  readonly ledger: Ledger;
  readonly policy: Option.Option<PublicPolicy>;
  readonly project: ProjectName;
  /** Why there is no policy at the landed commit; none before the first landing. */
  readonly unevaluated: Option.Option<PolicyPending>;
}): ReactNode => (
  <Workspace
    facts={<ChangeFacts project={project} />}
    factsHeading="This policy"
    meta={
      Option.isSome(policy) ? (
        <AsOf policy={policy.value} project={project} />
      ) : undefined
    }
    title="Policy"
  >
    {Option.isSome(policy) ? (
      <Evaluated ledger={ledger} policy={policy.value} project={project} />
    ) : (
      <>
        {Option.isSome(unevaluated) ? (
          <Pending pending={unevaluated.value} project={project} />
        ) : (
          <EmptyState title="Nothing has landed yet. The config is evaluated at every landing; this page shows it once the first one lands." />
        )}
        <Layers ledger={ledger} project={project} />
      </>
    )}
  </Workspace>
);
