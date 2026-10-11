/**
 * The import form: a signed-in person pastes a public repo's HTTPS URL,
 * may name a branch, picks the owner and the name, and presses Import. The
 * owner and the name follow the URL until the person changes them: the
 * URL's source namespace (`github.com/pallets`) when its host is one the
 * platform knows, else their handle; the URL's last segment as the name.
 * At a source namespace's address the owner is the address's, fixed.
 * Signed out, it says what would be imported and links to sign-in, coming
 * back to `here`. Props in, markup out: the route reads who is signed in,
 * sends the payload, and goes to the project once it is made.
 *
 * Nothing is imported until Import is pressed; nothing here asks a host
 * anything.
 */
import { Brand } from "@repo/brand";
import type { Handle, ShortName, SourceNamespace } from "@repo/protocol/ids";
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
import { importPayload, ownerChoices, prefillFrom } from "./prefill.ts";
import type { ImportPayload } from "./prefill.ts";

/** What the form starts with: a URL, and the owner and name it gives. */
export interface ImportPrefill {
  readonly url: string;
  readonly owner?: SourceNamespace;
  readonly name?: ShortName;
}

/** Who is importing, and what became of the last press. */
export interface Importer {
  /** The handle signed in in this browser; none signed out. */
  readonly handle: Option.Option<Handle>;
  /** Whether the browser is still learning who is signed in. */
  readonly checking?: boolean | undefined;
  /** Whether an import is on its way: the button waits. */
  readonly busy?: boolean | undefined;
  /** Sends the payload; the route goes to the project once it is made. */
  readonly onImport?: ((payload: ImportPayload) => void) | undefined;
  /** What the last import came back with, when it was refused. */
  readonly children?: ReactNode | undefined;
}

export interface ImportFormProps extends Importer {
  readonly prefill?: ImportPrefill | undefined;
  /** The owner the address fixes, at a source namespace's address. */
  readonly fixedOwner?: SourceNamespace | undefined;
  /** The page's own address, where sign-in comes back to. */
  readonly here: string;
}

/** The import as a command, for a reader in a terminal. */
export const importCommand = (project = "<owner>/<name>", url = "<url>") =>
  `${Brand.cli} init --project ${project} --import ${url}`;

const LINK = "decoration-rule font-medium underline hover:decoration-current";

/** A field's label and the words under it. */
const LABEL = "text-ui font-medium";

const HINT = "text-label text-muted-foreground font-normal";

/**
 * A text field in mono: 16 px on a phone, so it does not zoom on focus, and
 * without ligatures, as code shows what was typed (`://` stays three).
 */
const MONO_FIELD =
  "tablet:h-9 tablet:text-mono h-11 font-mono text-base [font-feature-settings:'calt'_0,'liga'_0]";

/** What Import says, by where the form stands: why it waits, or what it does. */
const IMPORT_WORDS = {
  busy: "Importing…",
  noName: "Name the project",
  noOwner: "No owner you may import under",
  noUrl: "Paste a repo's URL first",
  ready: "Import",
} as const;

/** Whether `url` is one the contract takes: a public HTTPS URL. */
const isHttps = (url: string) => /^https:\/\/\S+$/u.test(url.trim());

type FormState = keyof typeof IMPORT_WORDS;

/** Where the form stands: importing, waiting on a field, or ready. */
const formState = ({
  busy,
  owner,
  payload,
  url,
}: {
  readonly busy: boolean;
  readonly owner: string | undefined;
  readonly payload: Option.Option<ImportPayload>;
  readonly url: string;
}): FormState => {
  if (busy) {
    return "busy";
  }

  if (!isHttps(url)) {
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

/** The owner, fixed by the address: in sight, and in the form. */
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

/** What the hint under Owner says, by what may be chosen. */
const ownerHint = (fixed: boolean, choices: readonly string[]) => {
  if (fixed) {
    return "The address names it: the project keeps its source's account.";
  }

  return choices.length > 1
    ? "The URL's own account, or your handle."
    : "Your handle: this URL's host is not one a project may be owned by.";
};

/** Under Name: the project's address once the name is one, else what a name is. */
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
  children,
  fixedOwner,
  handle,
  onImport,
  prefill,
}: Pick<
  ImportFormProps,
  "busy" | "children" | "fixedOwner" | "handle" | "onImport" | "prefill"
>) => {
  const id = useId();
  const [url, setUrl] = useState(prefill?.url ?? "");
  const [branch, setBranch] = useState("");
  const [chosen, setChosen] = useState<string | undefined>(prefill?.owner);
  const [typed, setTyped] = useState<string | undefined>(prefill?.name);

  const choices =
    fixedOwner === undefined ? ownerChoices(handle, url) : [fixedOwner];

  const owner = choices.find((choice) => choice === chosen) ?? choices[0];

  const name: string =
    typed ?? Option.getOrElse(prefillFrom(url).name, () => "");

  const payload =
    owner === undefined
      ? Option.none()
      : importPayload({ branch, name, owner, url });

  const state = formState({ busy, owner, payload, url });

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
          readOnly={busy}
          required
          spellCheck={false}
          type="url"
          value={url}
        />
        <p className={HINT} id={`${id}-url-hint`}>
          Any public repo over HTTPS: GitHub, GitLab, Codeberg, Bitbucket or
          another host.
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
            value={owner ?? ""}
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

      {children}

      <div className="flex flex-col gap-2">
        <Button
          // Waiting for a URL or a name, it says so at full strength, dashed
          // like any field still to fill, rather than sitting grey.
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

/** The form, the way to sign in, or the wait while the browser learns who is signed in. */
export const ImportForm = ({
  busy,
  checking = false,
  children,
  fixedOwner,
  handle,
  here,
  onImport,
  prefill,
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
    >
      {children}
    </Form>
  ) : (
    <SignInToImport fixedOwner={fixedOwner} here={here} prefill={prefill} />
  );
};
