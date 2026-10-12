import type {
  Endpoint,
  Limit,
  SynopsisLine,
} from "@repo/agent-kit/agent-setup";
import { groups } from "@repo/protocol/refusal";
import { Fragment } from "react";
import type { ReactNode } from "react";

export const LINK =
  "decoration-rule underline underline-offset-[0.2em] hover:decoration-current";

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
 * A text fragment on the refusal's row in `/llms-full.txt` (`` `Tag` | Group
 * ``). A dash ends a fragment's word, so it is escaped as well.
 */
const rowOf = (tag: string, group: string) =>
  `/llms-full.txt#:~:text=${encodeURIComponent(`\`${tag}\` | ${group}`).replaceAll("-", "%2D")}`;

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
