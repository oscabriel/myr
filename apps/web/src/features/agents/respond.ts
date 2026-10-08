/**
 * How the agents' documents go out: Markdown as `text/markdown`, JSON as
 * `application/json`, each kept briefly by caches, since a landing or a
 * new project changes them.
 */
import type { McpCard } from "./llms.ts";

/** A minute: long enough to spare the platform a burst, short enough to stay current. */
const BRIEFLY = "public, max-age=60";

/** `text` as a Markdown document. */
export const markdown = (text: string, status = 200) =>
  new Response(text, {
    headers: {
      "cache-control": status === 200 ? BRIEFLY : "no-store",
      "content-type": "text/markdown; charset=utf-8",
    },
    status,
  });

/** The MCP card as a JSON document. */
export const cardResponse = (card: McpCard) =>
  Response.json(card, { headers: { "cache-control": BRIEFLY } });

/** The platform did not answer: try again soon, and keep nothing. */
export const unavailable = () =>
  markdown(
    "# Unavailable\n\nThe platform did not answer. Try again in a minute.\n",
    503
  );
