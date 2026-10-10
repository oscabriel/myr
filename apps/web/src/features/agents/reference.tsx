/**
 * The For agents page's reference sections, set like a man page: the
 * CLI's synopsis, the endpoints, the limits and the refusals. Every word
 * that is not a heading comes from `@repo/agent-kit` (`synopsis`,
 * `agentEndpoints`, `agentLimits`) or the refusal union itself, so the
 * page and `/agents.md` say the same. Mono only for what a terminal takes:
 * commands, addresses and tags.
 */
import type {
  Endpoint,
  Limit,
  SynopsisLine,
} from "@repo/agent-kit/agent-setup";
import { groups } from "@repo/protocol/refusal";
import { Fragment } from "react";
import type { ReactNode } from "react";

/** A link in running text: the rule colour's underline, ink on hover. */
export const LINK =
  "decoration-rule underline underline-offset-[0.2em] hover:decoration-current";

/** One section of the reference: its heading at Title size, in the sans, then its body. */
export const ReferenceSection = ({
  children,
  id,
  title,
}: {
  readonly children: ReactNode;
  readonly id: string;
  readonly title: string;
}) => (
  <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
    {/* The anchor's target: its margin clears the sticky bars above main. */}
    <h2 className="text-title scroll-mt-16" id={id}>
      {title}
    </h2>
    {children}
  </section>
);

/**
 * A usage line that wraps only between its words, never inside a flag
 * (`[--json]` stays whole), so a phone reads it as typed.
 */
const Usage = ({ usage }: { readonly usage: string }) => (
  <code className="text-mono font-mono">
    {usage.split(" ").map((word, index) => (
      <Fragment key={index}>
        {index === 0 ? null : " "}
        <span className="whitespace-nowrap">{word}</span>
      </Fragment>
    ))}
  </code>
);

/** Every command as typed, each over what it does, set close like a man page's synopsis. */
export const Synopsis = ({
  lines,
}: {
  readonly lines: readonly SynopsisLine[];
}) => (
  <ul className="flex flex-col gap-3">
    {lines.map(({ summary, usage }) => (
      <li className="flex min-w-0 flex-col" key={usage}>
        <Usage usage={usage} />
        <p className="text-ui text-muted-foreground max-w-[70ch]">{summary}</p>
      </li>
    ))}
  </ul>
);

/** Each address an agent reads, one line each, linked where a browser can open it. */
export const Endpoints = ({
  endpoints,
}: {
  readonly endpoints: readonly Endpoint[];
}) => (
  <ul className="border-rule flex flex-col border-t">
    {endpoints.map(({ readable, url, what }) => {
      const address = (
        <code className="text-mono font-mono [overflow-wrap:anywhere]">
          {url}
        </code>
      );

      return (
        <li
          className="border-rule flex min-w-0 flex-col gap-0.5 border-b py-2.5"
          key={url}
        >
          {readable ? (
            // A server's own text, not a page of the app.
            <a className={`${LINK} w-fit max-w-full`} href={url}>
              {address}
            </a>
          ) : (
            address
          )}
          <p className="text-ui text-muted-foreground max-w-[70ch]">{what}</p>
        </li>
      );
    })}
  </ul>
);

/** The limits, as a plain table. */
export const Limits = ({ limits }: { readonly limits: readonly Limit[] }) => (
  <table className="text-ui w-full max-w-[48rem] border-collapse text-left">
    <thead>
      <tr className="border-rule border-b">
        <th className="text-label text-muted-foreground py-2 pr-6" scope="col">
          Limit
        </th>
        <th className="text-label text-muted-foreground py-2" scope="col">
          Value
        </th>
      </tr>
    </thead>
    <tbody>
      {limits.map(({ limit, value }) => (
        <tr className="border-rule border-b align-baseline" key={limit}>
          <th className="py-2.5 pr-6 font-normal" scope="row">
            {limit}
          </th>
          <td className="py-2.5 tabular-nums">{value}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * Where `/llms-full.txt` lists a refusal: a text fragment on its table row
 * (`` `Tag` | Group ``), which nothing else in the file reads. A dash ends
 * a fragment's word, so it is escaped as well.
 */
const rowOf = (tag: string, group: string) =>
  `/llms-full.txt#:~:text=${encodeURIComponent(`\`${tag}\` | ${group}`).replaceAll("-", "%2D")}`;

/** Every refusal of the union, by group, each tag linked to its row. */
export const Refusals = () => (
  <>
    <p className="text-ui text-muted-foreground max-w-[70ch]">
      Each tag opens its row in{" "}
      <a className={LINK} href="/llms-full.txt">
        llms-full.txt
      </a>
      .
    </p>
    <dl className="border-rule flex flex-col border-t">
      {groups.map(({ members, name }) => (
        <div
          className="border-rule shell:grid shell:grid-cols-[12rem_minmax(0,1fr)] shell:gap-4 flex min-w-0 flex-col gap-1 border-b py-2.5"
          key={name}
        >
          <dt className="text-ui font-medium" data-term="">
            {name}
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
            {members.map(({ identifier }) => (
              <a
                className={LINK}
                href={rowOf(identifier, name)}
                key={identifier}
              >
                <code className="text-mono font-mono">{identifier}</code>
              </a>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  </>
);
