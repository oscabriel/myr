// A cache: a file that cannot be read is no file, and one that cannot be written is skipped.
import { Brand } from "@repo/brand";
import { NoneOrMore } from "@repo/protocol/domain/common";
import { Policy } from "@repo/protocol/domain/policy";
import { Config, Effect, FileSystem, Hash, Option, Path, Schema } from "effect";

import { HookClaim } from "./decide.ts";

export const SessionState = Schema.Struct({
  claim: Schema.optionalKey(HookClaim),
  holds: NoneOrMore,
  judge: Policy.fields.judge,
  root: Schema.String,
  why: Schema.optionalKey(Schema.String),
});

export type SessionState = typeof SessionState.Type;

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

const fileNameOf = (session: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(session)
    ? `${session}.json`
    : `${session.replaceAll(/[^A-Za-z0-9._-]/gu, "_").slice(0, 64)}-${Hash.string(session).toString(36)}.json`;

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
