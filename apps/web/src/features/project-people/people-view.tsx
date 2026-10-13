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
import { LEDGER_ANCHOR, visibilityPath } from "../shared/paths.ts";
import { Workspace } from "../shared/shell/workspace.tsx";

type Vouches = PublicPolicy["vouches"];

const PROJECT_FILE = `${Brand.configDir}/project.ts`;

const CONFIG_DIR = `${Brand.configDir}/`;

const HOUR_MS = 3_600_000;

const LINK = "decoration-rule underline hover:decoration-current";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const spanOf = (ms: number) => {
  if (ms % HOUR_MS !== 0) {
    return plural(Math.round(ms / 60_000), "minute", "minutes");
  }

  const hours = ms / HOUR_MS;

  return hours > 48 && hours % 24 === 0
    ? plural(hours / 24, "day", "days")
    : plural(hours, "hour", "hours");
};

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

const Handles = ({ handles }: { readonly handles: readonly Handle[] }) =>
  handles.map((handle, index) => (
    <Fragment key={handle}>
      {index === 0 ? null : ", "}
      <HandleLink handle={handle} />
    </Fragment>
  ));

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

const Deciders = ({
  deciders,
}: {
  readonly deciders: PublicPolicy["deciders"];
}) => (
  <Region id="deciders" title="Maintainers by path">
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
              <span
                className="text-muted-foreground"
                data-said=""
              >{` — ${note}`}</span>
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
      <p className="max-w-(--measure)">{vouchModes[vouch.mode]}</p>
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
          <Num>{`${plural(budget.decisionsPerDay, "decision", "decisions")} a day per maintainer; an undecided one takes its default after ${plural(budget.expireDays, "day", "days")}`}</Num>
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
    <p className="max-w-(--measure)">
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
      <AppLink
        className={LINK}
        hash={LEDGER_ANCHOR}
        to={visibilityPath(project)}
      >
        the ledger
      </AppLink>
      .
    </p>
  );

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
      <p className="max-w-(--measure)" data-source="defaults">
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
        <p className="max-w-(--measure) font-medium">
          <NotEvaluated at={pending.at} project={project} />
          {": the project has no "}
          <Code>{CONFIG_DIR}</Code>
          {
            " folder, and the defaults need a test command that the platform could not find in its CI or package files."
          }
        </p>
        <p className="text-ui max-w-(--measure)">
          {"To make it evaluate, a maintainer lands a "}
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
        <p className="max-w-(--measure) font-medium">
          <NotEvaluated at={pending.at} project={project} />
          {": "}
          <CodeLink to={treeHref(project, pending.at, Brand.configDir)}>
            {CONFIG_DIR}
          </CodeLink>
          {` at ${shortSha(pending.at)} did not evaluate.`}
        </p>
        <p className="text-ui max-w-(--measure)">
          {`Fix it by landing a change to ${CONFIG_DIR}.`}
        </p>
      </>
    )}
    <p className="text-ui text-muted-foreground">
      It is evaluated again at every landing.
    </p>
  </div>
);

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

const lines = (command: string, flags: readonly string[]) =>
  [command, ...flags].join(" \\\n  ");

const ChangeFacts = ({ project }: { readonly project: ProjectName }) => (
  <FactBlock label="How to change these">
    <p className="text-ui">
      {`Land a change to ${CONFIG_DIR}: open an ask for it, or, as a maintainer, land your own from a clone.`}
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
      label="Or land your own, as a maintainer"
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
