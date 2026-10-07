# W3 live run on dev-oscabriel (issue 311)

Recorded 2026-10-07 against `https://platform-dev-oscabriel.oscargabriel.workers.dev`, deployed through `infra/deploy.ts` from the working tree committed with this file. The numbers are in `w3-live.json`. The harness scripts live outside this repo (wanted-explainer, `notes/git-platform-research/artifacts-probe/w3-live/`); every token came from the dev stage's secrets file and none appears below.

## The core loop, with real git

dora makes a project and first-pushes a tiny fixture, opens an ask (its check fails twice on main in the Checker), alice claims it, pushes outside its territory, then pushes the fix, which lands on `main` as a platform commit with its credit.

```text
# W3 311 live loop against https://platform-dev-oscabriel.oscargabriel.workers.dev
# 2026-10-07T20:52:20.822Z

## 1. dora makes w3live-muyl2z12 and first-pushes the fixture
> initProject as dora {"project":"w3live-muyl2z12"}
< ok in 4015 ms: {"project":"w3live-muyl2z12","remote":"https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12.git"}
$ git push origin HEAD:refs/heads/main   (as dora, exit 0, 7404 ms)
  To https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12.git
   * [new branch]      HEAD -> main

## 2. dora opens parse-iso
> openAsk as dora {"ask":"parse-iso","files":[{"content":"import { kinds, territory } from \"@myr/cli/rules\";\n\nexport default kinds.fix.ask({\n  path: \"test/parse-iso.test.ts\",\n  territory: territory.paths(\"src/parse.ts\"),\n  want: \"parse reads the year of an ISO date\",\n});\n","path":".myr/asks/parse-iso.a
< ok in 19683 ms: {"ask":{"askedBy":"dora","blockedBy":[],"brief":{"want":"parse reads the year of an ISO date"},"check":{"_tag":"RedThenGreen","path":"test/parse-iso.test.ts"},"file":".myr/asks/parse-iso.ask.ts","id":"parse-iso","kind":"fix","openedAt":"2026-10-07T20:52:33.808Z","openedIn":"24c5fd73def20e8fd47676ead8be755a6582bfcd","project":"w3live-muyl2z12","state":"open","territory":{"module":".","paths":["src/parse.ts"]}},"landed":"24c5fd73def20e8fd47676ead8be755a6582bfcd"}

## 3. alice claims parse-iso
> claim as alice {"ask":"parse-iso","project":"w3live-muyl2z12"}
< ok in 3020 ms: {"claim":{"ask":"parse-iso","base":"24c5fd73def20e8fd47676ead8be755a6582bfcd","checkCommand":"bun test test/parse-iso.test.ts","claimant":"alice","fork":"w3live-muyl2z12--parse-iso--alice","lapsesAt":"2026-10-08T20:52:53.458Z","openedAt":"2026-10-07T20:52:53.458Z","project":"w3live-muyl2z12","remote":"https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12--parse-iso--alice.git","state":"live","warnsAt":"2026-10-07T22:52:53.458Z"}}

## 4. alice pushes outside the territory
$ git push origin HEAD:refs/heads/main   (as alice, exit 1, 2863 ms)
  remote: OutOfScope: changes paths outside the ask's territory: README.md
  remote:   next: myr check
  remote:   retryable: no
  To https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12--parse-iso--alice.git
   ! [remote rejected] HEAD -> main (OutOfScope)
  error: failed to push some refs to 'https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12--parse-iso--alice.git'

## 5. alice pushes the fix
$ git push origin HEAD:refs/heads/main   (as alice, exit 0, 4210 ms)
  remote: checking parse-iso at 38fff79; follow with myr status
  To https://platform-dev-oscabriel.oscargabriel.workers.dev/w3live-muyl2z12--parse-iso--alice.git
     1b16b91..38fff79  HEAD -> main

## 6. alice's answer after 29764 ms (25 polls)
< {"ask":"parse-iso","at":"2026-10-07T20:53:27.268Z","head":"38fff79b1ddd8f8042bf75a9e51bf43e04b824f6","outcome":{"_tag":"Landed","sha":"8cbf660f14a4b1ffe471936aaec3137aa5222dfd"},"requestId":"push-38fff79b1ddd8f8042bf75a9e51bf43e04b824f6-alice"}
> verdict as alice {"ask":"parse-iso","project":"w3live-muyl2z12"}
< ok in 37 ms: {"verdict":{"ask":"parse-iso","at":"2026-10-07T20:53:22.581Z","base":"24c5fd73def20e8fd47676ead8be755a6582bfcd","checkVersion":"redThenGreen@0.0.0+e30a26e6ee24ec97","head":"38fff79b1ddd8f8042bf75a9e51bf43e04b824f6","heldBack":[],"lanes":[{"command":"bun test test/parse-iso.test.ts","durationMs":215,"lane":"redThenGreen","result":"passed"}],"outcome":{"_tag":"Landed","sha":"8cbf660f14a4b1ffe471936aaec3137aa5222dfd"},"patchId":"c173f6a3dabd617e3cb27d8e274c862371451137098d1f98f2f7d51f7835d96a","project":"w3live-muyl2z12","stage":"human","tree":"629fac65a86f48dc2ac8ffcad0df2415bfe0bf63","verifier":"platform"}}

## 7. main on canonical
$ git log -1 --format='%an|%cn|%(trailers)' origin/main
alice|Myr|Asked-by: dora <dora@users.myr.technology>
Signed-off-by: alice <alice@users.myr.technology>
Ask: w3live-muyl2z12/parse-iso
Verdict: c173f6a3dabd617e3cb27d8e274c862371451137098d1f98f2f7d51f7835d96a redThenGreen@0.0.0+e30a26e6ee24ec97
Request-Id: push-38fff79b1ddd8f8042bf75a9e51bf43e04b824f6-alice
> landing as anonymous {"project":"w3live-muyl2z12","sha":"8cbf660f14a4b1ffe471936aaec3137aa5222dfd"}
< ok in 43 ms: {"landing":{"ask":"parse-iso","assisted":[],"author":"alice","credits":[{"handle":"dora","role":"Asked-by"},{"handle":"alice","role":"Signed-off-by"}],"landedAt":"2026-10-07T20:53:27.268Z","parent":"24c5fd73def20e8fd47676ead8be755a6582bfcd","project":"w3live-muyl2z12","requestId":"push-38fff79b1ddd8f8042bf75a9e51bf43e04b824f6-alice","sha":"8cbf660f14a4b1ffe471936aaec3137aa5222dfd","verdict":{"ask":"parse-iso","at":"2026-10-07T20:53:22.581Z","base":"24c5fd73def20e8fd47676ead8be755a6582bfcd","checkVersion":"redThenGreen@0.0.0+e30a26e6ee24ec97","head":"38fff79b1ddd8f8042bf75a9e51bf43e04b824f6","heldBack":[],"lanes":[{"command":"bun test test/parse-iso.test.ts","durationMs":215,"lane":"redThenGreen","result":"passed"}],"outcome":{"_tag":"Checking","stage":"human"},"patchId":"c173f6a3dabd617e3cb27d8e274c862371451137098d1f98f2f7d51f7835d96a","project":"w3live-muyl2z12","stage":"human","tree":"629fac65a86f48dc2ac8ffcad0df2415bfe0bf63","verifier":"platform"}}}
```

## Sign-up and a CLI-style PKCE login

```json
{
  "handle": "w3tester-muyk9zdx",
  "origin": "https://platform-dev-oscabriel.oscargabriel.workers.dev",
  "authorize": {
    "hasForm": true,
    "status": 200
  },
  "signupPage": {
    "hasCsrf": true,
    "status": 200
  },
  "signup": {
    "redirectsToLoopback": true,
    "status": 302,
    "withCode": true
  },
  "token": {
    "hasAccessToken": true,
    "hasRefreshToken": true,
    "status": 200,
    "tokenType": "bearer"
  },
  "status": {
    "ms": 85,
    "reply": [
      {
        "_tag": "Exit",
        "requestId": "1",
        "exit": {
          "_tag": "Success",
          "value": {
            "answers": [],
            "claims": []
          }
        }
      }
    ],
    "status": 200
  },
  "statusAnonymous": {
    "error": [
      {
        "_tag": "Unauthenticated"
      }
    ],
    "ms": 68,
    "ok": false
  },
  "googleRedirectUri": "https://platform-dev-oscabriel.oscargabriel.workers.dev/oauth/google/callback"
}
```

## Remote MCP

Claude Code over HTTP (`claude -p … --model haiku --mcp-config <file> --strict-mcp-config --output-format json`; the bearer token comes from a `headersHelper`, so it sits in no file):

```text
**MCP Server myr-dev Tools:**
- claim
- credits
- decide
- envShape
- finish
- flagAsk
- fork
- frontPage
- initProject
- land
- landing
- ledger
- listAsks
- listProjects
- openAsk
- proposeAsk
- release
- showAsk
- status
- submitAnswer
- today
- verdict
- vouch

**Result from listAsks for "w3live-muyklikt":**
```
{"asks":[{"ask":"parse-month","blockedBy":[],"claimed":false,"kind":"fix","territory":".","want":"parse reads the month of an ISO date"}]}
```
```

pi over stdio, through the CLI's `mcp` command with a remote `/rpc` client (`pi mcp list --json` under a scratch HOME):

```json
{
  "servers": [
    {
      "name": "myr-dev",
      "scope": "global",
      "source": "<scratch>/pihome/.pi/agent/mcp.json",
      "enabled": true,
      "exposure": "codemode",
      "transport": "/home/oscargabriel/Developer/projects/wanted-explainer/notes/git-platform-research/artifacts-probe/w3-live/mcp-remote.sh",
      "state": "connected",
      "tools": [
        "listProjects",
        "frontPage",
        "listAsks",
        "showAsk",
        "status",
        "verdict",
        "landing",
        "credits",
        "today",
        "ledger",
        "envShape",
        "initProject",
        "openAsk",
        "proposeAsk",
        "flagAsk",
        "decide",
        "claim",
        "release",
        "submitAnswer",
        "finish",
        "land",
        "fork",
        "vouch"
      ]
    }
  ],
  "errors": []
}
```

A `tools/call` of `listAsks` through the same stdio server:

```json
{
  "protocol": "2025-11-25",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"asks\":[{\"ask\":\"parse-month\",\"blockedBy\":[],\"claimed\":false,\"kind\":\"fix\",\"territory\":\".\",\"want\":\"parse reads the month of an ISO date\"}]}"
      }
    ],
    "structuredContent": {
      "asks": [
        {
          "ask": "parse-month",
          "blockedBy": [],
          "claimed": false,
          "kind": "fix",
          "territory": ".",
          "want": "parse reads the month of an ISO date"
        }
      ]
    },
    "isError": false
  }
}
```

## A stray push to a scratch repo (OnPush)

```json
{
  "namespace": "projects-dev-oscabriel",
  "repo": "scratch-onpush-muykseuk",
  "workflow": "on-push-dev-oscabriel",
  "sha": "43ddf72ef9b908868fc234f2a84b8e44374f45f5",
  "pushMs": 811,
  "pushedAt": "2026-10-07T20:44:13.609Z",
  "instance": "811bd07a-fe17-47d5-ab0a-03d726a8664f",
  "instanceCreatedOn": "2026-10-07T20:44:15.499Z",
  "status": "running",
  "onPushDelayMs": 1890,
  "output": null
}
```

## The binding fence drill

The top-level `"worker_loaders": [{ "binding": "LOADER" }]` line deleted from `apps/platform/wrangler.jsonc`, types regenerated (`LOADER?: WorkerLoader`), then `bun run verify`:

```text
src/ports.ts(91,26): error TS2345: Argument of type 'WorkerLoader | undefined' is not assignable to parameter of type 'LoaderBinding'.
  Type 'undefined' is not assignable to type 'LoaderBinding'.
test/bindings.test.ts(320,7): error TS2344: Type 'LoaderBinding' does not satisfy the constraint '"Expected: ..., Actual: undefined"'.
FAIL  test/bindings.test.ts > the platform Worker's bindings > are the ones its env decodes, at the top level and in every stage
```

Restored, and types regenerated.
