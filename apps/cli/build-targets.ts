import { Option } from "effect";

export interface NpmMachine {
  readonly cpu: string;
  readonly os: string;
}

const OS = new Map([
  ["darwin", "darwin"],
  ["linux", "linux"],
  ["windows", "win32"],
]);

const CPU = new Set(["arm64", "x64"]);

export const npmMachineOf = (target: string): Option.Option<NpmMachine> => {
  const [os, cpu] = target.replace(/^bun-/u, "").split("-");

  return Option.flatMap(Option.fromUndefinedOr(OS.get(os ?? "")), (npmOs) =>
    cpu !== undefined && CPU.has(cpu)
      ? Option.some({ cpu, os: npmOs })
      : Option.none()
  );
};

// OpenTUI loads its native library from `@opentui/core-<os>-<cpu>`.
export const NATIVE = ["@opentui/core"] as const;
