/**
 * Never a value, and nothing that would take or show one: `setEnv` is RPC and
 * CLI alone. Lint keeps "shape" out of code names, so the prop is `schema`.
 */
import { Brand } from "@repo/brand";
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { DateTime } from "effect";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { Definition, Definitions } from "../ask/fields.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import { postureLabel } from "../project/posture-label.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { FactBlock, PostureFacts } from "../shared/facts.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { distanceInWords, When } from "../shared/time.tsx";

const VARLOCK = "https://varlock.dev";

const LINK = "decoration-rule underline hover:decoration-current";

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className="text-mono font-mono [overflow-wrap:anywhere]">
    {children}
  </code>
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const readAt = (schema: EnvSchemaView, now: DateTime.Utc) => {
  let latest = now;

  for (const { value } of schema.items) {
    if (value !== undefined) {
      latest = DateTime.max(latest, value.setAt);
    }
  }

  return latest;
};

const sensitiveFirst = (items: readonly EnvItem[]) => [
  ...items.filter(({ sensitive }) => sensitive),
  ...items.filter(({ sensitive }) => !sensitive),
];

const newestSet = (items: readonly EnvItem[]) => {
  let newest: EnvItem["value"];

  for (const { value } of items) {
    if (
      value !== undefined &&
      (newest === undefined ||
        DateTime.isGreaterThan(value.setAt, newest.setAt))
    ) {
      newest = value;
    }
  }

  return newest;
};

const sensitiveWords = (items: readonly EnvItem[], now: DateTime.Utc) => {
  const sensitive = items.filter((item) => item.sensitive);
  const set = sensitive.filter(({ value }) => value !== undefined);
  const newest = newestSet(sensitive);

  if (sensitive.length === 0) {
    return "none sensitive";
  }

  if (newest === undefined) {
    return `${sensitive.length} sensitive, ${sensitive.length === 1 ? "not set" : "none set"}`;
  }

  const by = `by ${newest.setBy} ${distanceInWords(newest.setAt, now)}`;

  return sensitive.length === 1
    ? `1 sensitive, set ${by}`
    : `${sensitive.length} sensitive: ${set.length} set, latest ${by}`;
};

const isWebAddress = (docs: string) => /^https?:\/\//iu.test(docs);

const requiredWords = (required: EnvItem["required"]) => {
  if (required === "depends") {
    return "depends on environment";
  }

  return required ? "yes" : "no";
};

const Proxy = ({
  proxy,
}: {
  readonly proxy: NonNullable<EnvItem["proxy"]>;
}) => (
  <span>
    <Code>{proxy.domains.join(", ")}</Code>
    {proxy.path === undefined ? null : (
      <>
        , only <Code>{proxy.path}</Code>
      </>
    )}
    {proxy.method === undefined ? null : (
      <>
        , only <Code>{proxy.method}</Code> requests
      </>
    )}
    {proxy.block === true ? "; every request is denied" : null}
  </span>
);

const Docs = ({ docs }: { readonly docs: string }) =>
  isWebAddress(docs) ? (
    <a
      className={`${LINK} [overflow-wrap:anywhere]`}
      href={docs}
      rel="noreferrer"
    >
      {docs}
    </a>
  ) : (
    <span className="[overflow-wrap:anywhere]">{docs}</span>
  );

const Value = ({
  now,
  value,
}: {
  readonly now: DateTime.Utc;
  readonly value: EnvItem["value"];
}) =>
  value === undefined ? (
    <span className="text-muted-foreground">not set</span>
  ) : (
    <span>
      set by <HandleLink handle={value.setBy} />{" "}
      <When at={value.setAt} now={now} />
    </span>
  );

const ItemLine = ({
  item,
  now,
}: {
  readonly item: EnvItem;
  readonly now: DateTime.Utc;
}) => (
  <div
    className="text-ui flex flex-wrap items-baseline gap-x-3 gap-y-1"
    data-env-line=""
  >
    <h3 className="font-mono font-medium [overflow-wrap:anywhere]">
      {item.key}
    </h3>
    {item.sensitive ? (
      <>
        <span
          className="text-sealed inline-flex items-center gap-1.5 self-center font-medium"
          data-env-sensitive=""
        >
          <LockKeyhole
            aria-hidden="true"
            className="size-4 shrink-0"
            strokeWidth={1.75}
          />
          sensitive
        </span>
        <Value now={now} value={item.value} />
      </>
    ) : null}
    {item.deprecated === true ? (
      <span className="border-rule text-label text-muted-foreground border px-1.5">
        Deprecated
      </span>
    ) : null}
  </div>
);

const ItemRow = ({
  item,
  now,
}: {
  readonly item: EnvItem;
  readonly now: DateTime.Utc;
}) => (
  <li
    className="flex min-w-0 flex-col gap-2 pt-8 first:pt-0"
    data-env-key={item.key}
    data-sensitive={item.sensitive}
  >
    <ItemLine item={item} now={now} />
    {item.description === undefined || item.description === "" ? null : (
      <p className="max-w-[70ch] text-pretty">{item.description}</p>
    )}
    <Definitions label={`Env item ${item.key}`}>
      {item.type === undefined ? null : (
        <Definition term="Type">
          <Code>{item.type}</Code>
        </Definition>
      )}
      <Definition term="Required">{requiredWords(item.required)}</Definition>
      {item.proxy === undefined ? null : (
        <Definition term="Proxy">
          <Proxy proxy={item.proxy} />
        </Definition>
      )}
      {item.tags.length === 0 ? null : (
        <Definition term="Tags">{item.tags.join(", ")}</Definition>
      )}
      {item.docs === undefined ? null : (
        <Definition term="Docs">
          <Docs docs={item.docs} />
        </Definition>
      )}
    </Definitions>
  </li>
);

const Caption = () => (
  <>
    env shape:{" "}
    <a className={LINK} href={VARLOCK} rel="noreferrer">
      varlock&apos;s <Code>.env.schema</Code> format
    </a>
  </>
);

const Read = ({
  children,
  term,
}: {
  readonly children: ReactNode;
  readonly term: string;
}) => (
  <div className="flex min-h-8 min-w-0 items-baseline gap-3 py-1">
    <dt className="text-label text-muted-foreground w-24 shrink-0">{term}</dt>
    <dd className="text-ui min-w-0 flex-1 [overflow-wrap:anywhere]">
      {children}
    </dd>
  </div>
);

const SetValueFacts = ({ project }: { readonly project: ProjectName }) => (
  <FactBlock label="Set a value">
    <p className="text-ui text-muted-foreground">
      A maintainer sets one from a terminal; nobody reads it back.
    </p>
    <CommandLine
      command={`${Brand.cli} env set <KEY> --project ${project} --yes`}
      numbered
    />
  </FactBlock>
);

const PostureOf = ({
  posture,
  project,
}: {
  readonly posture: Posture | undefined;
  readonly project: ProjectName;
}) =>
  posture === undefined ? null : (
    <PostureFacts
      label={postureLabel(posture)}
      posture={posture}
      project={project}
    />
  );

const Facts = ({
  posture,
  schema,
}: {
  readonly posture: Posture | undefined;
  readonly schema: EnvSchemaView;
}) => (
  <>
    <FactBlock label="Where it was read">
      <dl aria-label="Where the env shape was read" className="flex flex-col">
        <Read term="File">
          <Code>{schema.file}</Code>
        </Read>
        <Read term="At">
          <AppLink
            className={`text-mono font-mono ${LINK}`}
            title={schema.at}
            to={commitHref(schema.project, schema.at)}
          >
            {shortSha(schema.at)}
          </AppLink>
          , landed
        </Read>
        {schema.currentEnvKey === undefined ? null : (
          <Read term="Environment">
            chosen by <Code>{schema.currentEnvKey}</Code>
          </Read>
        )}
        {schema.imports.length === 0 ? null : (
          <Read term="Imports">
            {schema.imports.join(", ")} (recorded, not merged)
          </Read>
        )}
      </dl>
    </FactBlock>
    <SetValueFacts project={schema.project} />
    <PostureOf posture={posture} project={schema.project} />
  </>
);

export const EnvView = ({
  now,
  posture,
  schema,
}: {
  readonly now: DateTime.Utc;
  readonly posture?: Posture | undefined;
  readonly schema: EnvSchemaView;
}) => {
  const { items } = schema;
  const seen = readAt(schema, now);

  return (
    <Workspace
      facts={<Facts posture={posture} schema={schema} />}
      factsHeading="This env shape"
      meta={<Caption />}
      status={
        <p className="text-want" data-env-status="">
          {`${plural(items.length, "item", "items")} · ${sensitiveWords(items, seen)}`}
        </p>
      }
      title="Env shape"
    >
      {items.length === 0 ? (
        <EmptyState title="No env items: the landed .env.schema declares none, or the project commits none." />
      ) : (
        <ol aria-label="Env items" className="flex flex-col">
          {sensitiveFirst(items).map((item) => (
            <ItemRow item={item} key={item.key} now={seen} />
          ))}
        </ol>
      )}
    </Workspace>
  );
};

export const NothingLanded = ({
  project,
}: {
  readonly project: ProjectName;
}) => (
  <Workspace meta={<Caption />} title="Env shape">
    <EmptyState
      command={`${Brand.cli} env shape --project ${project}`}
      title={`Nothing has landed in ${project} yet, so there is no .env.schema to read. Its env shape appears here once its main lands.`}
    />
  </Workspace>
);
