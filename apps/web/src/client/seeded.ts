/**
 * A page's atoms, rendered from what its loader read on the server.
 *
 * A route's loader reads on the server, so the page arrives with its data;
 * its atoms then start from that read and keep it live in the browser (a
 * key invalidated by `watch` reads again). The seeds go into a registry of
 * the page's own, made for each render: the registry `@effect/atom-react`
 * gives by default lives for the Worker's whole life and every request on
 * it shares it, so a server render must never write a value there (the
 * reason the client's atoms render as waiting on the server,
 * `withServerValueInitial`).
 *
 * Everything under `SeededAtoms` reads and writes its own registry: put the
 * page's whole body under it, so its reads, its live view (`watchAtom`)
 * and its writes share one, and give each address its own `id`, so moving
 * to another address makes a new registry from that address's seeds. The
 * registries share one `Reactivity` (`sharedRuntime`, `surfaces.ts`), so a
 * write on the page also refetches what the root reads (the rail's counts).
 *
 * ```tsx
 * const read = Route.useLoaderData();
 *
 * <SeededAtoms id={`${read.project}/${read.ask}`} seeds={[seedSuccess(verdictAtom(read.project, read.ask), { verdict: read.verdict })]}>
 *   <FreshAnswer read={read} />
 * </SeededAtoms>
 * ```
 */
import { RegistryProvider } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createElement } from "react";
import type { ReactNode } from "react";

/** An atom and the value it starts from. */
export type Seed = readonly [Atom.Atom<unknown>, unknown];

/** `atom`, starting from `value`. */
export const seed = <A>(atom: Atom.Atom<A>, value: A): Seed =>
  Atom.initialValue(atom, value);

/** A read's atom, starting from the success its loader read. */
export const seedSuccess = <A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  value: A
): Seed => seed(atom, AsyncResult.success(value));

/**
 * `children` over a registry of their own that starts from `seeds`; a new
 * `id` (another address) makes a new one.
 */
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
