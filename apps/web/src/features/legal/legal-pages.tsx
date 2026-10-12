import { Brand } from "@repo/brand";

import { AppLink } from "../shared/link.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";

const CONTACT = `support@${Brand.domain}`;

const UPDATED = "October 2026";

const CROSS_LINK =
  "decoration-rule hover:decoration-foreground underline underline-offset-4";

const Section = ({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) => (
  <section className="mb-8" id={id}>
    <h2 className="text-title mb-3 font-semibold" id={`heading-${id}`}>
      {title}
    </h2>
    <div className="text-ui flex flex-col gap-3">{children}</div>
  </section>
);

export const PrivacyView = () => (
  <Workspace crumbs={[{ label: "Privacy policy" }]} title="Privacy policy">
    <p className="text-ui text-muted-foreground">
      Effective {UPDATED} · See also the{" "}
      <AppLink className={CROSS_LINK} to="/terms">
        terms of service
      </AppLink>
      .
    </p>

    <p className="text-ui">
      This page describes what {Brand.name} (&ldquo;we&rdquo;, &ldquo;the
      service&rdquo;) collects when you use the site and its tools, and what
      happens to it. Questions go to {CONTACT}.
    </p>

    <Section id="what-we-collect" title="What we collect">
      <ul className="flex list-disc flex-col gap-1.5 pl-4">
        <li>
          <strong>Account details.</strong> When you sign in, we keep your email
          address and the display name attached to the account you sign in with.
        </li>
        <li>
          <strong>Google account data.</strong> If you sign in with Google, we
          receive your Google account&apos;s name and email address. We receive
          no other Google data: no Gmail, Drive, contacts, or calendar access,
          and we never sell your Google account data.
        </li>
        <li>
          <strong>Content you push.</strong> The git repositories you create or
          import, including commits, configuration, and any other files they
          contain.
        </li>
        <li>
          <strong>Usage records.</strong> Logs of requests to the service,
          including pushes and reads, for security and for running the platform.
        </li>
      </ul>
    </Section>

    <Section id="how-we-use-it" title="How we use it">
      <ul className="flex list-disc flex-col gap-1.5 pl-4">
        <li>To create and maintain your account, and to reach you about it.</li>
        <li>To host, serve, and check the repositories you push.</li>
        <li>To keep the service secure and to prevent abuse.</li>
      </ul>
      <p>
        We do not sell your data. We do not use it for advertising. We do not
        share it with third parties except where it is needed to run the service
        (for example, our hosting provider) or where the law requires it.
      </p>
    </Section>

    <Section id="retention" title="Retention and deletion">
      <p>
        Your account data is kept for as long as your account exists. If you
        want your account and its data deleted, write to {CONTACT} and we will
        delete it. Content you have pushed to a public project is served to
        other users of the service; deleting your account removes your
        authorship records, and project maintainers decide what happens to the
        content itself.
      </p>
    </Section>

    <Section id="security" title="Security">
      <p>
        We never store a password itself, only a peppered PBKDF2 hash of it, and
        pushes and other writes require a signed-in session. We limit who and
        what can read the non-public parts of the service, and we log reads of
        those parts.
      </p>
    </Section>

    <Section id="changes" title="Changes">
      <p>
        We may update this policy as the service changes. The date at the top
        says when it was last revised.
      </p>
    </Section>
  </Workspace>
);

export const TermsView = () => (
  <Workspace crumbs={[{ label: "Terms of service" }]} title="Terms of service">
    <p className="text-ui text-muted-foreground">
      Effective {UPDATED} · See also the{" "}
      <AppLink className={CROSS_LINK} to="/privacy">
        privacy policy
      </AppLink>
      .
    </p>

    <p className="text-ui">
      These terms govern your use of {Brand.name} (&ldquo;we&rdquo;, &ldquo;the
      service&rdquo;). By using it you agree to them. Questions go to {CONTACT}.
    </p>

    <Section id="your-content" title="Your content">
      <p>
        You keep ownership of everything you push. You give us the licence we
        need to run the service: to store your content, serve it to people who
        visit the project, and copy it within our infrastructure for backups and
        for running checks. You are responsible for what you push and for having
        the right to push it.
      </p>
    </Section>

    <Section id="acceptable-use" title="Acceptable use">
      <p>
        Do not use the service to break the law, to attack other people or other
        systems, or to push content you have no right to share. We may suspend
        or remove accounts that do.
      </p>
    </Section>

    <Section id="platform-decisions" title="How changes land">
      <p>
        The service hosts git repositories and applies automated checks to
        pushes. Checks can refuse a push. We do not promise that any given push
        will land, and we may change what the checks require.
      </p>
    </Section>

    <Section id="availability" title="Availability">
      <p>
        The service is provided as is, with no promise that it will be available
        or free of errors. To the extent the law allows, we are not liable for
        losses that come from using the service.
      </p>
    </Section>

    <Section id="termination" title="Termination">
      <p>
        You may stop using the service at any time. We may suspend or close an
        account for breach of these terms, with notice where practical.
      </p>
    </Section>

    <Section id="changes" title="Changes">
      <p>
        We may update these terms as the service changes. The date at the top
        says when they were last revised.
      </p>
    </Section>
  </Workspace>
);
