// The seeds go into a registry of the page's own: @effect/atom-react's default registry lives for the Worker's
// whole life and every request shares it, so a server render must never write a value there.
import { RegistryProvider } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createElement } from "react";
import type { ReactNode } from "react";

export type Seed = readonly [Atom.Atom<unknown>, unknown];

export const seed = <A>(atom: Atom.Atom<A>, value: A): Seed =>
  Atom.initialValue(atom, value);

export const seedSuccess = <A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  value: A
): Seed => seed(atom, AsyncResult.success(value));

export const SeededAtoms = ({
  children,
  id,
  seeds,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly seeds: Iterable<Seed>;
}): ReactNode =>
  createElement(RegistryProvider, { initialValues: seeds, key: id }, children);
