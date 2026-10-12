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

// The system's sans, since no font may load here.
const STYLE = `
:root{color-scheme:light dark;--paper:#f5f8fa;--ink:#14191f;--surface:#edf0f3;--muted:#595e65;--rule:#ced1d6;--input:#82868c;--refused:#b32322;--waiting:#875814;--selection:#175fa438}
@media (prefers-color-scheme:dark){:root{--paper:#0e1114;--ink:#e9ebee;--surface:#171a1e;--muted:#a1a5ab;--rule:#32363b;--input:#6e7278;--refused:#f87e77;--waiting:#efba64;--selection:#79b6f438}}
*{box-sizing:border-box}
body{margin:0;background-color:var(--paper);color:var(--ink);caret-color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5;-webkit-text-size-adjust:100%;text-size-adjust:100%}
::selection{background-color:var(--selection);color:var(--ink)}
main{max-width:26rem;margin:0 auto;padding:48px 16px 64px}
main.document{max-width:44rem}
h1{font-size:1.5rem;line-height:2rem;font-weight:600;letter-spacing:-.015em;margin:0 0 24px;text-wrap:balance;overflow-wrap:anywhere}
h2{font-size:1.1875rem;line-height:1.6rem;font-weight:600;letter-spacing:-.01em;margin:40px 0 12px}
p{margin:0 0 16px}
a{color:var(--ink);text-decoration-color:var(--input);text-decoration-thickness:1px;text-underline-offset:.2em}
a:hover{text-decoration-color:currentColor}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
strong{font-weight:600}
.consent{border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:16px 0;margin:0 0 24px;overflow-wrap:anywhere}
.consent p{margin:0}
.consent p+p{margin-top:4px}
.consent .warning{margin-top:12px}
.warn{color:var(--waiting);font-weight:600;white-space:nowrap}
.warn svg{width:16px;height:16px;vertical-align:-2px;margin-right:6px}
.error{color:var(--refused);font-weight:600;overflow-wrap:anywhere}
.muted{color:var(--muted)}
form{margin:0 0 24px}
label{display:block;margin:0 0 16px;font-size:.875rem;line-height:1.3rem;font-weight:500}
input{display:block;width:100%;height:44px;margin-top:6px;padding:0 12px;font-family:inherit;font-size:16px;font-weight:400;color:var(--ink);background-color:var(--paper);border:1px solid;border-color:var(--input);border-radius:0}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;font-family:inherit;font-size:1rem;font-weight:500;text-decoration:none;border:1px solid;border-radius:0;cursor:pointer}
button{color:var(--paper);background-color:var(--ink);border-color:var(--ink)}
button.secondary,.button{color:var(--ink);background-color:var(--paper);border-color:var(--input)}
button:hover{opacity:.88}
button.secondary:hover,.button:hover{background-color:var(--surface);opacity:1}
.button{display:flex;width:100%}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
pre{margin:8px 0 12px;padding:8px 12px;overflow-x:auto;background-color:var(--surface);border:1px solid var(--rule)}
code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.8125rem;overflow-wrap:anywhere}
ul{margin:0;padding-left:1.25rem}
li{margin:0 0 8px}
`;

type Width = "form" | "document";

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
<body><main${width === "document" ? ' class="document"' : ""}>
${body}
</main></body>
</html>
`;

const WARNING_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 1.75 14.75 14H1.25z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.25v3.5M8 11.75v.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const askerParagraphs = (asker: Asker) => {
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
<p class="muted">Or sign in with your handle and password.</p>`,
      }
    : { link: "", start: "" };

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
${google.start}
${messageParagraph(message)}
<form method="post" action="/authorize">
${hiddenFields(form)}
<label>Handle <input name="handle" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<div class="actions">
<button type="submit">Sign in</button>
${google.link}
</div>
</form>
<p>New here? <a href="/signup?request=${encodeURIComponent(form.request)}">Choose a handle and sign up</a>.</p>`
  );
};

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
<div class="actions"><button type="submit">Sign up</button></div>
</form>
<p>Have an account with a password? <a href="${escapeHtml(signInHref)}">Sign in with it</a> and choose "Sign in and link Google".</p>`
  );

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
<div class="actions"><button type="submit">Sign up</button></div>
</form>
<p>Have an account? <a href="${escapeHtml(signInHref)}">Sign in</a>.</p>`
  );

export const problemPage = (message: string) =>
  page(
    "Sign-in problem",
    `<h1>Signing in did not work</h1>
<p role="alert">${escapeHtml(message)}</p>
<p><a href="/">What this host serves</a></p>`
  );
