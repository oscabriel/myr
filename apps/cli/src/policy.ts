import { detectHarness } from "@repo/protocol/audit";
import { ConfigProvider, Context, Effect, Layer, Option, Stdio } from "effect";

export type Mode = "human" | "agent" | "automation";

export interface Invocation {
  readonly mode: Mode;
  readonly harness: Option.Option<string>;
  readonly reason: string;
}

export interface Surroundings {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly isTTY: boolean;
}

const isSet = (value: string | undefined) =>
  value !== undefined && value !== "";

export const detectMode = ({ env, isTTY }: Surroundings): Invocation => {
  const harness = Option.fromNullishOr(detectHarness(env).harness);

  if (Option.isSome(harness)) {
    return {
      harness,
      mode: "agent",
      reason: `the env names the harness ${harness.value}`,
    };
  }

  if (isSet(env.CI)) {
    return { harness, mode: "automation", reason: "CI is set" };
  }

  return isTTY
    ? { harness, mode: "human", reason: "stdout is a terminal" }
    : { harness, mode: "automation", reason: "stdout is not a terminal" };
};

export class Policy extends Context.Service<Policy, Invocation>()(
  "cli/Policy"
) {}

export const policyFor = (surroundings: Surroundings): Layer.Layer<Policy> =>
  Layer.succeed(Policy)(detectMode(surroundings));

const childrenOf = (node: ConfigProvider.Node): readonly string[] => {
  if ("keys" in node) {
    return [...node.keys];
  }

  if ("length" in node) {
    return Array.from({ length: node.length }, (_, index) => String(index));
  }

  return [];
};

/** The provider splits names on `_` into a tree, so this walks it back together. */
const envOf = (provider: ConfigProvider.ConfigProvider) => {
  const walk = (
    path: readonly string[]
  ): Effect.Effect<
    readonly (readonly [string, string])[],
    ConfigProvider.SourceError
  > =>
    Effect.flatMap(provider.load(path), (node) => {
      if (node === undefined) {
        return Effect.succeed([]);
      }

      const here =
        path.length > 0 && node.value !== undefined
          ? [[path.join("_"), node.value] as const]
          : [];

      return Effect.map(
        Effect.forEach(childrenOf(node), (key) => walk([...path, key])),
        (below) => [...here, ...below.flat()]
      );
    });

  return Effect.map(walk([]), (entries) => Object.fromEntries(entries));
};

/** An env that cannot be read reads as empty, so the mode then rests on the terminal alone. */
export const CurrentMode: Layer.Layer<Policy, never, Stdio.Stdio> =
  Layer.effect(Policy)(
    Effect.gen(function* () {
      const provider = yield* ConfigProvider.ConfigProvider;
      const env = yield* Effect.orElseSucceed(envOf(provider), () => ({}));

      const isTTY = yield* Effect.flatMap(
        Stdio.Stdio,
        (stdio) => stdio.stdoutIsTerminal
      );

      return detectMode({ env, isTTY });
    })
  );
