/**
 * Every read throws and names the member, so a test proves what a call
 * touches. Symbols and `then` read as absent: printing a value or resolving a
 * promise with it is not a use.
 */
import { Predicate } from "effect";

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
