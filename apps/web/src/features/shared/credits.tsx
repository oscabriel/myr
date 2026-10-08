/**
 * A landing's trailers, as the commit carries them: credit first, in the
 * order of `CreditRole`'s literals (`Asked-by` before `Signed-off-by`), one
 * `Role: handle` line per person; then the `Held-back:` commitment, if the
 * landing was judged by held-back checks; then, apart and labelled, the
 * agents people worked through. `Assisted-by` is a disclosure, never credit
 * (GLOSSARY.md "Credit").
 */
import { CreditRole } from "@repo/protocol/domain/credit";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import { LockKeyhole } from "lucide-react";

import { HandleLink } from "./handle.tsx";

const rank = (credit: Credit) => CreditRole.literals.indexOf(credit.role);

/** Credits in trailer order; people in one role keep the order given. */
export const inTrailerOrder = (credits: readonly Credit[]) =>
  credits.toSorted((one, other) => rank(one) - rank(other));

/** An `Assisted-by:` value as the landing's trailer spells it: `pi:opus-4 (claimed)`. */
export const assistedValue = ({ harness, model, verified }: AgentTrailer) =>
  `${harness}${model === undefined ? "" : `:${model}`} (${verified ? "verified" : "claimed"})`;

const LINES = "flex flex-col gap-1 font-mono text-[0.8125rem] leading-6";

const LABEL = "text-xs font-medium text-muted-foreground";

export const CreditTrailers = ({
  assisted,
  credits,
  heldBack,
}: {
  readonly assisted: readonly AgentTrailer[];
  readonly credits: readonly Credit[];
  readonly heldBack?: string;
}) => (
  <div className="flex flex-col gap-4">
    {credits.length === 0 ? null : (
      <section className="flex flex-col gap-1.5">
        <h3 className={LABEL}>Credit</h3>
        <ul className={LINES}>
          {inTrailerOrder(credits).map(({ handle, role }) => (
            <li className="[overflow-wrap:anywhere]" key={`${role}:${handle}`}>
              <span className="text-muted-foreground">{role}:</span>{" "}
              <HandleLink handle={handle} />
            </li>
          ))}
        </ul>
      </section>
    )}
    {heldBack === undefined ? null : (
      <p
        className={`${LINES} text-sealed flex-row items-start gap-2 [overflow-wrap:anywhere]`}
      >
        <LockKeyhole aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
        <span>Held-back: {heldBack}</span>
      </p>
    )}
    {assisted.length === 0 ? null : (
      <section className="border-rule flex flex-col gap-1.5 border-t border-dashed pt-3">
        <h3 className={LABEL}>Agents used, disclosed and not credit</h3>
        <ul className={`${LINES} text-muted-foreground`}>
          {assisted.map((agent) => (
            <li className="[overflow-wrap:anywhere]" key={assistedValue(agent)}>
              Assisted-by: {assistedValue(agent)}
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
);
