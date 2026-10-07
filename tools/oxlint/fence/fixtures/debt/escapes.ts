// @ts-nocheck -- a fixture, never typechecked
// The debt count's fixture: each kind with a reason after " -- " and without,
// then each way around the ledger. debt.test.ts asserts every line it counts.
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

// eslint-disable-next-line no-console -- oxlint honours eslint's name too
console.log("eslint");
// Prose that names @ts-ignore or oxlint-disable mid-sentence is no escape.
/**
 * Nor is a doc line that mentions @ts-nocheck after other words.
 * @ts-ignore -- a directive at a doc line's start still counts
 */
const sameLine = 1; // oxlint-disable-line -- hides its own line
/* oxlint-disable -- a file-wide disable hides nothing from the ledger */
// @ts-ignore
const hidden: number = "e";
