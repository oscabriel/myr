/**
 * What a hook session keeps between events: the facts `session-start`
 * gathered (so `pre-tool-use` asks the platform nothing) and the Stop holds
 * in a row. One file per harness session, under
 * `${XDG_STATE_HOME:-$HOME/.local/state}/<slug>/hooks/`. It is a cache: a
 * file that cannot be read is no file, and one that cannot be written is
 * skipped, so the hook still answers.
 */
import { Brand } from "@repo/brand";
import { Glob, NoneOrMore } from "@repo/protocol/domain/common";
import { Config, Effect, FileSystem, Hash, Option, Path, Schema } from "effect";

import { HookClaim } from "./decide.ts";

/** One session's facts and holds, as its file holds them. */
export const SessionState = Schema.Struct({
  claim: Schema.optionalKey(HookClaim),
  holds: NoneOrMore,
  judge: Schema.Struct({
    paths: Schema.Array(Glob),
    pointers: Schema.Array(Schema.NonEmptyString),
  }),
  /** The repo's top folder, or the harness's cwd outside a repo. */
  root: Schema.String,
  /** Why the session has no claim, said again on each event's stderr. */
  why: Schema.optionalKey(Schema.String),
});

export type SessionState = typeof SessionState.Type;

/** The session's state could not be kept; the hook says so and goes on. */
export class SessionUnsaved extends Schema.TaggedError<SessionUnsaved>()(
  "SessionUnsaved",
  { reason: Schema.String }
) {
  override get message() {
    return `this session's facts are not kept between events: ${this.reason}`;
  }
}

const File = Schema.fromJsonString(SessionState);

const decodeFile = Schema.decodeUnknownEffect(File);

const encodeFile = Schema.encodeEffect(File);

const Env = Config.all({
  home: Config.option(Config.NonEmptyString("HOME")),
  stateHome: Config.option(Config.NonEmptyString("XDG_STATE_HOME")),
});

/** Owner only, like the credentials file: it names the repo and the claim. */
const FILE_MODE = 0o600;

const DIR_MODE = 0o700;

/**
 * A session id as a file name: as it is when it is a plain name (Claude
 * Code's are UUIDs), else its safe characters and a hash of the whole.
 */
const fileNameOf = (session: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(session)
    ? `${session}.json`
    : `${session.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 64)}-${Hash.string(session).toString(36)}.json`;

/** The session's file, when the env names a home for it. */
const fileOf = (session: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    const env = yield* Effect.orElseSucceed(Env, () => ({
      home: Option.none<string>(),
      stateHome: Option.none<string>(),
    }));

    return Option.map(
      Option.orElse(env.stateHome, () =>
        Option.map(env.home, (home) => path.join(home, ".local", "state"))
      ),
      (state) => path.join(state, Brand.slug, "hooks", fileNameOf(session))
    );
  });

/** The session's kept state, if its file is there and reads back whole. */
export const loadSession = (
  session: string
): Effect.Effect<
  Option.Option<SessionState>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fileOf(session);

    if (Option.isNone(file) || !(yield* fs.exists(file.value))) {
      return Option.none();
    }

    return Option.some(
      yield* Effect.flatMap(fs.readFileString(file.value), decodeFile)
    );
  }).pipe(Effect.orElseSucceed(() => Option.none<SessionState>()));

/**
 * Keeps the session's state, replacing the file whole. Fails only so the
 * caller can say why on stderr.
 */
export const saveSession = (
  session: string,
  state: SessionState
): Effect.Effect<void, SessionUnsaved, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const file = yield* Effect.flatMap(fileOf(session), (at) =>
      Effect.fromOption(at).pipe(
        Effect.mapError(
          () =>
            new SessionUnsaved({
              reason: "neither XDG_STATE_HOME nor HOME is set",
            })
        )
      )
    );

    const staged = `${file}.tmp`;

    yield* fs
      .makeDirectory(path.dirname(file), { mode: DIR_MODE, recursive: true })
      .pipe(
        Effect.andThen(
          Effect.flatMap(encodeFile(state), (text) =>
            fs.writeFileString(staged, text, { mode: FILE_MODE })
          )
        ),
        Effect.andThen(fs.rename(staged, file)),
        Effect.mapError(
          () => new SessionUnsaved({ reason: `could not write ${file}` })
        )
      );
  });
