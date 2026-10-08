/**
 * One contributor's workspace: `<swarm>/<run>/<handle>/` (`SwarmDir`, outside
 * the checkout), with their clone of
 * the claim's fork, a `bin/` that puts this repo's CLI (and git's credential
 * helper) on `PATH`, their own config folder, and the env their harness runs
 * in. The person's platform token reaches the harness only through that env,
 * as `<SLUG>_TOKEN`, never in a file, an argv or a URL.
 */
import { Brand } from "@repo/brand";
import type { ClaimView } from "@repo/protocol/domain/claim";
import {
  Config,
  Context,
  Duration,
  Effect,
  FileSystem,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { runDir } from "./results.ts";
import type { Contributor } from "./roster.ts";

/** The swarm could not do a step; the reason says which, and never holds a token. */
export class SwarmFailed extends Schema.TaggedError<SwarmFailed>()(
  "SwarmFailed",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason;
  }
}

/** Where one contributor works, and the env their harness runs in. */
export interface AgentWorkspace {
  /** `<swarm>/<run>/<handle>`. */
  readonly dir: string;
  /** Their clone of the claim's fork: the harness's working directory. */
  readonly clone: string;
  readonly env: Readonly<Record<string, string>>;
  /** The env names whose values are secret: never logged, never printed. */
  readonly redacted: readonly string[];
}

/** The env names the CLI reads, spelled from the brand (`apps/cli/src/credentials.ts`). */
const SLUG = Brand.slug.toUpperCase();

/** The person's platform token: the only identity the CLI and git present. */
export const TOKEN_VARIABLE = `${SLUG}_TOKEN`;

/** The platform the CLI calls, with the token or, without one, as anyone. */
export const URL_VARIABLE = `${SLUG}_URL`;

/** The profile the CLI would read instead of the env's token. */
const PROFILE_VARIABLE = `${SLUG}_PROFILE`;

/** The CLI's process entry in this repo, run from source with Bun. */
export const cliEntry = decodeURIComponent(
  new URL("../../../apps/cli/src/bin.ts", import.meta.url).pathname
);

/** A one-word shell argument: `'…'`, with any `'` inside closed and escaped. */
export const shellQuoted = (word: string) =>
  /^[\w./:@%+=,-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** A shim in `bin/`: a shell script that runs the CLI from source with `args` first. */
const shim = (what: string, args: readonly string[]) =>
  [
    "#!/bin/sh",
    `# ${what} for one swarm contributor: this repo's CLI from source, under Bun.`,
    `exec bun '${cliEntry.replaceAll("'", `'\\''`)}' ${[...args.map(shellQuoted), '"$@"'].join(" ")}`,
    "",
  ].join("\n");

/** Owner, group and everyone may run a shim; only the owner writes it. */
const SHIM_MODE = 0o755;

/** The workspace's config folder holds the CLI's credentials: owner only. */
const CONFIG_MODE = 0o700;

/**
 * The env a CLI call runs in as a person: their token and the platform, and
 * a config folder of their own, so no stored profile of the user's answers
 * instead.
 */
export const personEnv = (input: {
  readonly configHome: string;
  readonly platformUrl: string;
  readonly token: Redacted.Redacted;
}) => ({
  [TOKEN_VARIABLE]: Redacted.value(input.token),
  [URL_VARIABLE]: input.platformUrl,
  XDG_CONFIG_HOME: input.configHome,
});

/**
 * The env a CLI call runs in as anyone: the platform, a config folder that
 * holds no profile, and no token or profile from the shell the swarm runs in.
 */
export const anonymousEnv = (input: {
  readonly configHome: string;
  readonly platformUrl: string;
}) => ({
  [PROFILE_VARIABLE]: undefined,
  [TOKEN_VARIABLE]: undefined,
  [URL_VARIABLE]: input.platformUrl,
  XDG_CONFIG_HOME: input.configHome,
});

/** `text` with every secret value of `env` (the names in `redacted`) blanked out. */
export const scrubbed = (
  text: string,
  workspace: Pick<AgentWorkspace, "env" | "redacted">
) => {
  let clean = text;

  for (const name of workspace.redacted) {
    const secret = workspace.env[name];

    if (secret !== undefined && secret !== "") {
      clean = clean.replaceAll(secret, "<redacted>");
    }
  }

  return clean;
};

/** All a byte stream says, as text. */
const streamText = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

/** How a process ended, and what it printed. */
export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `command args` in `cwd` with `env` over the swarm's own: how it ended, and what it printed. */
export const run = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Effect.Effect<Ran, SwarmFailed, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const child = yield* spawner.spawn(
        ChildProcess.make(input.command, input.args, {
          cwd: input.cwd,
          env: { ...input.env },
          extendEnv: true,
        })
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [streamText(child.stdout), streamText(child.stderr), child.exitCode],
        { concurrency: "unbounded" }
      );

      return { code: Number(code), stderr, stdout };
    })
  ).pipe(
    Effect.mapError(
      ({ message }) =>
        new SwarmFailed({ reason: `${input.command} didn't run: ${message}` })
    )
  );

/**
 * How long a clone waits for the claim's fork: one try every `ForkWait`
 * (2 s unless a test says otherwise) after the first, `FORK_TRIES` more at
 * most, so about a minute. A claim returns before its outbox has made the
 * fork, and an Artifacts fork that failed under load is made again only at
 * the Project's next alarm, with backoff. Found live (804): one of six
 * claims made at once was cloned too soon.
 */
export const ForkWait = Context.Reference<Duration.Duration>("swarm/ForkWait", {
  defaultValue: () => Duration.seconds(2),
});

export const FORK_TRIES = 30;

/** git's words when the gateway answers 404: the repo is not there (yet). */
const NOT_FOUND = /^fatal: repository '.*' not found$/mu;

/** A clone that failed only because the fork is not made yet. */
const forkNotMadeYet = (ran: Ran) =>
  ran.code !== 0 && NOT_FOUND.test(ran.stderr);

/**
 * Makes one contributor's workspace for their claim, below `<swarm>/<run>/`:
 *
 * - `bin/<cli>` and `bin/git-credential-<slug>`, shims that run this repo's
 *   CLI from source (the helper as `<cli> credential`), first on `PATH`;
 * - `config/`, the CLI's `XDG_CONFIG_HOME`, so neither the CLI nor git's
 *   helper reads the user's own login (HOME stays the user's: the
 *   harnesses' own sign-ins live there);
 * - `clone/`, the claim's fork, cloned with the helper in its config for
 *   the platform (after an empty helper that drops any other, as `login`
 *   sets it globally), and the person as its author; while the fork is not
 *   made yet, the clone is tried again (`ForkWait`, `FORK_TRIES`);
 * - the env: `PATH`, git's non-interactive settings, `XDG_CONFIG_HOME`, and
 *   the person's token and platform as `<SLUG>_TOKEN` and `<SLUG>_URL`.
 */
export const prepareWorkspace = (input: {
  readonly run: string;
  readonly contributor: Contributor;
  readonly claim: ClaimView;
  readonly platformUrl: string;
  readonly token: Redacted.Redacted;
}): Effect.Effect<
  AgentWorkspace,
  SwarmFailed,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { handle } = input.contributor;
    const dir = `${yield* runDir(input.run)}/${handle}`;
    const bin = `${dir}/bin`;
    const config = `${dir}/config`;
    const clone = `${dir}/clone`;
    const helper = `${bin}/${Brand.gitCredentialHelper}`;
    const cli = `${bin}/${Brand.cli}`;

    const path = yield* Config.String("PATH").pipe(
      Config.withDefault(""),
      Effect.orElseSucceed(() => "")
    );

    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(bin, { recursive: true });
      yield* fs.makeDirectory(config, { mode: CONFIG_MODE, recursive: true });
      yield* fs.writeFileString(cli, shim(Brand.cli, []), { mode: SHIM_MODE });
      yield* fs.writeFileString(
        helper,
        shim(Brand.gitCredentialHelper, ["credential"]),
        { mode: SHIM_MODE }
      );
      yield* fs.chmod(cli, SHIM_MODE);
      yield* fs.chmod(helper, SHIM_MODE);
    }).pipe(
      Effect.mapError(
        ({ message }) =>
          new SwarmFailed({ reason: `${handle}'s workspace: ${message}` })
      )
    );

    const env = {
      // Rat Stack's editor env (joelhooks/rat-stack, MIT, after its
      // `scripts/vcs-command-policy.js`): no git command waits in an editor.
      GIT_EDITOR: ":",
      GIT_MERGE_AUTOEDIT: "no",
      GIT_SEQUENCE_EDITOR: ":",
      // …nor at a prompt for a password.
      GIT_TERMINAL_PROMPT: "0",
      PATH: path === "" ? bin : `${bin}:${path}`,
      ...personEnv({
        configHome: config,
        platformUrl: input.platformUrl,
        token: input.token,
      }),
    };

    const workspace: AgentWorkspace = {
      clone,
      dir,
      env,
      redacted: [TOKEN_VARIABLE],
    };

    const credential = `credential.${input.platformUrl}`;
    const forkWait = yield* ForkWait;

    const cloned = yield* run({
      args: [
        "clone",
        ...[
          `${credential}.helper=`,
          `${credential}.helper=${helper}`,
          `${credential}.useHttpPath=true`,
          `user.name=${handle}`,
          `user.email=${handle}@example.com`,
          "commit.gpgsign=false",
        ].flatMap((setting) => ["--config", setting]),
        "--",
        input.claim.remote,
        clone,
      ],
      command: "git",
      cwd: dir,
      env,
    }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(forkWait),
        times: FORK_TRIES,
        while: forkNotMadeYet,
      })
    );

    if (cloned.code !== 0) {
      return yield* new SwarmFailed({
        reason: scrubbed(
          `${handle}: git clone ${input.claim.remote} exited ${cloned.code}: ${cloned.stderr.trim()}`,
          workspace
        ),
      });
    }

    return workspace;
  });
