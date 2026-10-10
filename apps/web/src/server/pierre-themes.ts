/**
 * `@pierre/theming/themes` as the web Worker bundles it (`vite.config.ts`
 * resolves it here for the Worker): no theme collection. The package's
 * collections map every Pierre and Shiki theme to a dynamic import, about
 * 1.7 MB the Worker's build would carry; the server draws in the token
 * theme alone, which `features/code/prerender-server.ts` attaches itself.
 * So the collections here hold nothing, and `createTheme` normalizes a
 * theme as the package's does.
 */
import { Effect } from "effect";
import { normalizeTheme } from "shiki/core";
import type {
  ThemeRegistrationAny,
  ThemeRegistrationResolved,
} from "shiki/core";

/** A theme as a collection holds it: its name, and its loader. */
interface Descriptor {
  readonly name: string;
  readonly load: () => Promise<ThemeRegistrationResolved>;
}

/** A collection with no themes in it. */
const empty = {
  getTheme: (_name: string): Descriptor | undefined => undefined,
  getThemes: (): readonly Descriptor[] => [],
};

export const pierreThemes = empty;

export const shikiThemes = empty;

export const themes = empty;

/** A module's theme, whether it is the module or its default export. */
const unwrap = (
  loaded: ThemeRegistrationAny | { default: ThemeRegistrationAny }
) => ("default" in loaded ? loaded.default : loaded);

/** A named theme whose loader hands it over normalized, as Shiki draws with it. */
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
