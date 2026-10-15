// Loads nothing (no script, stylesheet, font or image), so the page's CSP can be `default-src 'none'`.
import { Brand } from "@repo/brand";

import type { FirstParty } from "./first-party.ts";

export interface Asker {
  readonly clientDomain?: string | undefined;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly redirectIsLoopback: boolean;
  // Our own web or CLI, told by the client's id: neither is asked to consent.
  readonly firstParty?: FirstParty | undefined;
  // The web's home, which the wordmark links to; the platform's `/` when it is not known.
  readonly home?: string | undefined;
}

export interface PendingForm {
  readonly csrf: string;
  readonly request: string;
}

export interface Offers {
  readonly google: boolean;
}

// Under `/oauth/`, which the platform already keeps for sign-in.
export const ACCOUNT_PATHS = {
  addEmail: "/oauth/email",
  addEmailVerify: "/oauth/email/verify",
  reset: "/oauth/reset",
  resetVerify: "/oauth/reset/verify",
  signUpVerify: "/oauth/signup/verify",
} as const;

export const GOOGLE_PATHS = {
  callback: "/oauth/google/callback",
  handle: "/oauth/google/handle",
  link: "/oauth/google/link",
  start: "/oauth/google/start",
} as const;

// `&` first.
export const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// The web's focus card, drawn without its code: the sage garden palette's
// values copied from apps/web/src/styles.css as hex (the paper, ink, rule,
// muted, input, primary and state roles, light and dark), and its faces named
// first. No font may load here, so IBM Plex is used where the reader has it
// installed and the system's faces stand in otherwise. One centred column of
// the card's width: the wordmark over the card, and what leads elsewhere
// under it. From 640 px the card is a hairline-bordered surface on the paper;
// on a phone it is the page itself, with no border to box it in.
const STYLE = `
:root{color-scheme:light dark;--paper:#f8f7f4;--ink:#1a1f2e;--card:#ffffff;--surface:#e8e6e1;--muted:#5d6371;--rule:#d6d4cf;--input:#79808f;--primary:#677a6d;--on-primary:#ffffff;--refused:#ae2325;--waiting:#516012;--selection:#0c628c38}
@media (prefers-color-scheme:dark){:root{--paper:#0a0a0a;--ink:#f5f5f5;--card:#121212;--surface:#1a1a1a;--muted:#a0a0a0;--rule:#2a2a2a;--input:#696969;--primary:#7c9082;--on-primary:#000000;--refused:#ff5451;--waiting:#bad074;--selection:#68bbef38}}
*{box-sizing:border-box}
body{margin:0;background-color:var(--paper);color:var(--ink);caret-color:var(--ink);font-family:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%;text-size-adjust:100%}
::selection{background-color:var(--selection);color:var(--ink)}
.shell{max-width:28rem;margin:0 auto;padding:28px 16px 48px}
.top{display:flex;justify-content:center;margin:0 0 28px}
.wordmark{font-size:1.1875rem;line-height:1.6rem;font-weight:600;letter-spacing:-.02em;color:var(--ink);text-decoration:none}
.card{background-color:var(--card);border:1px solid var(--rule);border-radius:2px;padding:32px}
.card>:last-child{margin-bottom:0}
@media (max-width:39.99em){.card{background-color:transparent;border-color:transparent;padding:0}}
@media (min-width:40em){.shell{padding:12vh 24px 64px}}
main.document{max-width:44rem;margin:0 auto;padding:48px 16px 64px}
h1{font-size:1.5rem;line-height:2rem;font-weight:600;letter-spacing:-.015em;margin:0 0 24px;text-wrap:balance;overflow-wrap:anywhere}
h2{font-size:1.1875rem;line-height:1.6rem;font-weight:600;letter-spacing:-.01em;margin:40px 0 12px}
p{margin:0 0 16px}
a{color:var(--ink);text-decoration-color:var(--input);text-decoration-thickness:1px;text-underline-offset:.2em}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
strong{font-weight:600}
.small{font-size:.875rem;line-height:1.3rem}
.lead{margin:-16px 0 24px}
.consent{margin:-8px 0 24px;font-size:.875rem;line-height:1.3rem;padding:0 0 20px;border-bottom:1px solid var(--rule);overflow-wrap:anywhere}
.consent p{margin:0 0 4px}
.consent .warning{margin-top:12px}
details{margin-top:12px}
summary{cursor:pointer;font-weight:500}
details ul{margin:8px 0 0}
details li{margin:0 0 4px}
.warn{color:var(--waiting);font-weight:600;white-space:nowrap}
.warn svg{width:16px;height:16px;vertical-align:-2px;margin-right:6px}
.error{color:var(--refused);font-weight:500;font-size:.875rem;line-height:1.3rem;overflow-wrap:anywhere}
.muted{color:var(--muted)}
form{margin:0}
label{display:block;margin:0 0 16px;font-size:.875rem;line-height:1.3rem;font-weight:500}
.field{margin:0 0 16px}
.field-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.field-head label{margin:0}
.field-head a{font-size:.875rem;line-height:1.3rem;font-weight:400;color:var(--muted);text-decoration:none}
.field-head a:hover{color:var(--ink);text-decoration:underline}
input{display:block;width:100%;height:44px;margin-top:6px;padding:0 12px;font-family:inherit;font-size:16px;font-weight:400;color:var(--ink);background-color:var(--paper);border:1px solid;border-color:var(--input);border-radius:2px}
button,.button{display:flex;width:100%;align-items:center;justify-content:center;gap:10px;min-height:44px;padding:0 16px;font-family:inherit;font-size:1rem;font-weight:500;line-height:1.25rem;text-decoration:none;border:1px solid;border-radius:2px;cursor:pointer}
button{color:var(--on-primary);background-color:var(--primary);border-color:var(--primary)}
.button{color:var(--ink);background-color:var(--card);border-color:var(--input)}
button:hover{opacity:.9}
.button:hover{background-color:var(--surface)}
.button svg{flex:none;width:18px;height:18px}
button.link{display:block;width:auto;min-height:0;margin:16px auto 0;padding:2px 4px;color:var(--muted);background-color:transparent;border:0;font-size:.875rem;line-height:1.3rem;font-weight:400;text-decoration:none;text-underline-offset:.2em}
button.link:hover{color:var(--ink);opacity:1;text-decoration:underline}
.submit{margin-top:24px}
.or{display:flex;align-items:center;gap:12px;margin:20px 0}
.or .line{flex:1;height:1px;background-color:var(--rule)}
.aside{margin:24px 0 0;text-align:center}
pre{margin:8px 0 12px;padding:8px 12px;overflow-x:auto;background-color:var(--surface);border:1px solid var(--rule)}
code{font-family:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.8125rem;overflow-wrap:anywhere}
ul{margin:0;padding-left:1.25rem}
li{margin:0 0 8px}
`;

type Width = "form" | "document";

interface Frame {
  // The web's home, which the wordmark links to.
  readonly home?: string | undefined;
  // What leads elsewhere, under the card.
  readonly after?: string;
}

// A form is the focus card: the wordmark over it, a line under it, and no
// navigation. A document (the platform's `/`) reads as plain prose.
const framed = (body: string, width: Width, frame: Frame) =>
  width === "document"
    ? `<main class="document">
${body}
</main>`
    : `<div class="shell"><header class="top"><a class="wordmark" href="${escapeHtml(frame.home ?? "/")}">${escapeHtml(Brand.name)}</a></header>
<main class="card">
${body}
</main>${frame.after === undefined ? "" : `\n<p class="aside small muted">${frame.after}</p>`}</div>`;

// `body` and `frame.after` are HTML already escaped.
export const page = (
  title: string,
  body: string,
  width: Width = "form",
  frame: Frame = {}
) =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · ${escapeHtml(Brand.name)}</title>
<style>${STYLE}</style>
</head>
<body>${framed(body, width, frame)}</body>
</html>
`;

const WARNING_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75 14.75 14H1.25z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.25v3.5M8 11.75v.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// Google's "G", in its own colours, as its sign-in buttons show it.
const GOOGLE_MARK = `<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>`;

// What a grant lets a client do: it acts as the person, through the CLI's
// contracts, MCP and the git gateway alike.
const MAY = `<details>
<summary>What it can do</summary>
<ul class="may">
<li>Read what you can read: projects, asks, code, verdicts, and any layer whose audience you are in</li>
<li>Claim, release and answer asks, and push to your forks</li>
<li>Make projects, and propose and flag asks</li>
<li>Open asks, take decisions, finish answers, land changes, vouch for or denounce people, and set write-only values where you are a maintainer; nobody can read a value back</li>
</ul>
<p>It never sees your password.</p>
</details>`;

type Says = "who" | "who and what";

/**
 * Who asks, said only of a client that is not ours: the web says nothing, and
 * the CLI one line, since the person started it themselves a moment ago.
 */
const askerParagraphs = (asker: Asker, says: Says = "who") => {
  if (asker.firstParty === "web") {
    return "";
  }

  if (asker.firstParty === "cli") {
    return `<p class="lead small muted">This finishes signing in the CLI on this computer. Continue only if you just ran <code>${escapeHtml(Brand.cli)} login</code>.</p>`;
  }

  const name = `<strong>${escapeHtml(asker.clientName)}</strong>`;

  const domain =
    asker.clientDomain === undefined
      ? ""
      : ` (${escapeHtml(asker.clientDomain)})`;

  const loopback = asker.redirectIsLoopback
    ? `<p class="warning"><strong class="warn">${WARNING_MARK}Warning</strong> This sends access to an app on your computer. Continue only if you just started signing in from it.</p>`
    : "";

  const label = says === "who" ? "Who asks" : "Who asks and what it may do";

  return `<section class="consent" aria-label="${label}">
<p>${name}${domain} wants to act as you.</p>
<p>Access goes to <strong>${escapeHtml(asker.redirectHost)}</strong>.</p>
${loopback}
${says === "who and what" ? MAY : ""}
</section>`;
};

const homeOf = (asker: Asker): Frame => ({ home: asker.home });

const messageParagraph = (message?: string) =>
  message === undefined
    ? ""
    : `<p class="error" role="alert">${escapeHtml(message)}</p>`;

const hiddenFields = (form: PendingForm) =>
  `<input type="hidden" name="request" value="${escapeHtml(form.request)}">
<input type="hidden" name="csrf" value="${escapeHtml(form.csrf)}">`;

const OR = `<div class="or small muted"><span class="line" aria-hidden="true"></span>or<span class="line" aria-hidden="true"></span></div>`;

// A link, so no form posts to Google.
const googleStart = (offers: Offers, form: PendingForm) =>
  offers.google
    ? `<a href="${GOOGLE_PATHS.start}?request=${encodeURIComponent(form.request)}" class="button">${GOOGLE_MARK}Continue with Google</a>
${OR}`
    : "";

const LINK_GOOGLE = "Sign in and link your Google account";

const valueOf = (value?: string) =>
  value === undefined ? "" : ` value="${escapeHtml(value)}"`;

const withRequest = (path: string, form: PendingForm) =>
  `${path}?request=${encodeURIComponent(form.request)}`;

export const signInPage = (
  asker: Asker,
  form: PendingForm,
  offers: Offers,
  message?: string
) =>
  page(
    "Sign in",
    `<h1>Sign in to ${escapeHtml(Brand.name)}</h1>
${askerParagraphs(asker, "who and what")}
${googleStart(offers, form)}
${messageParagraph(message)}
<form method="post" action="/authorize">
${hiddenFields(form)}
<label>Email or handle <input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
<div class="field">
<div class="field-head"><label for="password">Password</label><a href="${withRequest(ACCOUNT_PATHS.reset, form)}">Forgot password?</a></div>
<input type="password" name="password" id="password" autocomplete="current-password" required>
</div>
<div class="submit"><button type="submit">Sign in</button></div>
${offers.google ? `<button type="submit" class="link" formaction="${GOOGLE_PATHS.link}">${LINK_GOOGLE}</button>` : ""}
</form>`,
    "form",
    {
      ...homeOf(asker),
      after: `New here? <a href="${withRequest("/signup", form)}">Create an account</a>`,
    }
  );

export interface ProfileValues {
  readonly displayName?: string;
  readonly handle?: string;
}

const HANDLE_FIELD = (value?: string) =>
  `<label>Handle, the name in your projects' addresses <input name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="39" required${valueOf(value)}></label>`;

const DISPLAY_NAME_FIELD = (value?: string) =>
  `<label>Display name <input name="displayName" autocomplete="name" maxlength="64" required${valueOf(value)}></label>`;

export const profilePage = (
  asker: Asker,
  form: PendingForm,
  signInHref: string,
  values: ProfileValues,
  message?: string
) =>
  page(
    "Set up your profile",
    `<h1>Set up your profile</h1>
${askerParagraphs(asker)}
<p>Google confirmed who you are. Choose the handle and name people will know you by.</p>
${messageParagraph(message)}
<form method="post" action="${GOOGLE_PATHS.handle}">
${hiddenFields(form)}
${DISPLAY_NAME_FIELD(values.displayName)}
${HANDLE_FIELD(values.handle)}
<div class="submit"><button type="submit">Create account</button></div>
</form>`,
    "form",
    {
      ...homeOf(asker),
      after: `Have an account with a password? <a href="${escapeHtml(signInHref)}">Sign in with it</a>, then choose "${LINK_GOOGLE}".`,
    }
  );

export interface SignUpValues extends ProfileValues {
  readonly email?: string;
}

export const signUpPage = (
  asker: Asker,
  form: PendingForm,
  offers: Offers,
  signInHref: string,
  values: SignUpValues,
  message?: string
) =>
  page(
    "Create your account",
    `<h1>Create your account</h1>
${askerParagraphs(asker, "who and what")}
${googleStart(offers, form)}
${messageParagraph(message)}
<form method="post" action="/signup">
${hiddenFields(form)}
<label>Email <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required${valueOf(values.email)}></label>
${DISPLAY_NAME_FIELD(values.displayName)}
${HANDLE_FIELD(values.handle)}
<label>Password, 12 to 256 characters <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
<div class="submit"><button type="submit">Create account</button></div>
</form>
<p class="small muted aside">We mail a code to the address, to check it is yours.</p>`,
    "form",
    {
      ...homeOf(asker),
      after: `Have an account? <a href="${escapeHtml(signInHref)}">Sign in</a>`,
    }
  );

export interface CodeForm {
  readonly action: string;
  // Said above the form: where the code went, and what it is for.
  readonly intro: string;
  // A reset sets the new password in the same form.
  readonly newPassword: boolean;
  readonly startOverHref: string;
}

export const codePage = (
  asker: Asker,
  form: PendingForm,
  code: CodeForm,
  message?: string
) =>
  page(
    "Enter the code",
    `<h1>Check your email</h1>
${askerParagraphs(asker)}
<p>${escapeHtml(code.intro)} It works for 10 minutes.</p>
${messageParagraph(message)}
<form method="post" action="${code.action}">
${hiddenFields(form)}
<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 -]*" maxlength="12" required></label>
${code.newPassword ? `<label>New password, 12 to 256 characters <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>` : ""}
<div class="submit"><button type="submit">Continue</button></div>
</form>`,
    "form",
    {
      ...homeOf(asker),
      after: `No mail? Check your spam folder, or <a href="${escapeHtml(code.startOverHref)}">start again</a>.`,
    }
  );

export const addEmailPage = (
  asker: Asker,
  form: PendingForm,
  startOverHref: string,
  value?: string,
  message?: string
) =>
  page(
    "Add your email",
    `<h1>Add your email</h1>
${askerParagraphs(asker)}
<p>Your account has no email yet. Add one to finish signing in: we mail it a code, and it is how you reset your password.</p>
${messageParagraph(message)}
<form method="post" action="${ACCOUNT_PATHS.addEmail}">
${hiddenFields(form)}
<label>Email <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required${valueOf(value)}></label>
<div class="submit"><button type="submit">Send the code</button></div>
</form>`,
    "form",
    {
      ...homeOf(asker),
      after: `<a href="${escapeHtml(startOverHref)}">Sign in as someone else</a>`,
    }
  );

export const resetPage = (
  asker: Asker,
  form: PendingForm,
  signInHref: string,
  value?: string,
  message?: string
) =>
  page(
    "Reset your password",
    `<h1>Reset your password</h1>
${askerParagraphs(asker)}
<p>Enter your account's email. We mail it a code to set a new password with.</p>
${messageParagraph(message)}
<form method="post" action="${ACCOUNT_PATHS.reset}">
${hiddenFields(form)}
<label>Email <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required${valueOf(value)}></label>
<div class="submit"><button type="submit">Send the code</button></div>
</form>`,
    "form",
    {
      ...homeOf(asker),
      after: `Remembered it? <a href="${escapeHtml(signInHref)}">Sign in</a>`,
    }
  );

export const problemPage = (message: string, home = "/") =>
  page(
    "Sign-in problem",
    `<h1>Signing in did not work</h1>
<p role="alert">${escapeHtml(message)}</p>
<p><a href="${escapeHtml(home)}">Back to ${escapeHtml(Brand.name)}</a></p>`,
    "form",
    { home }
  );
