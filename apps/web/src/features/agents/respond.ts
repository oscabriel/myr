import type { McpCard } from "./llms.ts";

const BRIEFLY = "public, max-age=60";

export const markdown = (text: string, status = 200) =>
  new Response(text, {
    headers: {
      "cache-control": status === 200 ? BRIEFLY : "no-store",
      "content-type": "text/markdown; charset=utf-8",
    },
    status,
  });

export const cardResponse = (card: McpCard) =>
  Response.json(card, { headers: { "cache-control": BRIEFLY } });

export const unavailable = () =>
  markdown(
    "# Unavailable\n\nThe platform did not answer. Try again in a minute.\n",
    503
  );
