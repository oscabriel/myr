// Loads nothing (no script, stylesheet, font or image), so the page's CSP can be `default-src 'none'`.
import { Brand } from "@repo/brand";

export interface Asker {
  readonly clientDomain?: string | undefined;
  readonly clientName: string;
  readonly redirectHost: string;
  readonly redirectIsLoopback: boolean;
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

// The web's focus shell, drawn without its code: the sage garden palette's
// values copied from apps/web/src/styles.css as hex (the paper, ink, rule,
// muted, input, primary and state roles, light and dark), and its faces named
// first. No font may load here, so IBM Plex is used where the reader has it
// installed and the system's faces stand in otherwise.
const STYLE = `
:root{color-scheme:light dark;--paper:#f8f7f4;--ink:#1a1f2e;--card:#ffffff;--surface:#e8e6e1;--muted:#5d6371;--rule:#d6d4cf;--input:#79808f;--primary:#677a6d;--on-primary:#ffffff;--refused:#ae2325;--waiting:#516012;--selection:#0c628c38}
@media (prefers-color-scheme:dark){:root{--paper:#0a0a0a;--ink:#f5f5f5;--card:#121212;--surface:#1a1a1a;--muted:#a0a0a0;--rule:#2a2a2a;--input:#696969;--primary:#7c9082;--on-primary:#000000;--refused:#ff5451;--waiting:#bad074;--selection:#68bbef38}}
*{box-sizing:border-box}
body{margin:0;background-color:var(--paper);color:var(--ink);caret-color:var(--ink);font-family:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%;text-size-adjust:100%}
::selection{background-color:var(--selection);color:var(--ink)}
.top{display:flex;justify-content:center;padding:48px 16px 0}
.wordmark{margin:0;font-size:1.75rem;line-height:2.25rem;font-weight:600;letter-spacing:-.02em}
main{max-width:27rem;margin:0 auto;padding:32px 16px 64px}
main.document{max-width:44rem;padding-top:48px}
.card{background-color:var(--card);border:1px solid var(--rule);border-radius:2px;padding:28px 24px}
.card>:last-child{margin-bottom:0}
h1{font-size:1.5rem;line-height:2rem;font-weight:600;letter-spacing:-.015em;margin:0 0 20px;text-wrap:balance;overflow-wrap:anywhere}
h2{font-size:1.1875rem;line-height:1.6rem;font-weight:600;letter-spacing:-.01em;margin:40px 0 12px}
p{margin:0 0 16px}
a{color:var(--ink);text-decoration-color:var(--input);text-decoration-thickness:1px;text-underline-offset:.2em}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
strong{font-weight:600}
.consent{border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:16px 0;margin:0 0 24px;overflow-wrap:anywhere}
.consent p{margin:0}
.consent p+p{margin-top:4px}
.consent .warning{margin-top:12px}
.consent .may{margin:4px 0 12px}
.consent .may li{margin:0 0 4px}
.warn{color:var(--waiting);font-weight:600;white-space:nowrap}
.warn svg{width:16px;height:16px;vertical-align:-2px;margin-right:6px}
.error{color:var(--refused);font-weight:600;overflow-wrap:anywhere}
.muted{color:var(--muted)}
form{margin:0 0 24px}
label{display:block;margin:0 0 16px;font-size:.875rem;line-height:1.3rem;font-weight:500}
input{display:block;width:100%;height:44px;margin-top:6px;padding:0 12px;font-family:inherit;font-size:16px;font-weight:400;color:var(--ink);background-color:var(--paper);border:1px solid;border-color:var(--input);border-radius:2px}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;font-family:inherit;font-size:1rem;font-weight:500;text-decoration:none;border:1px solid;border-radius:2px;cursor:pointer}
button{color:var(--on-primary);background-color:var(--primary);border-color:var(--primary)}
button.secondary,.button{color:var(--ink);background-color:var(--card);border-color:var(--input)}
button:hover{opacity:.88}
button.secondary:hover,.button:hover{background-color:var(--surface);opacity:1}
.button{display:flex;width:100%}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
pre{margin:8px 0 12px;padding:8px 12px;overflow-x:auto;background-color:var(--surface);border:1px solid var(--rule)}
code{font-family:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.8125rem;overflow-wrap:anywhere}
ul{margin:0;padding-left:1.25rem}
li{margin:0 0 8px}
`;

type Width = "form" | "document";

// A form is the focus shell: the wordmark as text above one card, and no
// navigation. A document (the platform's `/`) reads as plain prose.
const frame = (body: string, width: Width) =>
  width === "document"
    ? `<main class="document">
${body}
</main>`
    : `<header class="top"><p class="wordmark">${escapeHtml(Brand.name)}</p></header>
<main><div class="card">
${body}
</div></main>`;

// `body` is HTML already escaped.
export const page = (title: string, body: string, width: Width = "form") =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} · ${escapeHtml(Brand.name)}</title>
<style>${STYLE}</style>
</head>
<body>${frame(body, width)}</body>
</html>
`;

const WARNING_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75 14.75 14H1.25z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.25v3.5M8 11.75v.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// What a grant lets a client do: it acts as the person, through the CLI's
// contracts, MCP and the git gateway alike.
const MAY = `<p>As you, it may:</p>
<ul class="may">
<li>Read what you can read: projects, asks, code, verdicts, and any layer whose audience you are in</li>
<li>Claim, release and answer asks, and push to your forks</li>
<li>Make projects, and propose and flag asks</li>
<li>Open asks, take decisions and set write-only values where you are a maintainer; nobody can read a value back</li>
</ul>
<p>It never sees your password.</p>`;

type Says = "who" | "who and what";

const askerParagraphs = (asker: Asker, says: Says = "who") => {
  const name = `<strong>${escapeHtml(asker.clientName)}</strong>`;

  const domain =
    asker.clientDomain === undefined
      ? ""
      : ` (published by ${escapeHtml(asker.clientDomain)})`;

  const loopback = asker.redirectIsLoopback
    ? `<p class="warning"><strong class="warn">${WARNING_MARK}Warning</strong> This sends access to an app on your computer. Continue only if you just started signing in from it.</p>`
    : "";

  return `<section class="consent" aria-label="Who asks">
<p>${name}${domain} asks to act as you.</p>
<p>Access goes to <strong>${escapeHtml(asker.redirectHost)}</strong>.</p>
${loopback}
${says === "who and what" ? MAY : ""}
</section>`;
};

const messageParagraph = (message?: string) =>
  message === undefined
    ? ""
    : `<p class="error" role="alert">${escapeHtml(message)}</p>`;

const hiddenFields = (form: PendingForm) =>
  `<input type="hidden" name="request" value="${escapeHtml(form.request)}">
<input type="hidden" name="csrf" value="${escapeHtml(form.csrf)}">`;

// A link, so no form posts to Google.
const googleChoices = (offers: Offers, form: PendingForm) =>
  offers.google
    ? {
        link: `<button type="submit" class="secondary" formaction="${GOOGLE_PATHS.link}">Sign in and link Google</button>`,
        start: `<p><a href="${GOOGLE_PATHS.start}?request=${encodeURIComponent(form.request)}" class="button">Continue with Google</a></p>
<p class="muted">Or sign in with your email or handle and password.</p>`,
      }
    : { link: "", start: "" };

const valueOf = (value?: string) =>
  value === undefined ? "" : ` value="${escapeHtml(value)}"`;

const withRequest = (path: string, form: PendingForm) =>
  `${path}?request=${encodeURIComponent(form.request)}`;

export const signInPage = (
  asker: Asker,
  form: PendingForm,
  offers: Offers,
  message?: string
) => {
  const google = googleChoices(offers, form);

  return page(
    "Sign in",
    `<h1>Sign in</h1>
${askerParagraphs(asker, "who and what")}
${google.start}
${messageParagraph(message)}
<form method="post" action="/authorize">
${hiddenFields(form)}
<label>Email or handle <input name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<div class="actions">
<button type="submit">Sign in</button>
${google.link}
</div>
</form>
<p><a href="${withRequest(ACCOUNT_PATHS.reset, form)}">Forgot your password?</a></p>
<p>New here? <a href="${withRequest("/signup", form)}">Sign up</a>.</p>`
  );
};

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
<p>Google confirmed who you are. This Google account has not signed in here before: choose the handle and name people will know you by.</p>
${messageParagraph(message)}
<form method="post" action="${GOOGLE_PATHS.handle}">
${hiddenFields(form)}
${DISPLAY_NAME_FIELD(values.displayName)}
${HANDLE_FIELD(values.handle)}
<div class="actions"><button type="submit">Sign up</button></div>
</form>
<p>Have an account with a password? <a href="${escapeHtml(signInHref)}">Sign in with it</a> and choose "Sign in and link Google".</p>`
  );

export interface SignUpValues extends ProfileValues {
  readonly email?: string;
}

export const signUpPage = (
  asker: Asker,
  form: PendingForm,
  signInHref: string,
  values: SignUpValues,
  message?: string
) =>
  page(
    "Sign up",
    `<h1>Sign up</h1>
${askerParagraphs(asker, "who and what")}
${messageParagraph(message)}
<form method="post" action="/signup">
${hiddenFields(form)}
<label>Email <input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required${valueOf(values.email)}></label>
${DISPLAY_NAME_FIELD(values.displayName)}
${HANDLE_FIELD(values.handle)}
<label>Password, 12 to 256 characters <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
<div class="actions"><button type="submit">Sign up</button></div>
</form>
<p>We mail a code to the address, to check it is yours.</p>
<p>Have an account? <a href="${escapeHtml(signInHref)}">Sign in</a>.</p>`
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
    `<h1>Enter the code we mailed you</h1>
${askerParagraphs(asker)}
<p>${escapeHtml(code.intro)} It works for 10 minutes.</p>
${messageParagraph(message)}
<form method="post" action="${code.action}">
${hiddenFields(form)}
<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 -]*" maxlength="12" required></label>
${code.newPassword ? `<label>New password, 12 to 256 characters <input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>` : ""}
<div class="actions"><button type="submit">Continue</button></div>
</form>
<p>No mail? Check your spam folder, or <a href="${escapeHtml(code.startOverHref)}">start again</a>.</p>`
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
<div class="actions"><button type="submit">Send the code</button></div>
</form>
<p><a href="${escapeHtml(startOverHref)}">Sign in as someone else</a></p>`
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
<div class="actions"><button type="submit">Send the code</button></div>
</form>
<p>Remembered it? <a href="${escapeHtml(signInHref)}">Sign in</a>.</p>`
  );

export const problemPage = (message: string) =>
  page(
    "Sign-in problem",
    `<h1>Signing in did not work</h1>
<p role="alert">${escapeHtml(message)}</p>
<p><a href="/">What this host serves</a></p>`
  );
