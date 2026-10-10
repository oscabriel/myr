/**
 * The propose form: a signed-in member writes a want, may name the
 * territory it belongs to (one of the project's top folders), and lets the
 * platform's agent draft the ask file and its failing check from it,
 * checked by default. A line from the why page (`?about&line&at`) starts the
 * want with where it points. The inspector says what makes a good want and
 * gives the same proposal as a command. Props in, markup out: the route
 * reads who is signed in and the project's paths, sends the payload, and
 * goes to the proposal once it is made.
 *
 * Only the want, the territory and the draft box: the files are the
 * agent's to write, or a person's through `propose --files` in the CLI.
 * Propose waits until there is a want, and says so on itself.
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
import { FactBlock } from "../shared/facts.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { ClientTerritorySelect } from "./client-territory.tsx";

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

/** The value the territory takes when the agent chooses it. */
const AGENT_CHOOSES = "";

/** The territories the form offers: the agent's choice first, then each top folder. */
export const territoryChoices = (modules: readonly RepoPath[]) => [
  { label: "Let the agent choose", value: AGENT_CHOOSES },
  ...modules.map((module) => ({ label: module, value: module })),
];

/** What Propose says: why it waits, or what it does. */
const proposeWords = (written: boolean, busy: boolean) => {
  if (!written) {
    return "Write the want first";
  }

  return busy ? "Proposing" : "Propose";
};

/** The proposal as a command, for a reader in a terminal. */
const PROPOSE_COMMAND = `${Brand.cli} propose --draft "<want>"`;

const SignInFirst = ({
  about,
  project,
}: {
  readonly about: Option.Option<About>;
  readonly project: ProjectName;
}) => (
  <section
    aria-label="Sign in to propose"
    className="flex max-w-[70ch] flex-col items-start gap-3"
  >
    <p className="text-body">
      A proposal asks {project} to open an ask nobody wrote yet: a want in your
      words, which the platform&apos;s agent can draft into an ask file and a
      failing check for a decider to accept.
    </p>
    <p className="text-ui flex items-start gap-2">
      <LogIn
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span>
        Proposing is for signed-in members.{" "}
        <a
          className="decoration-rule font-medium underline hover:decoration-current"
          href={signInHref(proposeFormPath(project, about))}
        >
          Sign in
        </a>{" "}
        to propose one here, or propose from your clone:
      </span>
    </p>
    <CommandLine command={PROPOSE_COMMAND} />
  </section>
);

/** What makes a good want, and the same proposal from a terminal. */
const GoodWant = () => (
  <>
    <FactBlock label="A good want">
      <ul className="text-ui flex list-disc flex-col gap-1.5 pl-4">
        <li>Says what the project should do, not how to change the code.</li>
        <li>Asks for one change, small enough to check on its own.</li>
        <li>Says how you would tell it is done: what a check would see.</li>
      </ul>
    </FactBlock>
    <FactBlock label="From a terminal">
      <CommandLine command={PROPOSE_COMMAND} numbered />
    </FactBlock>
  </>
);

const Form = ({
  about,
  busy,
  children,
  modules,
  onPropose,
  project,
}: {
  readonly project: ProjectName;
  readonly about: Option.Option<About>;
  readonly modules: readonly RepoPath[];
  readonly onPropose?: ((payload: ProposePayload) => void) | undefined;
  readonly busy: boolean;
  readonly children?: ReactNode;
}) => {
  const id = useId();

  const [want, setWant] = useState(() =>
    Option.match(about, { onNone: () => "", onSome: wantAbout })
  );

  const [territory, setTerritory] = useState(AGENT_CHOOSES);
  const [draft, setDraft] = useState(true);
  const chosen = modules.find((module) => module === territory);
  const written = want.trim().length > 0;
  const choices = territoryChoices(modules);

  return (
    <form
      aria-label="Propose an ask"
      className="flex max-w-[70ch] flex-col gap-6"
      data-propose=""
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
        <label className="text-ui font-medium" htmlFor={`${id}-want`}>
          What should {project} do that it does not do now?
        </label>
        <Textarea
          className="min-h-32 text-base leading-6"
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
        <span className="text-ui font-medium" id={`${id}-territory`}>
          Territory
        </span>
        <ClientTerritorySelect
          choices={choices}
          labelledBy={`${id}-territory`}
          onChange={setTerritory}
          value={territory}
        />
        <p className="text-label text-muted-foreground font-normal">
          One of the project&apos;s top folders, or the agent picks from the
          want.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
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
          <Label className="text-ui leading-snug" htmlFor={`${id}-draft`}>
            Let the platform&apos;s agent draft the ask
          </Label>
        </div>
        <p className="text-label text-muted-foreground pl-6 font-normal">
          It writes the ask file and a check that fails on main, runs it red
          first, and puts the draft to a decider. Clear the box to propose the
          want alone.
        </p>
      </div>

      {children}

      <Button
        // Waiting for a want, it says so at full strength, dashed like any
        // field still to fill, rather than sitting grey.
        className={`tablet:h-9 tablet:w-fit h-11 w-full min-w-28 px-4 ${written ? "" : "text-muted-foreground border-dashed disabled:opacity-100"}`}
        data-written={written}
        disabled={busy || !written}
        type="submit"
        variant={written ? "default" : "outline"}
      >
        {busy ? <Spinner /> : null}
        {proposeWords(written, busy)}
      </Button>
    </form>
  );
};

/** The form, the way to sign in, or the wait while the browser learns who is signed in. */
const ProposeBody = ({
  about,
  busy,
  checking,
  children,
  modules,
  onPropose,
  project,
  signedIn,
}: {
  readonly project: ProjectName;
  readonly signedIn: boolean;
  readonly checking: boolean;
  readonly about: Option.Option<About>;
  readonly modules: readonly RepoPath[];
  readonly onPropose?: ((payload: ProposePayload) => void) | undefined;
  readonly busy: boolean;
  readonly children?: ReactNode;
}) => {
  if (checking) {
    return (
      <output className="text-ui text-muted-foreground block">
        Checking who is signed in
      </output>
    );
  }

  return signedIn ? (
    <Form
      about={about}
      busy={busy}
      modules={modules}
      onPropose={onPropose}
      project={project}
    >
      {children}
    </Form>
  ) : (
    <SignInFirst about={about} project={project} />
  );
};

export const ProposeView = ({
  about,
  busy = false,
  checking = false,
  children,
  modules,
  onPropose,
  project,
  signedIn,
}: {
  readonly project: ProjectName;
  readonly signedIn: boolean;
  /** Whether the browser is still learning who is signed in. */
  readonly checking?: boolean;
  readonly about: Option.Option<About>;
  /** The project's top folders, each a territory to choose. */
  readonly modules: readonly RepoPath[];
  /** Sends the payload; the route goes to the proposal once it is made. */
  readonly onPropose?: (payload: ProposePayload) => void;
  /** Whether a proposal is on its way: the button waits. */
  readonly busy?: boolean;
  /** What the last proposal came back with, when it was refused. */
  readonly children?: ReactNode;
}): ReactNode => (
  // Below the shell's width the form comes first, and what makes a good
  // want follows it, rather than standing between the reader and the form.
  <div className="contents [&_[data-facts=inline]]:hidden">
    <Workspace
      crumbs={[
        { label: project, to: `/${project}` },
        { label: "Propose an ask" },
      ]}
      facts={<GoodWant />}
      factsHeading="Proposing"
      meta="A decider decides whether the ask opens; nothing lands from here."
      title="Propose an ask"
    >
      <ProposeBody
        about={about}
        busy={busy}
        checking={checking}
        modules={modules}
        onPropose={onPropose}
        project={project}
        signedIn={signedIn}
      >
        {children}
      </ProposeBody>
      <div className="shell:hidden border-rule flex flex-col border-t pt-4">
        <GoodWant />
      </div>
    </Workspace>
  </div>
);
