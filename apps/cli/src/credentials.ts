import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import {
  Array,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Order,
  Path,
  Schema,
} from "effect";

export const Profile = Schema.Struct({
  handle: Schema.optionalKey(Handle),
  token: Schema.RedactedFromValue(Schema.NonEmptyString),
  url: Schema.NonEmptyString,
});

export type Profile = typeof Profile.Type;

export class CredentialsUnwritable extends Schema.TaggedError<CredentialsUnwritable>()(
  "CredentialsUnwritable",
  { path: Schema.String }
) {
  override get message() {
    return `cannot write ${this.path}: check that it is yours and is JSON, or remove it`;
  }
}

export class Credentials extends Context.Service<
  Credentials,
  {
    readonly current: Effect.Effect<Option.Option<Profile>>;
    readonly forHost: (host: string) => Effect.Effect<Option.Option<Profile>>;
    readonly put: (
      name: string,
      profile: Profile
    ) => Effect.Effect<void, CredentialsUnwritable>;
    readonly remove: (
      name: string
    ) => Effect.Effect<boolean, CredentialsUnwritable>;
  }
>()("cli/Credentials") {}

const Store = Schema.fromJsonString(
  Schema.Struct({ profiles: Schema.Record(Schema.String, Profile) })
);

const decodeStore = Schema.decodeEffect(Store);

const encodeStore = Schema.encodeEffect(Store);

const SLUG = Brand.slug.toUpperCase();

const Env = Config.all({
  configHome: Config.option(Config.NonEmptyString("XDG_CONFIG_HOME")),
  home: Config.option(Config.NonEmptyString("HOME")),
  profile: Config.option(Config.NonEmptyString(`${SLUG}_PROFILE`)),
  token: Config.option(Config.Redacted(`${SLUG}_TOKEN`)),
  url: Config.option(Config.NonEmptyString(`${SLUG}_URL`)),
});

const hostOf = Option.liftThrowable((url: string) =>
  new URL(url).host.toLowerCase()
);

/** Owner only: the file holds tokens. */
const FILE_MODE = 0o600;

const DIR_MODE = 0o700;

/** Replaced whole on every write so no reader sees half of one. */
export const CredentialsFile = Layer.effect(Credentials)(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const env = yield* Effect.orDie(Env);

    const dir = Option.map(
      Option.orElse(env.configHome, () =>
        Option.map(env.home, (home) => path.join(home, ".config"))
      ),
      (config) => path.join(config, Brand.slug)
    );

    const file = Option.map(dir, (folder) =>
      path.join(folder, "credentials.json")
    );

    const named = Option.getOrElse(env.profile, () => "default");

    const fromEnv = Option.map(
      Option.all({ token: env.token, url: env.url }),
      ({ token, url }): Profile => ({ token, url })
    );

    const load = Option.match(file, {
      onNone: () => Effect.succeed<Readonly<Record<string, Profile>>>({}),
      onSome: (at) =>
        Effect.gen(function* () {
          if (!(yield* fs.exists(at))) {
            return {};
          }

          const store = yield* Effect.flatMap(
            fs.readFileString(at),
            decodeStore
          );

          return store.profiles;
        }).pipe(Effect.mapError(() => new CredentialsUnwritable({ path: at }))),
    });

    const readable = Effect.orElseSucceed(
      load,
      (): Readonly<Record<string, Profile>> => ({})
    );

    const save = (profiles: Readonly<Record<string, Profile>>) =>
      Effect.gen(function* () {
        const at = yield* Effect.fromOption(file);
        const folder = path.dirname(at);
        const staged = `${at}.tmp`;

        yield* fs.makeDirectory(folder, { mode: DIR_MODE, recursive: true });
        yield* fs.writeFileString(staged, yield* encodeStore({ profiles }), {
          mode: FILE_MODE,
        });
        yield* fs.chmod(staged, FILE_MODE);
        yield* fs.rename(staged, at);
      }).pipe(
        Effect.mapError(
          () =>
            new CredentialsUnwritable({
              path: Option.getOrElse(file, () => "credentials.json"),
            })
        )
      );

    const current = Option.match(fromEnv, {
      onNone: () =>
        Effect.map(readable, (profiles) =>
          Option.fromNullishOr(profiles[named])
        ),
      onSome: (profile) => Effect.succeedSome(profile),
    });

    return {
      current,
      forHost: (host) =>
        Effect.map(readable, (profiles) => {
          const stored = Array.sort(Object.keys(profiles), Order.String)
            .toSorted(
              (one, other) => Number(other === named) - Number(one === named)
            )
            .flatMap((name) =>
              Option.toArray(Option.fromNullishOr(profiles[name]))
            );

          return Array.findFirst(
            [...Option.toArray(fromEnv), ...stored],
            (profile) =>
              Option.contains(hostOf(profile.url), host.toLowerCase())
          );
        }),
      put: (name, profile) =>
        Effect.flatMap(load, (profiles) =>
          save({ ...profiles, [name]: profile })
        ),
      remove: (name) =>
        Effect.flatMap(load, (profiles) => {
          if (!Object.hasOwn(profiles, name)) {
            return Effect.succeed(false);
          }

          const { [name]: _removed, ...rest } = profiles;

          return Effect.as(save(rest), true);
        }),
    };
  })
);

/** An empty helper comes first to drop any general one (a keychain) for this url. */
export const gitHelperConfig = (
  url: string
): readonly (readonly string[])[] => [
  [
    "git",
    "config",
    "--global",
    "--replace-all",
    `credential.${url}.helper`,
    "",
  ],
  [
    "git",
    "config",
    "--global",
    "--add",
    `credential.${url}.helper`,
    Brand.slug,
  ],
  ["git", "config", "--global", `credential.${url}.useHttpPath`, "true"],
];
