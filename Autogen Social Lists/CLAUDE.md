# CLAUDE.md

Context for Claude Code working in this repo.

## What this is

A daily pipeline that picks a ranked list from Socialpruf data, renders it as a
card, and stages it for posting to X. Public repo.

## Non-negotiables

**Secrets.** `src/fetch/keyring.ts` is the only module that reads a Socialpruf
key. Do not add `process.env.SP_KEY_*` anywhere else. Keys must never enter a
prompt, a log line, a cached response, a receipt, or a committed file. Never
interpolate a key into a URL — put it in a header, so it cannot leak through
request logging.

**Do not rename `SP_ANTHROPIC_KEY` to `ANTHROPIC_API_KEY`.** If that variable is
set in the shell, Claude Code authenticates against it and bills at API rates
instead of the Pro subscription.

**The judgment call is not an agent.** `src/judgment/select.ts` is one
`messages.create` with no tools and no follow-up turn. Keep it that way — the
receipt has to be reproducible, and an agent loop is neither deterministic nor
predictably priced.

**Verification fails closed.** If `src/verify/checks.ts` rejects a list, the run
exits without rendering. Do not add a bypass flag.

**The awareness packet stays small.** Do not pipe raw API responses into the
judgment prompt. Every field added there costs tokens on every run forever, and
the reasoner's inability to hallucinate coverage depends on the packet being
curated rather than a dump.

## Architecture

```
awareness → judgment → feasibility → fetch → verify → caption → render
```

Judgment decides *what* the list is and emits a structured `ListSpec`. Nothing
downstream makes a decision — fetch, verify, and render are plain deterministic
code operating on that spec. That seam is what makes the pipeline debuggable.

The feasibility gate sits between judgment and fetch so a bad spec is rejected
before any money is spent. It returns a reason, and judgment gets one retry with
the problem named.

## What still needs building

1. **`src/fetch/client.ts`** — three functions marked TODO. This is the only
   real integration work. Implement against the actual Socialpruf REST routes.
2. **`src/post/post.ts`** — X client. Leave until the cards are trustworthy.
3. **Fonts** — see `fonts/README.md`.
4. **`src/render/tokens.ts`** — placeholder palette, swap for real brand values.

## Conventions

- TypeScript, ESM, `tsx` to run. `pnpm typecheck` before committing.
- Prefer additive changes. Do not rewrite a working module to restructure it.
- Comments explain *why*, not what. If a line needs a what-comment, rename
  something instead.
