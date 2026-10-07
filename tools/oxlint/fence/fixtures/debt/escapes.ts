// @ts-nocheck -- a fixture, never typechecked
// The debt count's fixture: every kind of escape, first with a reason after
// " -- ", then without one. packages/config/test/debt.test.ts asserts each line.
/* @ts-nocheck */

// oxlint-disable-next-line no-console -- the fixture prints
console.log("reasoned");
// SAFETY: a line above the directive is not its reason.
// oxlint-disable-next-line no-console
console.log("unreasoned");

// @effect-diagnostics-next-line floatingEffect:off -- the fixture drops it
dropped();
// @effect-diagnostics-next-line floatingEffect:off
dropped();

// @ts-expect-error -- a string is not a number
const reasoned: number = "a";
// @ts-expect-error --
const emptyReason: number = "b";

// @ts-ignore -- the fixture ignores it
const ignored: number = "c";
// @ts-ignore
const ignoredWithout: number = "d";
