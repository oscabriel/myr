/**
 * A landing's trailers, as the commit carries them: credit first, in the
 * order of `CreditRole`'s literals (`Asked-by` before `Signed-off-by`), one
 * `Role: handle` line per person; then the `Held-back:` commitment, if the
 * landing was judged by held-back checks; then, apart and labelled, the
 * agents people worked through. `Assisted-by` is a disclosure, never credit
 * (GLOSSARY.md "Credit").
 *
 * `CompactCredit` is the same credit in one line for a row ("Asked by
 * ines-v · answered by tamsin"): the roles in the same order, each person
 * linked, and never an agent.
 */
import { CreditRole } from "@repo/protocol/domain/credit";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import { LockKeyhole } from "lucide-react";
import { Fragment } from "react";

import { HandleLink } from "./handle.tsx";

const rank = (credit: Credit) => CreditRole.literals.indexOf(credit.role);

/** Credits in trailer order; people in one role keep the order given. */
export const inTrailerOrder = (credits: readonly Credit[]) =>
  credits.toSorted((one, other) => rank(one) - rank(other));

/** An `Assisted-by:` value as the landing's trailer spells it: `pi:opus-4 (claimed)`. */
export const assistedValue = ({ harness, model, verified }: AgentTrailer) =>
  `${harness}${model === undefined ? "" : `:${model}`} (${verified ? "verified" : "claimed"})`;

const LINES = "flex flex-col gap-1 font-mono text-mono leading-terminal";

const LABEL = "text-label text-muted-foreground";

export const CreditTrailers = ({
  assisted,
  credits,
  heldBack,
  label = "fact",
}: {
  readonly assisted: readonly AgentTrailer[];
  readonly credits: readonly Credit[];
  readonly heldBack?: string;
  /** "Credit" as a fact's label, or at Title weight, a region's own head (the Landed page). */
  readonly label?: "fact" | "title";
}) => (
  <div className="flex flex-col gap-4">
    {credits.length === 0 ? null : (
      <section className="flex flex-col gap-1.5">
        <h3 className={label === "title" ? "text-title" : LABEL}>Credit</h3>
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

/** Each role as a row's line says it: the trailer, in words. */
const roleWords = {
  "Advised-by": "advised by",
  "Asked-by": "asked by",
  "Decided-by": "decided by",
  "Finished-by": "finished by",
  "Mentored-by": "mentored by",
  "Released-by": "released by",
  "Signed-off-by": "answered by",
} as const satisfies Record<CreditRole, string>;

/** A sentence's first word with its first letter raised. */
const raised = (words: string) =>
  `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;

/** What comes before the `index`th of `count` people in a list of words. */
const before = (index: number, count: number) => {
  if (index === 0) {
    return "";
  }

  return index === count - 1 ? " and " : ", ";
};

/** People in a list of words: "bram", "bram and tamsin", "bram, ines and tamsin". */
const Joined = ({ people }: { readonly people: readonly Credit[] }) =>
  people.map(({ handle }, index) => (
    <Fragment key={handle}>
      {before(index, people.length)}
      <HandleLink handle={handle} />
    </Fragment>
  ));

/** A landing's credit in one line: each role once, in trailer order, its people linked. */
export const CompactCredit = ({
  credits,
  within = false,
}: {
  readonly credits: readonly Credit[];
  /** Inside a sentence, after a ` · `: its first word stays lower case. */
  readonly within?: boolean;
}) => {
  const roles = CreditRole.literals.flatMap((role) => {
    const people = credits.filter((credit) => credit.role === role);

    return people.length === 0 ? [] : [{ people, role }];
  });

  return roles.length === 0 ? null : (
    <span className="min-w-0">
      {roles.map(({ people, role }, index) => (
        <Fragment key={role}>
          {index === 0 && !within
            ? raised(roleWords[role])
            : `${index === 0 ? "" : " · "}${roleWords[role]}`}{" "}
          <Joined people={people} />
        </Fragment>
      ))}
    </span>
  );
};
