/**
 * What a page puts in the document's head, in a module with no view of its
 * own: a route's `head` runs with the route, before its page's view loads.
 */
import { Brand } from "@repo/brand";

/** A page's `<title>`: the page, then the product. */
export const pageTitle = (title: string) => `${title} · ${Brand.name}`;
