/**
 * The Visibility tab's Environment: each key's type, sensitivity, when it is
 * required and whether it is set. Never a value, and nothing that would take
 * or show one: `setEnv` is RPC and CLI alone. Lint keeps "shape" out of code
 * names, so the prop is `schema`.
 */
import { Brand } from "@repo/brand";
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { ProjectName } from "@repo/protocol/ids";
import { DateTime } from "effect";
import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { Definition, Definitions, Region } from "../ask/fields.tsx";
import { commitHref, shortSha } from "../code/paths.ts";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { AppLink } from "../shared/link.tsx";
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
      <Definition term="Sensitive">
        {item.sensitive
          ? "yes: its value is write-only"
          : "no: the platform holds no value for it"}
      </Definition>
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
  <p className="text-ui text-muted-foreground max-w-[70ch]">
    Declared in{" "}
    <a className={LINK} href={VARLOCK} rel="noreferrer">
      varlock&apos;s <Code>.env.schema</Code> format
    </a>
    . Values are never shown.
  </p>
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

const WhereRead = ({ schema }: { readonly schema: EnvSchemaView }) => (
  <div className="flex flex-col gap-1">
    <p className="text-label text-muted-foreground">Where it was read</p>
    <dl aria-label="Where the environment was read" className="flex flex-col">
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
  </div>
);

const SetValue = ({ project }: { readonly project: ProjectName }) => (
  <div className="flex flex-col gap-2">
    <p className="text-ui text-muted-foreground">
      A maintainer sets a sensitive value from a terminal; nobody reads it
      back.
    </p>
    <CommandLine
      command={`${Brand.cli} env set <KEY> --project ${project} --yes`}
      numbered
    />
  </div>
);

const Items = ({
  now,
  schema,
}: {
  readonly now: DateTime.Utc;
  readonly schema: EnvSchemaView;
}) => {
  const { items } = schema;
  const seen = readAt(schema, now);

  return (
    <>
      <p className="text-want" data-env-status="">
        {`${plural(items.length, "item", "items")} · ${sensitiveWords(items, seen)}`}
      </p>
      <WhereRead schema={schema} />
      {items.length === 0 ? (
        <EmptyState title="No env items: the landed .env.schema declares none, or the project commits none." />
      ) : (
        <ol aria-label="Env items" className="flex flex-col">
          {sensitiveFirst(items).map((item) => (
            <ItemRow item={item} key={item.key} now={seen} />
          ))}
        </ol>
      )}
      <SetValue project={schema.project} />
    </>
  );
};

/** `schema` is undefined until the project's main first lands: there is no .env.schema to read before it. */
export const EnvironmentRegion = ({
  now,
  project,
  schema,
}: {
  readonly now: DateTime.Utc;
  readonly project: ProjectName;
  readonly schema: EnvSchemaView | undefined;
}) => (
  <Region id="environment" title="Environment">
    <Caption />
    {schema === undefined ? (
      <EmptyState
        command={`${Brand.cli} env shape --project ${project}`}
        title={`Nothing has landed in ${project} yet, so there is no .env.schema to read. Its environment appears here once its main lands.`}
      />
    ) : (
      <Items now={now} schema={schema} />
    )}
  </Region>
);
