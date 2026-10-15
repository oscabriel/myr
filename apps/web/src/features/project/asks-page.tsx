import type { Ask, AskListing } from "@repo/protocol/domain/ask";
import type { AskId, ProjectName } from "@repo/protocol/ids";
import { useRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import type { DateTime } from "effect";

import { stillWaiting } from "../front/families.ts";
import type { AskProgress } from "../shared/ask-progress.ts";
import { FactBlock } from "../shared/facts.tsx";
import { useRowSelection } from "../shared/row.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";
import { askListIds, OpenAskRows, openAsks, openCount } from "./asks.tsx";

export interface ProjectAsksProps {
  readonly asks: readonly AskListing[] | undefined;
  readonly now: DateTime.Utc;
  readonly parents: readonly Ask[];
  readonly project: ProjectName;
  readonly stamps: ReadonlySet<AskId>;
  readonly states: ReadonlyMap<AskId, AskProgress>;
  readonly unreachable: boolean;
}

const TakeFacts = () => (
  <FactBlock label="How to take one">
    <p className="text-ui">
      Claim an ask open to take; the claim comes with a fork to push your answer
      to, and the platform checks it and lands it, or refuses it.
    </p>
  </FactBlock>
);

const AsksPanes = ({
  props,
  selected,
}: {
  readonly props: ProjectAsksProps;
  readonly selected: string | undefined;
}) => (
  <Workspace
    {...(props.asks === undefined
      ? {}
      : { count: openCount(openAsks(props.asks)) })}
    facts={<TakeFacts />}
    factsHeading="Taking an ask"
    title="Asks"
    variant="list"
  >
    <OpenAskRows {...props} selected={selected} />
  </Workspace>
);

const Selectable = ({ props }: { readonly props: ProjectAsksProps }) => {
  const { selected } = useRowSelection(
    props.asks === undefined ? [] : askListIds(props.asks),
    "ask"
  );

  return <AsksPanes props={props} selected={selected} />;
};

/** The project's Asks tab: its open asks, as Overview lists them, on a page of their own. */
export const ProjectAsksView = (given: ProjectAsksProps) => {
  const props = { ...given, asks: given.asks && stillWaiting(given.asks) };

  return Predicate.isNotNullish(useRouter({ warn: false })) ? (
    <Selectable props={props} />
  ) : (
    <AsksPanes props={props} selected={undefined} />
  );
};
