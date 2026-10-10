/**
 * The class strings many views share, in a module with no view of its own,
 * so a route that needs one never pulls a view (and what that view
 * imports) into the code every page loads.
 */

/** A section's heading, the "title" step of the type scale. */
export const SECTION = "text-lg font-semibold tracking-[-0.01em]";

/** The mono face for names a terminal prints: ids, kinds, territories. */
export const ID = "font-mono text-[0.8125rem]";

/** Text that is code: an id, a path, a SHA, a command's name; it wraps anywhere. */
export const CODE = "font-mono text-[0.8125rem] [overflow-wrap:anywhere]";

/** A link in running text: underlined in the rule colour, darker on hover. */
export const LINK = "decoration-rule underline hover:decoration-current";

/** A field's label: small, muted, above or beside its value. */
export const LABEL = "text-muted-foreground text-xs font-medium";
