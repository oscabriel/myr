/**
 * The propose form: a signed-in member writes a want, may name the
 * territory it belongs to (one of the project's top folders), and lets the
 * platform's agent draft the ask file and its failing check from it,
 * checked by default. A line from the why page (`?about&line&at`) starts the
 * want with where it points. Props in, markup out: the route reads who is
 * signed in and the project's paths, sends the payload, and goes to the
 * proposal once it is made.
 *
 * Only the want, the territory and the draft box: the files are the
 * agent's to write, or a person's through `propose --files` in the CLI.
 */
import { Brand } from "@repo/brand";
import type { ProposeAsk } from "@repo/protocol/contracts";
import type { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import { Option } from "effect";
import { LogIn } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { signInHref } from "../auth/session-slot.tsx";
import { CommandLine } from "../shared/command.tsx";

/** What `proposeAsk` takes, from its one schema. */
export type ProposePayload = typeof ProposeAsk.payloadSchema.Type;

/** A line a why page points at: the file, the line and the commit it was read at. */
export interface About {
  readonly path: RepoPath;
  readonly line: number;
  readonly at: CommitSha;
}

/**
 * The form's fields as `proposeAsk`'s payload: the want trimmed, the
 * territory when one is named, and `draft: true` only when the box is
 * checked (the contract takes no `draft: false`).
 */
export const proposalPayload = (form: {
  readonly project: ProjectName;
  readonly want: string;
  readonly territory?: RepoPath;
  readonly draft: boolean;
}): ProposePayload => {
  const want = form.want.trim();

  const named =
    form.territory === undefined
      ? { project: form.project, want }
      : { project: form.project, territory: form.territory, want };

  return form.draft ? { ...named, draft: true } : named;
};

/** How a want about one line starts: `In \`src/format.ts\` line 12 at 4c2e6a8: `. */
export const wantAbout = ({ at, line, path }: About) =>
  `In \`${path}\` line ${line} at ${at.slice(0, 7)}: `;

/**
 * The form's address for `project`, at the line a why page names when it
 * names one: where the project page links, and where sign-in comes back to.
 */
export const proposeFormPath = (
  project: ProjectName,
  about: Option.Option<About> = Option.none()
) =>
  Option.match(about, {
    onNone: () => `/${project}/proposals/new`,
    onSome: ({ at, line, path }) =>
      `/${project}/proposals/new?${new URLSearchParams({ about: path, at, line: String(line) }).toString()}`,
  });

const LABEL = "text-muted-foreground text-xs font-medium";

const SignInFirst = ({
  about,
  project,
}: {
  readonly about: Option.Option<About>;
  readonly project: ProjectName;
}) => (
  <section
    aria-label="Sign in to propose"
    className="border-rule flex flex-col gap-3 border-t pt-4"
  >
    <p className="flex items-start gap-2 text-sm">
      <LogIn aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        Proposing an ask is for signed-in members.{" "}
        <a
          className="decoration-rule font-medium underline hover:decoration-current"
          href={signInHref(proposeFormPath(project, about))}
        >
          Sign in
        </a>{" "}
        to propose one, or propose from your clone:
      </span>
    </p>
    <CommandLine command={`${Brand.cli} propose --draft "<want>"`} />
  </section>
);

export const ProposeView = ({
  about,
  busy = false,
  children,
  modules,
  onPropose,
  project,
  signedIn,
}: {
  readonly project: ProjectName;
  readonly signedIn: boolean;
  readonly about: Option.Option<About>;
  /** The project's top folders, each a territory to choose. */
  readonly modules: readonly RepoPath[];
  /** Sends the payload; the route goes to the proposal once it is made. */
  readonly onPropose?: (payload: ProposePayload) => void;
  /** Whether a proposal is on its way: the button waits. */
  readonly busy?: boolean;
  /** What the last proposal came back with, when it was refused. */
  readonly children?: ReactNode;
}): ReactNode => {
  const id = useId();

  const [want, setWant] = useState(() =>
    Option.match(about, { onNone: () => "", onSome: wantAbout })
  );

  const [territory, setTerritory] = useState("");
  const [draft, setDraft] = useState(true);

  if (!signedIn) {
    return <SignInFirst about={about} project={project} />;
  }

  const chosen = modules.find((module) => module === territory);
  const written = want.trim().length > 0;

  return (
    <form
      aria-label="Propose an ask"
      className="flex max-w-[70ch] flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();

        if (written) {
          onPropose?.(
            proposalPayload(
              chosen === undefined
                ? { draft, project, want }
                : { draft, project, territory: chosen, want }
            )
          );
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-want`}>
          What should the project do that it does not do now?
        </label>
        <Textarea
          className="min-h-32 text-sm md:text-sm"
          id={`${id}-want`}
          name="want"
          onChange={(event) => {
            setWant(event.target.value);
          }}
          required
          value={want}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-territory`}>
          Territory (optional)
        </label>
        <select
          className="border-input bg-background h-9 w-full max-w-xs rounded-none border px-2 text-sm"
          id={`${id}-territory`}
          name="territory"
          onChange={(event) => {
            setTerritory(event.target.value);
          }}
          value={territory}
        >
          <option value="">Let the agent choose</option>
          {modules.map((module) => (
            <option key={module} value={module}>
              {module}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          checked={draft}
          className="mt-0.5"
          id={`${id}-draft`}
          name="draft"
          onCheckedChange={(checked) => {
            setDraft(checked);
          }}
        />
        <Label className="text-sm leading-snug" htmlFor={`${id}-draft`}>
          Let the platform&apos;s agent draft the ask
        </Label>
      </div>
      <p className="text-muted-foreground -mt-3 pl-6 text-xs">
        It writes the ask file and a check that fails on main, runs it red
        first, and puts the draft to a decider. Clear the box to propose the
        want alone.
      </p>

      {children}

      <Button
        className="h-11 w-full px-4 text-sm sm:h-9 sm:w-fit sm:min-w-28"
        disabled={busy || !written}
        type="submit"
      >
        {busy ? <Spinner /> : null}
        Propose
      </Button>
    </form>
  );
};
