/**
 * The platform tokens the CLI holds, by profile, in the CLI's own file under
 * the user's config dir. git's credential helper, `login` and every remote
 * command read them here, and nowhere else. The env can stand in for the
 * file (`<SLUG>_TOKEN` with `<SLUG>_URL`), as a CI job would set it.
 */
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

/** One platform the CLI can call, as whom. */
export const Profile = Schema.Struct({
  /** The handle the token was issued to, when `login` learned it. */
  handle: Schema.optionalKey(Handle),
  /** The platform token: the only identity the CLI and git present. */
  token: Schema.RedactedFromValue(Schema.NonEmptyString),
  /** The platform's origin: `https://platform-dev.example.workers.dev`. */
  url: Schema.NonEmptyString,
});

export type Profile = typeof Profile.Type;

/** The credentials file could not be written, or is there and unreadable. */
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
    /** The env's token and url, else the profile `<SLUG>_PROFILE` names, else `default`. */
    readonly current: Effect.Effect<Option.Option<Profile>>;
    /** The profile whose url is on `host` (`host[:port]`), the current one first. */
    readonly forHost: (host: string) => Effect.Effect<Option.Option<Profile>>;
    readonly put: (
      name: string,
      profile: Profile
    ) => Effect.Effect<void, CredentialsUnwritable>;
    /** Whether there was a profile by that name to remove. */
    readonly remove: (
      name: string
    ) => Effect.Effect<boolean, CredentialsUnwritable>;
  }
>()("cli/Credentials") {}

/** The file: profiles by name. */
const Store = Schema.fromJsonString(
  Schema.Struct({ profiles: Schema.Record(Schema.String, Profile) })
);

const decodeStore = Schema.decodeEffect(Store);

const encodeStore = Schema.encodeEffect(Store);

/** The env names, spelled from the brand: `<SLUG>_TOKEN`. */
const SLUG = Brand.slug.toUpperCase();

/** What the CLI reads of its env, once. */
const Env = Config.all({
  configHome: Config.option(Config.NonEmptyString("XDG_CONFIG_HOME")),
  home: Config.option(Config.NonEmptyString("HOME")),
  profile: Config.option(Config.NonEmptyString(`${SLUG}_PROFILE`)),
  token: Config.option(Config.Redacted(`${SLUG}_TOKEN`)),
  url: Config.option(Config.NonEmptyString(`${SLUG}_URL`)),
});

/** `url`'s `host[:port]`, in lowercase, if it is a URL. */
const hostOf = Option.liftThrowable((url: string) =>
  new URL(url).host.toLowerCase()
);

/** Owner only: the file holds tokens. */
const FILE_MODE = 0o600;

const DIR_MODE = 0o700;

/**
 * The credentials file: `${XDG_CONFIG_HOME:-$HOME/.config}/<slug>/credentials.json`,
 * mode 0600, replaced whole on every write so no reader sees half of one.
 */
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

    /** The profiles on disk: none without a file; a failure if it can't be read. */
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

    /** The profiles to read from: an unreadable file holds none. */
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

/**
 * The `git config --global …` commands `login` and `init` run so that git
 * asks this CLI for the platform's token: `credential.<url>.helper` names
 * `<slug>`, so git runs `git-credential-<slug>`, after an empty helper that
 * drops any general one (a keychain) for this url; `useHttpPath` hands the
 * helper the repo's path too.
 */
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
