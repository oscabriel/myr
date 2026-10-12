# NN: <the want, in a few words>

Status: needs-triage
Blocked by: none

## Want

<One behavioural change, said from the user's side.>

## Territory

<The workspace packages this may change, such as `packages/protocol`.>

## Check

<The command that fails on main now and passes once the want is met. It fails by an assertion, not a load error. Or `No check yet:` and the reason.>

```sh
bun test packages/<package>/test/<file>.test.ts
```

## Done when

- [ ] The check passes.
- [ ] `bun run verify` passes.

## Anti-jobs

- <What this must not do, even when nearby code invites it.>
