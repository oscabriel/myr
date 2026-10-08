/**
 * What `bun build --compile --target=<target>` needs from npm for another
 * machine. `bun install` installs only this machine's optional native
 * packages, so a binary for another one (darwin-arm64 from Linux) cannot
 * embed OpenTUI's native library until the build fetches it (`build.ts`).
 */
import { Option } from "effect";

/** A machine as npm's `os` and `cpu` fields name it. */
export interface NpmMachine {
  readonly cpu: string;
  readonly os: string;
}

/** Bun's operating systems, by npm's name for each. */
const OS = new Map([
  ["darwin", "darwin"],
  ["linux", "linux"],
  ["windows", "win32"],
]);

const CPU = new Set(["arm64", "x64"]);

/**
 * npm's machine for a Bun compile target (`bun-darwin-arm64`, `linux-x64`,
 * `bun-linux-x64-musl`, `bun-windows-x64-baseline`): its OS and CPU, with
 * Bun's prefix and modifiers dropped. None for a target Bun does not name.
 */
export const npmMachineOf = (target: string): Option.Option<NpmMachine> => {
  const [os, cpu] = target.replace(/^bun-/u, "").split("-");

  return Option.flatMap(Option.fromUndefinedOr(OS.get(os ?? "")), (npmOs) =>
    cpu !== undefined && CPU.has(cpu)
      ? Option.some({ cpu, os: npmOs })
      : Option.none()
  );
};

/**
 * The packages whose optional dependencies hold the native code the CLI's
 * binary embeds: OpenTUI's core (`today --tui`) loads its library from
 * `@opentui/core-<os>-<cpu>`.
 */
export const NATIVE = ["@opentui/core"] as const;
