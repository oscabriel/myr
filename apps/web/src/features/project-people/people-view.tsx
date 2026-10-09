/**
 * A project's people and permissions, as its config folder states them at
 * the landed commit: who decides which paths, the vouch rule and the vouch
 * file's lines, each layer's audience, readers and writers (from the
 * ledger, so the page works without the visibility cartridge), the caps,
 * budget and timings, and whether landings disclose agents. Each section
 * links the file it comes from at that commit.
 *
 * Props in, markup out: the route reads `projectPolicy` and `ledger`
 * (`src/client/{policy,ledger}.ts`) and hands them here. The page is
 * read-only: the one way to change any of it is to land a change to the
 * config folder, and it says so with the commands.
 */
import { Brand } from "@repo/brand";
import type { PublicPolicy } from "@repo/protocol/domain/policy";
import type {
  Disclosure,
  Layer,
  Ledger,
  Members,
} from "@repo/protocol/domain/visibility";
import type { Handle, ProjectName } from "@repo/protocol/ids";
import { Option } from "effect";
import { Fragment } from "react";
import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { CODE, Field, Fields, LINK, Region } from "../ask/fields.tsx";
import { ledgerPath } from "../ledger/path.ts";
import { ProjectNav } from "../project/project-nav.tsx";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";

type Vouches = PublicPolicy["vouches"];

/** The project's config file, `project.ts` in the config folder. */
const PROJECT_FILE = `${Brand.configDir}/project.ts`;

const HOUR_MS = 3_600_000;

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

/** A commit as git abbreviates it. */
const short = (sha: string) => sha.slice(0, 7);

/** A file at a commit, on the code browser. */
const blobPath = (project: ProjectName, at: string, path: string) =>
  `/${project}/blob/${at}/${path}`;

/** What a vouch gates, in words. */
const vouchModes = {
  all: "For everything: claiming an ask, offering a sealed answer and proposing an ask all need a vouch.",
  bansOnly:
    "Bans only: nobody needs a vouch, but a denounced person still may not claim, push or propose.",
  forCode:
    "For code: claiming an ask or offering a sealed answer needs a vouch; anyone not denounced may propose an ask.",
} as const satisfies Record<PublicPolicy["vouch"]["mode"], string>;

/** What people outside a layer's audience learn about what it holds. */
const disclosures = {
  counted: "counted: how many it holds, and when they open",
  declared: "declared: that it exists, with its kinds and reason",
  hidden: "hidden: nothing beyond its name",
  public: "public: everything",
  sealed: "sealed: counts, authors and a salted root, never contents",
  writeOnly: "write-only: who set each value and when, never a value",
} as const satisfies Record<Disclosure, string>;

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={CODE}>{children}</code>
);

/** Handles, each linked to their page, comma-separated. */
const Handles = ({ handles }: { readonly handles: readonly Handle[] }) =>
  handles.map((handle, index) => (
    <Fragment key={handle}>
      {index === 0 ? null : ", "}
      <HandleLink handle={handle} />
    </Fragment>
  ));

const MembersOf = ({ members }: { readonly members: Members }) =>
  members === "deciders" ? "the deciders" : <Handles handles={members} />;

/** "From <config folder>/project.ts", linked at the commit. */
const Source = ({
  href,
  path,
}: {
  readonly href: string;
  readonly path: string;
}) => (
  <p className="text-muted-foreground text-sm">
    {"From "}
    <a className={`${LINK} ${CODE}`} href={href}>
      {path}
    </a>
  </p>
);

const DecidersTable = ({
  deciders,
}: {
  readonly deciders: PublicPolicy["deciders"];
}) => (
  <Table className="text-sm">
    <TableHeader>
      <TableRow>
        <TableHead>Paths</TableHead>
        <TableHead>Deciders</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {deciders.map(({ handles, paths }) => (
        <TableRow data-paths={paths} key={paths}>
          <TableCell className="whitespace-normal">
            <Code>{paths}</Code>
          </TableCell>
          <TableCell className="whitespace-normal">
            <Handles handles={handles} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const VouchList = ({
  label,
  vouches,
}: {
  readonly label: string;
  readonly vouches: Vouches;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
    {vouches.length === 0 ? (
      <p className="text-sm">Nobody.</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
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
      <p className="max-w-[70ch] text-sm">{vouchModes[vouch.mode]}</p>
      {vouches.length === 0 ? (
        <p className="text-sm">
          <Code>{vouch.file}</Code> vouches for nobody and denounces nobody.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <VouchList label="Vouched for" vouches={vouched} />
          <VouchList label="Denounced" vouches={denounced} />
        </div>
      )}
      {policy.source === "config" || vouches.length > 0 ? (
        <Source
          href={blobPath(project, policy.at, vouch.file)}
          path={vouch.file}
        />
      ) : null}
    </Region>
  );
};

const LayerBlock = ({ layer }: { readonly layer: Layer }) => (
  <li className="flex min-w-0 flex-col gap-2" data-layer={layer.name}>
    <h3 className={`${CODE} font-medium`}>{layer.name}</h3>
    <Fields label={`Layer ${layer.name}`}>
      <Field label="Audience">{layer.audience}</Field>
      <Field label="Readers">
        <MembersOf members={layer.readers} />
      </Field>
      <Field label="Writers">
        <MembersOf members={layer.writers} />
      </Field>
      <Field label="Disclosure">{disclosures[layer.disclose]}</Field>
      <Field label="Reason">{layer.reason}</Field>
      {layer.sunsetDays === undefined ? null : (
        <Field label="Sunset">{`released after ${plural(layer.sunsetDays, "day", "days")}`}</Field>
      )}
    </Fields>
  </li>
);

const Layers = ({
  ledger,
  project,
}: {
  readonly ledger: Ledger;
  readonly project: ProjectName;
}) => (
  <Region id="layers" title="Layers">
    {ledger.layers.length === 0 ? (
      <EmptyState
        title={`Open: nothing is held back. ${project} declares no layers, so everyone reads and writes the same public repo.`}
      />
    ) : (
      <ul className="flex flex-col gap-6">
        {ledger.layers.map((layer) => (
          <LayerBlock key={layer.name} layer={layer} />
        ))}
      </ul>
    )}
    <p className="text-muted-foreground text-sm">
      {"Each layer's history is on "}
      <a className={LINK} href={ledgerPath(project)}>
        the ledger
      </a>
      .
    </p>
  </Region>
);

const Limits = ({
  policy,
  source,
}: {
  readonly policy: PublicPolicy;
  readonly source: ReactNode;
}) => {
  const { budget, caps, claims, record } = policy;

  return (
    <Region id="limits" title="Limits">
      <Fields label="Limits">
        <Field label="Claims">
          {`${plural(caps.claimsPerPerson, "claim", "claims")} per person at once`}
        </Field>
        <Field label="Proposals">
          {caps.proposalsPerPerson === 0
            ? "Proposals are off"
            : `${plural(caps.proposalsPerPerson, "proposal", "proposals")} per person at once`}
        </Field>
        <Field label="Budget">
          {`${plural(budget.decisionsPerDay, "decision", "decisions")} a day per decider; an undecided one takes its default after ${plural(budget.expireDays, "day", "days")}`}
        </Field>
        <Field label="Claim timing">
          {`warned after ${spanOf(claims.warnAfterMs)} without a push; lapses after ${spanOf(claims.lapseAfterMs)}`}
        </Field>
        <Field label="Record">
          {`a landing counts ${
            record.countsAfterDays === 0
              ? "from the day it lands"
              : `once it has stood ${plural(record.countsAfterDays, "day", "days")}`
          }, for ${plural(record.windowDays, "day", "days")}`}
        </Field>
      </Fields>
      {source}
    </Region>
  );
};

const Agents = ({
  policy,
  source,
}: {
  readonly policy: PublicPolicy;
  readonly source: ReactNode;
}) => (
  <Region id="agents" title="Agents">
    <p className="max-w-[70ch] text-sm">
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
    {source}
  </Region>
);

/** The page over an evaluated policy: its commit, then each section. */
const Evaluated = ({
  ledger,
  policy,
  project,
}: {
  readonly ledger: Ledger;
  readonly policy: PublicPolicy;
  readonly project: ProjectName;
}) => {
  const projectFile =
    policy.source === "config" ? (
      <Source
        href={blobPath(project, policy.at, PROJECT_FILE)}
        path={PROJECT_FILE}
      />
    ) : null;

  return (
    <>
      <p className="text-muted-foreground -mt-2 text-sm">
        {"As of "}
        <a
          className={`${LINK} ${CODE}`}
          href={`/${project}/commit/${policy.at}`}
        >
          {short(policy.at)}
        </a>
        , the landed commit.
      </p>
      {policy.source === "defaults" ? (
        <p className="max-w-[70ch]" data-source="defaults">
          {`This project has no ${PROJECT_FILE}: the person who set it up decides everything, under the platform's defaults.`}
        </p>
      ) : null}
      <Region id="deciders" title="Deciders by path">
        <DecidersTable deciders={policy.deciders} />
        {projectFile}
      </Region>
      <Vouching policy={policy} project={project} />
      <Layers ledger={ledger} project={project} />
      <Limits policy={policy} source={projectFile} />
      <Agents policy={policy} source={projectFile} />
    </>
  );
};

export const PeopleView = ({
  ledger,
  policy,
  project,
}: {
  readonly ledger: Ledger;
  readonly policy: Option.Option<PublicPolicy>;
  readonly project: ProjectName;
}): ReactNode => (
  <PageShell title={`${project}: people`}>
    <ProjectNav current="people" project={project} />
    {Option.isSome(policy) ? (
      <Evaluated ledger={ledger} policy={policy.value} project={project} />
    ) : (
      <>
        <EmptyState title="The config at the landed commit has not been evaluated yet. It is evaluated once per landing; this page shows it once that is done." />
        <Layers ledger={ledger} project={project} />
      </>
    )}
    <Region id="editing" title="Changing these">
      <p className="max-w-[70ch] text-sm">
        {`Change these by landing a change to ${Brand.configDir}/: open an ask for it, or, as a decider, land your own change.`}
      </p>
      <CommandLine
        command={`${Brand.cli} ask open <ask> --project ${project} --files <files> --yes`}
      />
      <CommandLine
        command={`${Brand.cli} land --project ${project} --base <base> --head $(git rev-parse HEAD) --message <message> --requestId land-$(git rev-parse HEAD) --yes`}
      />
    </Region>
  </PageShell>
);
