/**
 * The `lintToZero` check kind: a lint rule's count in a territory is the
 * test. It is red while the rule reports anything there and green at zero,
 * so an ask of this kind fails on main by the count itself (CAA E). The count
 * comes from `countLint`, with the rule and territory already applied.
 */
import type { LintCount } from "./lint-count.ts";

/** Red: the rule still reports something in the territory. */
export const lintToZeroRed = (count: LintCount): boolean => count.total > 0;

/** Green: the rule reports nothing in the territory. */
export const lintToZeroGreen = (count: LintCount): boolean => count.total === 0;
