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

export class SwarmFailed extends Schema.TaggedError<SwarmFailed>()(
  "SwarmFailed",
  { reason: Schema.String }
) {
  override get message() {
    return this.reason;
  }
}

export interface AgentWorkspace {
  readonly dir: string;
  readonly clone: string;
  readonly env: Readonly<Record<string, string>>;
  readonly redacted: readonly string[];
}

const SLUG = Brand.slug.toUpperCase();

export const TOKEN_VARIABLE = `${SLUG}_TOKEN`;

export const URL_VARIABLE = `${SLUG}_URL`;

const PROFILE_VARIABLE = `${SLUG}_PROFILE`;

export const cliEntry = decodeURIComponent(
  new URL("../../../apps/cli/src/bin.ts", import.meta.url).pathname
);

export const shellQuoted = (word: string) =>
  /^[\w./:@%+=,-]+$/u.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

const shim = (what: string, args: readonly string[]) =>
  [
    "#!/bin/sh",
    `# ${what} for one swarm contributor: this repo's CLI from source, under Bun.`,
    `exec bun '${cliEntry.replaceAll("'", `'\\''`)}' ${[...args.map(shellQuoted), '"$@"'].join(" ")}`,
    "",
  ].join("\n");

const SHIM_MODE = 0o755;

const CONFIG_MODE = 0o700;

// A config folder of their own, so no stored profile answers instead.
export const personEnv = (input: {
  readonly configHome: string;
  readonly platformUrl: string;
  readonly token: Redacted.Redacted;
}) => ({
  [TOKEN_VARIABLE]: Redacted.value(input.token),
  [URL_VARIABLE]: input.platformUrl,
  XDG_CONFIG_HOME: input.configHome,
});

export const anonymousEnv = (input: {
  readonly configHome: string;
  readonly platformUrl: string;
}) => ({
  [PROFILE_VARIABLE]: undefined,
  [TOKEN_VARIABLE]: undefined,
  [URL_VARIABLE]: input.platformUrl,
  XDG_CONFIG_HOME: input.configHome,
});

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

const streamText = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  bytes.pipe(Stream.decodeText(), Stream.mkString);

export interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

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
 * A claim returns before its outbox has made the fork, and a failed fork is
 * made again only at the Project's next alarm, so a clone retries.
 */
export const ForkWait = Context.Reference<Duration.Duration>("swarm/ForkWait", {
  defaultValue: () => Duration.seconds(2),
});

export const FORK_TRIES = 30;

const NOT_FOUND = /^fatal: repository '.*' not found$/mu;

const forkNotMadeYet = (ran: Ran) =>
  ran.code !== 0 && NOT_FOUND.test(ran.stderr);

/**
 * `XDG_CONFIG_HOME` is the workspace's so no stored login is read, but HOME
 * stays, since the harnesses' own sign-ins live there. The clone's helper
 * follows an empty one that drops any global helper.
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
