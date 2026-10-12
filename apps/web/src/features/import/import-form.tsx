import { Brand } from "@repo/brand";
import type {
  Handle,
  Owner,
  ShortName,
  SourceNamespace,
} from "@repo/protocol/ids";
import { Option } from "effect";
import { LogIn } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { signInHref } from "../auth/session-slot.tsx";
import { CommandLine } from "../shared/command.tsx";
import { ClientOwnerSelect } from "./client-owner.tsx";
import {
  importPayload,
  importSourceOf,
  ownerChoices,
  ownerOfNamespace,
  prefillFrom,
} from "./prefill.ts";
import type { ImportPayload } from "./prefill.ts";

export interface ImportPrefill {
  readonly url: string;
  readonly owner?: SourceNamespace | undefined;
  readonly name?: ShortName | undefined;
}

export interface Importer {
  readonly handle: Option.Option<Handle>;
  readonly checking?: boolean | undefined;
  readonly busy?: boolean | undefined;
  readonly onImport?: ((payload: ImportPayload) => void) | undefined;
  readonly refusal?: ReactNode | undefined;
}

export interface ImportFormProps extends Importer {
  readonly prefill?: ImportPrefill | undefined;
  readonly fixedOwner?: SourceNamespace | undefined;
  readonly here: string;
}

export const importCommand = (project = "<owner>/<name>", url = "<url>") =>
  `${Brand.cli} init --project ${project} --import ${url}`;

const LINK = "decoration-rule font-medium underline hover:decoration-current";

const LABEL = "text-ui font-medium";

const HINT = "text-label text-muted-foreground font-normal";

const MONO_FIELD =
  "tablet:h-9 tablet:text-mono h-11 font-mono text-base [font-feature-settings:'calt'_0,'liga'_0]";

const IMPORT_WORDS = {
  busy: "Importing…",
  noName: "Name the project",
  noOwner: "No owner you may import under",
  noUrl: "Paste a repo's URL first",
  ready: "Import",
} as const;

type FormState = keyof typeof IMPORT_WORDS;

const formState = ({
  branch,
  busy,
  owner,
  payload,
  url,
}: {
  readonly busy: boolean;
  readonly owner: Owner | undefined;
  readonly payload: Option.Option<ImportPayload>;
  readonly url: string;
  readonly branch: string;
}): FormState => {
  if (busy) {
    return "busy";
  }

  if (Option.isNone(importSourceOf({ branch, url }))) {
    return "noUrl";
  }

  if (owner === undefined) {
    return "noOwner";
  }

  return Option.isSome(payload) ? "ready" : "noName";
};

const SignInToImport = ({
  fixedOwner,
  here,
  prefill,
}: Pick<ImportFormProps, "fixedOwner" | "here" | "prefill">) => {
  const name = prefill?.name;

  const project =
    fixedOwner === undefined || name === undefined
      ? undefined
      : `${fixedOwner}/${name}`;

  return (
    <section
      aria-label="Sign in to import"
      className="flex max-w-[70ch] flex-col items-start gap-4"
    >
      {prefill === undefined || prefill.url === "" ? null : (
        <dl className="border-rule flex w-full flex-col border-y">
          <div className="flex flex-col gap-0.5 py-2.5">
            <dt className={HINT}>Repo URL</dt>
            <dd className="text-mono font-mono [overflow-wrap:anywhere]">
              <code>{prefill.url}</code>
            </dd>
          </div>
          {project === undefined ? null : (
            <div className="border-rule flex flex-col gap-0.5 border-t py-2.5">
              <dt className={HINT}>Project</dt>
              <dd className="text-mono font-mono [overflow-wrap:anywhere]">
                <code>{project}</code>
              </dd>
            </div>
          )}
        </dl>
      )}
      <p className="text-ui flex items-start gap-2">
        <LogIn
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={1.75}
        />
        <span>
          Importing is for signed-in people.{" "}
          <a className={LINK} href={signInHref(here)}>
            Sign in
          </a>{" "}
          to import it here, or import from a terminal:
        </span>
      </p>
      <CommandLine
        command={importCommand(
          project,
          prefill === undefined || prefill.url === "" ? undefined : prefill.url
        )}
      />
    </section>
  );
};

const FixedOwner = ({
  hintId,
  owner,
}: {
  readonly hintId: string;
  readonly owner: SourceNamespace;
}) => (
  <>
    <p aria-describedby={hintId} className="text-want font-medium">
      {owner}
    </p>
    <input name="owner" type="hidden" value={owner} />
  </>
);

const ownerHint = (fixed: boolean, choices: readonly Owner[]) => {
  if (fixed) {
    return "The address names it: the project keeps its source's account.";
  }

  return choices.length > 1
    ? "The URL's own account, or your handle."
    : "Your handle: this URL's host is not one a project may be owned by.";
};

const NameHint = ({
  payload,
}: {
  readonly payload: Option.Option<ImportPayload>;
}) =>
  Option.match(payload, {
    onNone: () =>
      "Lowercase letters and digits, joined by single dots, dashes or underscores.",
    onSome: ({ project }) => (
      <>
        The project&apos;s address:{" "}
        <code className="text-mono text-foreground font-mono [overflow-wrap:anywhere]">
          /{project}
        </code>
      </>
    ),
  });

const Form = ({
  busy = false,
  fixedOwner,
  handle,
  onImport,
  prefill,
  refusal,
}: Pick<
  ImportFormProps,
  "busy" | "fixedOwner" | "handle" | "onImport" | "prefill" | "refusal"
>) => {
  const id = useId();
  const [url, setUrl] = useState(prefill?.url ?? "");
  const [branch, setBranch] = useState("");
  const [chosen, setChosen] = useState<string | undefined>(prefill?.owner);
  const [typed, setTyped] = useState<string | undefined>(prefill?.name);

  const choices =
    fixedOwner === undefined
      ? ownerChoices(handle, url)
      : Option.toArray(ownerOfNamespace(fixedOwner));

  const owner = choices.find((choice) => choice === chosen) ?? choices[0];

  const name: string =
    typed ?? Option.getOrElse(prefillFrom(url).name, () => "");

  const payload =
    owner === undefined
      ? Option.none()
      : importPayload({ branch, name, owner, url });

  const state = formState({ branch, busy, owner, payload, url });

  return (
    <form
      aria-label="Import a repo"
      className="flex max-w-[70ch] flex-col gap-6"
      data-import=""
      onSubmit={(event) => {
        event.preventDefault();

        if (!busy && Option.isSome(payload)) {
          onImport?.(payload.value);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-url`}>
          Repo URL
        </label>
        <Input
          aria-describedby={`${id}-url-hint`}
          autoCapitalize="off"
          autoComplete="off"
          className={MONO_FIELD}
          id={`${id}-url`}
          inputMode="url"
          name="url"
          onChange={(event) => {
            setUrl(event.target.value);
          }}
          placeholder="https://github.com/pallets/click"
          readOnly={busy || fixedOwner !== undefined}
          required
          spellCheck={false}
          type="url"
          value={url}
        />
        <p className={HINT} id={`${id}-url-hint`}>
          {fixedOwner === undefined
            ? "Any public repo over HTTPS: GitHub, GitLab, Codeberg, Bitbucket or another host."
            : "Rebuilt from this page's address."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-branch`}>
          Branch <span className={HINT}>(optional)</span>
        </label>
        <Input
          aria-describedby={`${id}-branch-hint`}
          autoCapitalize="off"
          autoComplete="off"
          className={`${MONO_FIELD} max-w-sm`}
          id={`${id}-branch`}
          name="branch"
          onChange={(event) => {
            setBranch(event.target.value);
          }}
          readOnly={busy}
          spellCheck={false}
          value={branch}
        />
        <p className={HINT} id={`${id}-branch-hint`}>
          Left empty, the repo&apos;s default branch.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL} id={`${id}-owner`}>
          Owner
        </span>
        {fixedOwner === undefined ? (
          <ClientOwnerSelect
            choices={choices}
            describedBy={`${id}-owner-hint`}
            labelledBy={`${id}-owner`}
            onChange={setChosen}
            value={owner}
          />
        ) : (
          <FixedOwner hintId={`${id}-owner-hint`} owner={fixedOwner} />
        )}
        <p className={HINT} id={`${id}-owner-hint`}>
          {ownerHint(fixedOwner !== undefined, choices)}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-name`}>
          Name
        </label>
        <Input
          aria-describedby={`${id}-name-hint`}
          autoCapitalize="off"
          autoComplete="off"
          className={`${MONO_FIELD} max-w-sm`}
          id={`${id}-name`}
          name="name"
          onChange={(event) => {
            setTyped(event.target.value);
          }}
          readOnly={busy}
          required
          spellCheck={false}
          value={name}
        />
        <p className={HINT} id={`${id}-name-hint`}>
          <NameHint payload={payload} />
        </p>
      </div>

      {refusal}

      <div className="flex flex-col gap-2">
        <Button
          className={`tablet:h-9 tablet:w-fit h-11 w-full min-w-28 px-4 ${state === "ready" || state === "busy" ? "" : "text-muted-foreground border-dashed disabled:opacity-100"}`}
          data-state={state}
          disabled={state !== "ready"}
          type="submit"
          variant={
            state === "ready" || state === "busy" ? "default" : "outline"
          }
        >
          {busy ? <Spinner /> : null}
          {IMPORT_WORDS[state]}
        </Button>
        <output aria-live="polite" className={HINT}>
          {busy
            ? "The platform is cloning the repo; an import takes up to half a minute. Stay on this page."
            : null}
        </output>
      </div>
    </form>
  );
};

export const ImportForm = ({
  busy,
  checking = false,
  fixedOwner,
  handle,
  here,
  onImport,
  prefill,
  refusal,
}: ImportFormProps): ReactNode => {
  if (checking) {
    return (
      <output className="text-ui text-muted-foreground block">
        Checking who is signed in
      </output>
    );
  }

  return Option.isSome(handle) ? (
    <Form
      busy={busy}
      fixedOwner={fixedOwner}
      handle={handle}
      onImport={onImport}
      prefill={prefill}
      refusal={refusal}
    />
  ) : (
    <SignInToImport fixedOwner={fixedOwner} here={here} prefill={prefill} />
  );
};
