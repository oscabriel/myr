import { Brand } from "@repo/brand";
import { Handle } from "@repo/protocol/ids";
import {
  Array,
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Order,
  Path,
  Redacted,
  Schema,
} from "effect";

import { renew } from "./oauth-token.ts";

// A browser sign-in keeps the token's lapse, in epoch milliseconds, and the
// refresh token that renews it; a token given by hand keeps neither, and lasts
// as long as the platform lets it.
export const Profile = Schema.Struct({
  expiresAt: Schema.optionalKey(Schema.Int),
  handle: Schema.optionalKey(Handle),
  refreshToken: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
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
    // The profile it removed, if there was one.
    readonly remove: (
      name: string
    ) => Effect.Effect<Option.Option<Profile>, CredentialsUnwritable>;
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

/** Renewed this long before it lapses, so no call carries a token that dies on the way. */
export const RENEW_MARGIN = Duration.minutes(1);

const sameToken = (one: Redacted.Redacted, other: Redacted.Redacted) =>
  Redacted.value(one) === Redacted.value(other);

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

    /**
     * A stored profile whose token is about to lapse, renewed and written back.
     * When the platform refuses the renewal, another process (git's helper, a
     * second command) may have renewed it first, so the file is read again; if
     * it holds no newer token, the old one is handed back, and the call it
     * carries is refused as signed out.
     */
    const fresh = (name: string, profile: Profile) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        if (
          profile.refreshToken === undefined ||
          profile.expiresAt === undefined ||
          profile.expiresAt - Duration.toMillis(RENEW_MARGIN) > now
        ) {
          return profile;
        }

        const { refreshToken } = profile;

        const issued = yield* renew(profile.url, refreshToken).pipe(
          Effect.option
        );

        if (Option.isNone(issued)) {
          const latest = Option.fromNullishOr((yield* readable)[name]);

          return Option.match(
            Option.filter(
              latest,
              (kept) =>
                kept.url === profile.url &&
                !sameToken(kept.token, profile.token)
            ),
            { onNone: () => profile, onSome: (kept) => kept }
          );
        }

        const renewed: Profile = {
          ...profile,
          ...Option.match(issued.value.expiresAt, {
            onNone: () => ({}),
            onSome: (expiresAt) => ({ expiresAt }),
          }),
          refreshToken: Option.getOrElse(
            issued.value.refreshToken,
            () => refreshToken
          ),
          token: issued.value.token,
        };

        // The renewal stands even if the file cannot take it: this call carries it.
        yield* Effect.flatMap(load, (profiles) =>
          save({ ...profiles, [name]: renewed })
        ).pipe(Effect.ignore);

        return renewed;
      });

    const current = Option.match(fromEnv, {
      onNone: () =>
        Effect.flatMap(readable, (profiles) =>
          Option.match(Option.fromNullishOr(profiles[named]), {
            onNone: () => Effect.succeedNone,
            onSome: (profile) => Effect.asSome(fresh(named, profile)),
          })
        ),
      onSome: (profile) => Effect.succeedSome(profile),
    });

    return {
      current,
      forHost: (host) =>
        Effect.flatMap(readable, (profiles) => {
          const stored = Array.sort(Object.keys(profiles), Order.String)
            .toSorted(
              (one, other) => Number(other === named) - Number(one === named)
            )
            .flatMap((name) =>
              Option.toArray(
                Option.map(
                  Option.fromNullishOr(profiles[name]),
                  (profile) => [Option.some(name), profile] as const
                )
              )
            );

          const found = Array.findFirst(
            [
              ...Option.toArray(
                Option.map(
                  fromEnv,
                  (profile) => [Option.none<string>(), profile] as const
                )
              ),
              ...stored,
            ],
            ([, profile]) =>
              Option.contains(hostOf(profile.url), host.toLowerCase())
          );

          return Option.match(found, {
            onNone: () => Effect.succeedNone,
            onSome: ([name, profile]) =>
              Option.match(name, {
                onNone: () => Effect.succeedSome(profile),
                onSome: (at) => Effect.asSome(fresh(at, profile)),
              }),
          });
        }),
      put: (name, profile) =>
        Effect.flatMap(load, (profiles) =>
          save({ ...profiles, [name]: profile })
        ),
      remove: (name) =>
        Effect.flatMap(load, (profiles) => {
          const { [name]: removed, ...rest } = profiles;

          return removed === undefined
            ? Effect.succeedNone
            : Effect.as(save(rest), Option.some(removed));
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
