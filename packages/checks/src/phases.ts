// `Snapshot` must come before held-back files are written: a snapshot taken
// after them would carry them into the next Sandbox.
import type { RunBlock } from "@repo/protocol/domain/run";
import type { AreaName, EnvKey, LaneName } from "@repo/protocol/ids";
import { Data, Hash, Option } from "effect";

export interface PlannedLane {
  readonly lane: LaneName;
  readonly command: string;
}

/**
 * One phase. This is the union `Data.TaggedEnum` would build; it is written
 * out because the lint refuses the `{}` members `EgressOff` and `Report`
 * would need there.
 */
export type Phase =
  | {
      readonly _tag: "Setup";
      readonly command: string;
      readonly egress: readonly string[];
    }
  | { readonly _tag: "Snapshot"; readonly key: string }
  | { readonly _tag: "EgressOff" }
  | { readonly _tag: "WriteHeldBack"; readonly areas: readonly AreaName[] }
  | {
      readonly _tag: "Run";
      readonly lanes: readonly PlannedLane[];
      readonly placeholders: readonly EnvKey[];
    }
  | { readonly _tag: "Report" };

export const Phase = Data.taggedEnum<Phase>();

export interface PlanInput {
  readonly run: RunBlock;
  readonly lanes: readonly PlannedLane[];
  readonly heldBack: Option.Option<{ readonly areas: readonly AreaName[] }>;
  readonly placeholders: readonly EnvKey[];
  readonly lockfileHash: string;
}

const DEFAULT_IMAGE = "checker:default";

// Reused only for the same image, setup command, setup hosts and lockfile.
const snapshotKey = (
  run: RunBlock,
  command: string,
  egress: readonly string[],
  lockfileHash: string
) => {
  const image = run.image ?? DEFAULT_IMAGE;

  // Hash.string is a fixed function of its input (djb2), so the key is too.
  const setupHash = Math.abs(
    Hash.string(JSON.stringify([image, command, egress]))
  ).toString(16);

  return `setup:${lockfileHash}:${setupHash}`;
};

export const phasePlan = ({
  heldBack,
  lanes,
  lockfileHash,
  placeholders,
  run,
}: PlanInput): readonly Phase[] => {
  const install: readonly Phase[] =
    run.setup === undefined
      ? []
      : [
          Phase.Setup({ command: run.setup, egress: run.setupEgress ?? [] }),
          Phase.Snapshot({
            key: snapshotKey(
              run,
              run.setup,
              run.setupEgress ?? [],
              lockfileHash
            ),
          }),
        ];

  const sealed: readonly Phase[] = Option.match(heldBack, {
    onNone: () => [],
    onSome: ({ areas }) => [Phase.WriteHeldBack({ areas })],
  });

  return [
    ...install,
    Phase.EgressOff(),
    ...sealed,
    Phase.Run({ lanes, placeholders }),
    Phase.Report(),
  ];
};
