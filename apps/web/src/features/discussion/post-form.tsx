import type { Handle } from "@repo/protocol/ids";
import { Option } from "effect";
import { LogIn } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { signInHref } from "../auth/session-slot.tsx";

/** As the platform caps them: a title to 200 characters, a post to 10,000. */
const TITLE_MAX = 200;

const BODY_MAX = 10_000;

const LINK = "decoration-rule font-medium underline hover:decoration-current";

const LABEL = "text-ui font-medium";

const HINT = "text-label text-muted-foreground font-normal";

export interface Post {
  readonly title?: string;
  readonly body?: string;
}

/** Who is posting and how a post goes, from the page's route. */
export interface Poster {
  readonly handle: Option.Option<Handle>;
  readonly here: string;
  readonly checking?: boolean | undefined;
  readonly busy?: boolean | undefined;
  readonly onPost?: ((post: Post) => void) | undefined;
  readonly refusal?: ReactNode | undefined;
  /** Counts the posts that went through, so a sent form starts empty again. */
  readonly sent?: number | undefined;
}

const trimmed = (text: string) => {
  const kept = text.trim();

  return kept === "" ? undefined : kept;
};

const Submit = ({
  busy,
  label,
  ready,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly ready: boolean;
}) => (
  <Button
    className="tablet:h-9 tablet:w-fit h-11 w-full min-w-28 px-4"
    disabled={busy || !ready}
    type="submit"
  >
    {busy ? <Spinner /> : null}
    {busy ? "Posting" : label}
  </Button>
);

const OpenFields = ({
  busy,
  onPost,
  refusal,
}: Pick<Poster, "onPost" | "refusal"> & { readonly busy: boolean }) => {
  const id = useId();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ready = trimmed(title) !== undefined;

  return (
    <form
      aria-label="Open a discussion"
      className="flex max-w-(--measure) flex-col gap-4"
      data-post-form="open"
      onSubmit={(event) => {
        event.preventDefault();

        const kept = { body: trimmed(body), title: trimmed(title) };

        if (busy || kept.title === undefined) {
          return;
        }

        onPost?.(
          kept.body === undefined
            ? { title: kept.title }
            : { body: kept.body, title: kept.title }
        );
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-title`}>
          Title
        </label>
        <Input
          id={`${id}-title`}
          maxLength={TITLE_MAX}
          name="title"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          readOnly={busy}
          required
          value={title}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-body`}>
          First post <span className={HINT}>(optional)</span>
        </label>
        <Textarea
          className="min-h-28"
          id={`${id}-body`}
          maxLength={BODY_MAX}
          name="body"
          onChange={(event) => {
            setBody(event.target.value);
          }}
          readOnly={busy}
          value={body}
        />
      </div>
      {refusal}
      <Submit busy={busy} label="Open discussion" ready={ready} />
    </form>
  );
};

const ReplyFields = ({
  busy,
  onPost,
  refusal,
}: Pick<Poster, "onPost" | "refusal"> & { readonly busy: boolean }) => {
  const id = useId();
  const [body, setBody] = useState("");
  const ready = trimmed(body) !== undefined;

  return (
    <form
      aria-label="Reply"
      className="flex max-w-(--measure) flex-col gap-4"
      data-post-form="reply"
      onSubmit={(event) => {
        event.preventDefault();

        const kept = trimmed(body);

        if (!busy && kept !== undefined) {
          onPost?.({ body: kept });
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={`${id}-body`}>
          Your reply
        </label>
        <Textarea
          className="min-h-28"
          id={`${id}-body`}
          maxLength={BODY_MAX}
          name="body"
          onChange={(event) => {
            setBody(event.target.value);
          }}
          readOnly={busy}
          required
          value={body}
        />
      </div>
      {refusal}
      <Submit busy={busy} label="Reply" ready={ready} />
    </form>
  );
};

/**
 * A thread is opened with a title, a reply is a body; signed out, the place
 * for the form is a way to sign in that comes back here.
 */
export const PostForm = ({
  busy = false,
  checking = false,
  doing,
  handle,
  here,
  kind,
  onPost,
  refusal,
  sent = 0,
}: Poster & {
  readonly kind: "open" | "reply";
  readonly doing: string;
}): ReactNode => {
  if (checking) {
    return (
      <output className="text-ui text-muted-foreground block">
        Checking who is signed in
      </output>
    );
  }

  if (Option.isNone(handle)) {
    return (
      <p className="text-ui flex items-start gap-2" data-post-signin="">
        <LogIn
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={1.75}
        />
        <span>
          <a className={LINK} href={signInHref(here)}>
            Sign in
          </a>{" "}
          to {doing}.
        </span>
      </p>
    );
  }

  const Fields = kind === "open" ? OpenFields : ReplyFields;

  // A new key per sent post clears the fields.
  return <Fields busy={busy} key={sent} onPost={onPost} refusal={refusal} />;
};
