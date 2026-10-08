/**
 * A stand-in for a Workers binding, or any runtime object, handed to code a
 * test expects not to use it: every read throws and names the member, so the
 * test proves what a call touches (a fake env's bindings, a Worker's
 * context). The members `known` gives read as given. Symbols and `then` read
 * as absent: printing a value or resolving a promise with it is not a use.
 *
 * Like everything in `@repo/testkit`, this module is for `test/` directories
 * only: no `src/` imports it.
 */
import { Predicate } from "effect";

/** What reading `name.member` hit: a member the test did not give. */
export class TouchedError extends Error {
  constructor(name: string, member: string) {
    super(`a test touched ${name}.${member}`);
    this.name = "TouchedError";
  }
}

export const untouchable = <T extends object>(
  name: string,
  known: Partial<T> = {}
): T => {
  const members = new Map(Object.entries(known));

  return new Proxy<T>(
    // oxlint-disable-next-line typescript/no-unsafe-argument -- a fake whose every read throws has no members to type, so its target is a bare object; `known` holds the only members a caller sees.
    Object.create(null),
    {
      get: (_target, key) => {
        const member = Predicate.isString(key) ? members.get(key) : undefined;

        if (member !== undefined || Predicate.isSymbol(key) || key === "then") {
          return member;
        }

        throw new TouchedError(name, key);
      },
    }
  );
};
