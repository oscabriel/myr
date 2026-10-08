/**
 * A project's env shape: every item its committed `.env.schema` declares,
 * parsed at the landed commit and never resolved (varlock.md §8.3 #6). Each
 * item shows its name, description, `@type` text, whether it is required,
 * whether it is sensitive, its `@proxy` hosts, docs and deprecation; a
 * sensitive item shows who set its value and when, or that nobody has.
 *
 * Never a value, and nothing that would take or show one: a value is set
 * only from a terminal (`setEnv` is RPC and CLI alone, spec §3.2), so the
 * page shows that command line instead of a form. The placeholder unlanded
 * code sees is not shown either: it is not a value, but it reads like one.
 *
 * Props in, markup out: the route reads the env shape
 * (`src/client/env.ts`) and hands it here. (Lint keeps "shape" out of code
 * names, so the prop is the env schema's view: `schema`.)
 */
import { Brand } from "@repo/brand";
import type { EnvItem, EnvSchemaView } from "@repo/protocol/domain/env";
import type { ProjectName } from "@repo/protocol/ids";
import { DateTime } from "effect";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { CODE, Field, Fields, LINK, Region } from "../ask/fields.tsx";
import { CommandLine } from "../shared/command.tsx";
import { EmptyState } from "../shared/empty.tsx";
import { HandleLink } from "../shared/handle.tsx";
import { PageShell } from "../shared/layout.tsx";
import { When } from "../shared/time.tsx";

/** Where varlock, whose `.env.schema` format this is, documents it. */
const VARLOCK = "https://varlock.dev";

const Code = ({ children }: { readonly children: ReactNode }) => (
  <code className={CODE}>{children}</code>
);

/**
 * When the env shape was read, at the latest: `now`, or the newest time a
 * value was set if that is later. The page keeps the `now` it was served
 * with while it reads the env shape again as values are set, and a value
 * that was set is never set in the future.
 */
const readAt = (schema: EnvSchemaView, now: DateTime.Utc) => {
  let latest = now;

  for (const { value } of schema.items) {
    if (value !== undefined) {
      latest = DateTime.max(latest, value.setAt);
    }
  }

  return latest;
};

/** Whether `docs` is a web address, so a link to it can go nowhere else. */
const isWebAddress = (docs: string) => /^https?:\/\//iu.test(docs);

const requiredWords = (required: EnvItem["required"]) => {
  if (required === "depends") {
    return "depends on environment";
  }

  return required ? "yes" : "no";
};

const Sensitive = ({ sensitive }: { readonly sensitive: boolean }) =>
  sensitive ? (
    <span className="text-sealed inline-flex items-center gap-1.5">
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      yes
    </span>
  ) : (
    "no"
  );

const Proxy = ({
  proxy,
}: {
  readonly proxy: NonNullable<EnvItem["proxy"]>;
}) => (
  <span className="flex flex-col gap-0.5">
    <span>
      {proxy.domains.map((domain, at) => (
        <span key={domain}>
          {at === 0 ? null : ", "}
          <Code>{domain}</Code>
        </span>
      ))}
    </span>
    {proxy.path === undefined ? null : (
      <span className="text-muted-foreground text-xs">
        only paths <Code>{proxy.path}</Code>
      </span>
    )}
    {proxy.method === undefined ? null : (
      <span className="text-muted-foreground text-xs">
        only <Code>{proxy.method}</Code> requests
      </span>
    )}
    {proxy.block === true ? (
      <span className="text-muted-foreground text-xs">
        every request is denied
      </span>
    ) : null}
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

/** Who set a write-only value and when, or that nobody has; never the value. */
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
      set by <HandleLink handle={value.setBy} />,{" "}
      <When at={value.setAt} now={now} />
    </span>
  );

const ItemBlock = ({
  item,
  now,
}: {
  readonly item: EnvItem;
  readonly now: DateTime.Utc;
}) => (
  <li
    className="flex min-w-0 flex-col gap-2"
    data-env-key={item.key}
    data-sensitive={item.sensitive}
  >
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className={`${CODE} font-medium`}>{item.key}</h3>
      {item.deprecated === true ? (
        <span className="border-rule text-muted-foreground border px-1.5 text-xs font-medium">
          Deprecated
        </span>
      ) : null}
    </div>
    {item.description === undefined || item.description === "" ? null : (
      <p className="max-w-[70ch]">{item.description}</p>
    )}
    <Fields label={`Env item ${item.key}`}>
      {item.type === undefined ? null : (
        <Field label="Type">
          <Code>{item.type}</Code>
        </Field>
      )}
      <Field label="Required">{requiredWords(item.required)}</Field>
      <Field label="Sensitive">
        <Sensitive sensitive={item.sensitive} />
      </Field>
      {item.proxy === undefined ? null : (
        <Field label="Proxy">
          <Proxy proxy={item.proxy} />
        </Field>
      )}
      {item.tags.length === 0 ? null : (
        <Field label="Tags">{item.tags.join(", ")}</Field>
      )}
      {item.docs === undefined ? null : (
        <Field label="Docs">
          <Docs docs={item.docs} />
        </Field>
      )}
      {item.sensitive ? (
        <Field label="Value">
          <Value now={now} value={item.value} />
        </Field>
      ) : null}
    </Fields>
  </li>
);

export const EnvView = ({
  now,
  schema,
}: {
  readonly now: DateTime.Utc;
  readonly schema: EnvSchemaView;
}) => {
  const { items, project } = schema;
  const seen = readAt(schema, now);

  return (
    <PageShell title={`Env shape of ${project}`}>
      <p className="text-muted-foreground -mt-4 text-sm">
        env shape:{" "}
        <a className={LINK} href={VARLOCK} rel="noreferrer">
          varlock&apos;s <code className={CODE}>.env.schema</code> format
        </a>
      </p>
      <Fields label="Where the env shape was read">
        <Field label="File">
          <Code>{schema.file}</Code>
        </Field>
        <Field label="At">
          <span title={schema.at}>
            <Code>{schema.at.slice(0, 7)}</Code>
          </span>
        </Field>
        {schema.currentEnvKey === undefined ? null : (
          <Field label="Environment">
            chosen by <Code>{schema.currentEnvKey}</Code>
          </Field>
        )}
        {schema.imports.length === 0 ? null : (
          <Field label="Imports">
            {schema.imports.join(", ")} (recorded, not merged)
          </Field>
        )}
        <Field label="Project">
          <a className={LINK} href={`/${project}`}>
            {project}
          </a>
        </Field>
      </Fields>
      <div className="flex flex-col gap-3">
        <p className="max-w-[70ch]">
          The schema {project} commits for its environment variables, as it
          stands on main; nothing in it is run. Values never appear here: a
          sensitive item says only who set its value and when. A decider sets
          one from a terminal, never on the web:
        </p>
        <CommandLine
          command={`${Brand.cli} env set <KEY> --project ${project} --yes`}
        />
      </div>
      <Region id="items" title="Items">
        {items.length === 0 ? (
          <EmptyState title="No env items: the landed .env.schema declares none, or the project commits none." />
        ) : (
          <ol className="flex flex-col gap-6">
            {items.map((item) => (
              <ItemBlock item={item} key={item.key} now={seen} />
            ))}
          </ol>
        )}
      </Region>
    </PageShell>
  );
};

/**
 * A project whose main has not landed yet: there is no landed
 * `.env.schema` to read, so there is no env shape, which is not the same as
 * no project.
 */
export const NothingLanded = ({
  project,
}: {
  readonly project: ProjectName;
}) => (
  <PageShell title={`Env shape of ${project}`}>
    <EmptyState
      command={`${Brand.cli} env shape --project ${project}`}
      title={`Nothing has landed in ${project} yet, so there is no .env.schema to read. Its env shape appears here once its main lands.`}
    />
  </PageShell>
);
