// `@pierre/theming/themes` for the Worker: its collections map every theme to a dynamic import, about 1.7 MB,
// and the server draws in the token theme alone, so these collections hold nothing.
import { Effect } from "effect";
import { normalizeTheme } from "shiki/core";
import type {
  ThemeRegistrationAny,
  ThemeRegistrationResolved,
} from "shiki/core";

interface Descriptor {
  readonly name: string;
  readonly load: () => Promise<ThemeRegistrationResolved>;
}

const empty = {
  getTheme: (_name: string): Descriptor | undefined => undefined,
  getThemes: (): readonly Descriptor[] => [],
};

export const pierreThemes = empty;

export const shikiThemes = empty;

export const themes = empty;

const unwrap = (
  loaded: ThemeRegistrationAny | { default: ThemeRegistrationAny }
) => ("default" in loaded ? loaded.default : loaded);

export const createTheme = ({
  load,
  name,
}: {
  readonly name: string;
  readonly load: () => Promise<
    ThemeRegistrationAny | { default: ThemeRegistrationAny }
  >;
}): Descriptor => ({
  load: () =>
    Effect.runPromise(
      Effect.promise(load).pipe(
        Effect.map((loaded) => normalizeTheme(unwrap(loaded)))
      )
    ),
  name,
});
