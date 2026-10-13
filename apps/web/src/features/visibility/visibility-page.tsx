/**
 * A project's Visibility tab (ADR 0041): its posture, layers, held-back
 * checks, environment and ledger in one place. Views only, as the ledger's
 * and the environment's are: props in, markup out.
 */
import type { EnvSchemaView } from "@repo/protocol/domain/env";
import type { Ledger } from "@repo/protocol/domain/visibility";
import type { DateTime } from "effect";

import { EnvironmentRegion } from "../env/env-page.tsx";
import { areaSummaries, plural } from "../ledger/areas.ts";
import {
  HeadSentence,
  HeldBackRegion,
  LayersRegion,
  LedgerFacts,
  LedgerRegion,
  ledgerReadAt,
} from "../ledger/ledger-page.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";

const metaOf = (
  ledger: Ledger,
  areas: number,
  env: EnvSchemaView | undefined
) =>
  [
    plural(ledger.layers.length, "layer", "layers"),
    plural(areas, "held-back area", "held-back areas"),
    ...(env === undefined
      ? []
      : [plural(env.items.length, "env item", "env items")]),
    plural(ledger.entries.length, "ledger entry", "ledger entries"),
  ].join(" · ");

export const VisibilityView = ({
  env,
  ledger,
  now,
}: {
  readonly env: EnvSchemaView | undefined;
  readonly ledger: Ledger;
  readonly now: DateTime.Utc;
}) => {
  const areas = areaSummaries(ledger);
  const seen = ledgerReadAt(ledger, now);

  return (
    <Workspace
      facts={<LedgerFacts areas={areas} ledger={ledger} />}
      factsHeading="This project's visibility"
      meta={metaOf(ledger, areas.length, env)}
      status={<HeadSentence ledger={ledger} />}
      title="Visibility"
    >
      <LayersRegion ledger={ledger} />
      <HeldBackRegion areas={areas} now={seen} />
      <EnvironmentRegion now={now} project={ledger.project} schema={env} />
      <LedgerRegion ledger={ledger} now={seen} />
    </Workspace>
  );
};
