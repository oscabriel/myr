/**
 * The sign-in and sign-up pages: small server-rendered HTML that loads
 * nothing (no script, stylesheet, font or image), so the page's CSP can be
 * `default-src 'none'`. Every value that reaches the HTML is escaped; the
 * client's name and domain come from the client itself. Google sign-in
 * adds its two choices to the sign-in page when offered, and
 * its own page for a first sign-in's handle.
 */
import { Brand } from "@repo/brand";

/** What the person must see about who asks (MCP: the client, and where access goes). */
export interface Asker {
  readonly clientDomain?: string | undefined;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly redirectIsLoopback: boolean;
}

/** The hidden fields a sign-in form carries back: the sealed request and its CSRF token. */
export interface PendingForm {
  readonly csrf: string;
  readonly request: string;
}

/** What the sign-in page offers besides a password. */
export interface Offers {
  readonly google: boolean;
}

/** The paths Google sign-in's forms and links reach (`google.ts` serves them). */
export const GOOGLE_PATHS = {
  callback: "/oauth/google/callback",
  handle: "/oauth/google/handle",
  link: "/oauth/google/link",
  start: "/oauth/google/start",
} as const;

/** `text` safe inside HTML text and a quoted attribute (`&` first). */
export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const STYLE = `
body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f6f5f2;color:#1c1b19}
main{max-width:26rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.4rem;margin:0 0 1rem}
label{display:block;margin:.75rem 0}
input{display:block;width:100%;box-sizing:border-box;padding:.5rem;font:inherit;margin-top:.25rem}
button{margin-top:1rem;padding:.5rem 1rem;font:inherit}
.error{color:#9b1c1c;font-weight:600}
.warn{background:#fff4d6;padding:.5rem .75rem}
@media (prefers-color-scheme:dark){body{background:#1c1b19;color:#f6f5f2}.warn{background:#4a3b12}.error{color:#ff9b9b}}
`;

/** A page titled `title` around `body`, which is HTML already escaped. */
export const page = (title: string, body: string) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(Brand.name)}</title>
<style>${STYLE}</style>
</head>
<body><main>
${body}
</main></body>
</html>
`;

/** Who asks, where access goes, and the loopback warning. */
const askerParagraphs = (asker: Asker) => {
  const name = `<strong>${escapeHtml(asker.clientName)}</strong>`;

  const domain =
    asker.clientDomain === undefined
      ? ""
      : ` (published by ${escapeHtml(asker.clientDomain)})`;

  const loopback = asker.redirectIsLoopback
    ? `<p class="warn">This sends access to an app on your computer. Continue only if you just started signing in from it.</p>`
    : "";

  return `<p>${name}${domain} asks to act as you. Access goes to <strong>${escapeHtml(asker.redirectHost)}</strong>.</p>
${loopback}`;
};

const messageParagraph = (message?: string) =>
  message === undefined
    ? ""
    : `<p class="error" role="alert">${escapeHtml(message)}</p>`;

const hiddenFields = (form: PendingForm) =>
  `<input type="hidden" name="request" value="${escapeHtml(form.request)}">
<input type="hidden" name="csrf" value="${escapeHtml(form.csrf)}">`;

/**
 * Google's two choices, when offered: signing in with Google (a link, so
 * no form posts to Google), and, beside the password form's own button,
 * signing in by password and then linking Google to the account.
 */
const googleChoices = (offers: Offers, form: PendingForm) =>
  offers.google
    ? {
        link: `<button type="submit" formaction="${GOOGLE_PATHS.link}">Sign in and link Google</button>`,
        start: `<p><a href="${GOOGLE_PATHS.start}?request=${encodeURIComponent(form.request)}">Continue with Google</a></p>
<p>Or sign in with your handle and password.</p>`,
      }
    : { link: "", start: "" };

/** The sign-in form, posting back to `/authorize`, with a way to sign up instead. */
export const signInPage = (
  asker: Asker,
  form: PendingForm,
  offers: Offers,
  message?: string
) => {
  const google = googleChoices(offers, form);

  return page(
    "Sign in",
    `<h1>Sign in to ${escapeHtml(Brand.name)}</h1>
${askerParagraphs(asker)}
${messageParagraph(message)}
${google.start}
<form method="post" action="/authorize">
${hiddenFields(form)}
<label>Handle <input name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
${google.link}
</form>
<p>New here? <a href="/signup?request=${encodeURIComponent(form.request)}">Choose a handle and sign up</a>.</p>`
  );
};

/**
 * A first sign-in with Google: Google confirmed the person, and they choose
 * the handle the platform will know them by (sign-up's rules), posting to
 * Google sign-in's handle path. One who has a password account signs in
 * with it instead, and links Google from there.
 */
export const pickHandlePage = (
  asker: Asker,
  form: PendingForm,
  signInHref: string,
  message?: string
) =>
  page(
    "Choose a handle",
    `<h1>Choose your handle on ${escapeHtml(Brand.name)}</h1>
${askerParagraphs(asker)}
<p>Google confirmed who you are. This Google account has not signed in here before: choose the handle people will know you by.</p>
${messageParagraph(message)}
<form method="post" action="${GOOGLE_PATHS.handle}">
${hiddenFields(form)}
<label>Handle <input name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="39" required></label>
<button type="submit">Sign up</button>
</form>
<p>Have an account with a password? <a href="${escapeHtml(signInHref)}">Sign in with it</a> and choose "Sign in and link Google".</p>`
  );

/** The sign-up form, posting to `/signup`, with a way back to signing in. */
export const signUpPage = (
  asker: Asker,
  form: PendingForm,
  signInHref: string,
  message?: string
) =>
  page(
    "Sign up",
    `<h1>Sign up for ${escapeHtml(Brand.name)}</h1>
${askerParagraphs(asker)}
${messageParagraph(message)}
<form method="post" action="/signup">
${hiddenFields(form)}
<label>Handle <input name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="39" required></label>
<label>Password, 12 to 256 characters <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
<button type="submit">Sign up</button>
</form>
<p>Have an account? <a href="${escapeHtml(signInHref)}">Sign in</a>.</p>`
  );

/** A page with nothing to do but read why, and start again from the app. */
export const problemPage = (message: string) =>
  page(
    "Sign-in problem",
    `<h1>Signing in did not work</h1>
${messageParagraph(message)}`
  );
