# Launch copy

> Draft copy for the forkdesign launch. Lead with the **opinion** ("design
> feedback belongs in git, not a SaaS silo"), not the changelog. Edit freely —
> these are starting points in your voice, not finished posts.
>
> Coordinate: GIF + README must be live before posting. Attach
> `docs/assets/forkdesign-demo.gif` wherever a media slot is noted.
>
> Links to fill in:
> - Repo: `https://github.com/PauliusKrutkis/forkdesign`
> - npm: `https://www.npmjs.com/package/forkdesign` (after first publish)
> - Playground: `https://stackblitz.com/github/PauliusKrutkis/forkdesign/tree/main/examples/stackblitz`

---

## The one sentence (use everywhere)

> Local-first AI design iteration for React devs. Comment on any component, get
> source-backed variants, and keep the whole history in your repo — no SaaS,
> every change is a git diff.

---

## X / Twitter — build-in-public thread

**1/ (hook — attach GIF)**

Design feedback shouldn't live in someone else's database.

So I built forkdesign: click any React component in your running app, leave a
comment, and it's written straight back into your source as a git diff.

Local-first. No SaaS. No account. 🧵

**2/**

The whole idea: feedback and design variants are just *code*.

A comment becomes a JSX marker next to the element. A variant is an on-disk
snapshot. You `git diff` them, `git commit` them, `git checkout` to revert.

Your repo is the database.

**3/ (attach: agent-iterations screenshot)**

Want changes, not just notes? Switch to Agent mode.

Your *local* agent (Cursor / Claude, your keys) generates source-backed variants
right in the file. Flip between versions, keep the one you like. The diff shows
exactly what moved.

**4/**

The fear with any tool that edits your source is "what did it just do to my
code?"

forkdesign's answer is the oldest one in the book: `git diff`. Every change is
reviewable and revertable. Nothing leaves your machine except what your own
agent sends.

**5/ (who it's for)**

It's deliberately narrow:
• React + Vite, dev-only
• one workflow done well
• not an app generator, not a Figma, not a stakeholder-feedback SaaS

If you iterate on components you already have, it's for you.

**6/ (CTA)**

It's open source and on npm today.

Try it in your browser (no install): [StackBlitz link]
Repo: [repo link]

Would genuinely love feedback from anyone who lives in a Vite + React dev loop. ⭐

---

## Show HN

**Title** (pick one — opinion first, not feature):

- `Show HN: ForkDesign – design feedback that lives in your git, not a SaaS`
- `Show HN: Local-first AI design iteration for React (every change is a git diff)`

**Body:**

Hi HN — I'm Paulius. ForkDesign is a dev-only Vite plugin for React: you click
an element in your running app, leave a comment, and it's written back into your
source as a JSX marker. Optionally, a local agent generates source-backed
variants you can flip between and keep.

The opinion behind it: design feedback and iterations are code, so they belong
in your repo — not in a vendor's database. A comment is a marker in the `.tsx`.
A variant is an on-disk snapshot. You review them with `git diff` and revert
with `git checkout`. There's no hosted mode and no account.

That also defuses the obvious worry about a tool that edits your source: every
change is a reviewable, revertable diff, and the only thing that leaves your
machine is what your own agent (your keys) sends.

It's intentionally narrow — React + Vite, dev-only, one workflow. It is not an
app generator (not competing with v0/Lovable) and not a stakeholder-feedback
platform.

Browser demo (no install): [StackBlitz link]
Repo: [repo link]  •  npm: `npm i -D forkdesign`

Happy to answer anything and would love to hear where this breaks for your
setup. I'll be around in the comments all day.

---

## r/reactjs

**Title:** `I built a local-first design iteration tool for React — feedback and AI variants live in your git, not a SaaS`

**Body:**

I kept wanting to leave design feedback *on the running app* without it
disappearing into some vendor's dashboard. So I built ForkDesign.

It's a dev-only Vite plugin. Click an element, leave a comment — it's written
back into your `.tsx` as a marker next to that element. Switch to Agent mode and
your local agent (Cursor/Claude, your keys) generates source-backed variants you
can flip between and keep.

Everything is in your repo: comments are JSX markers, variants are on-disk
snapshots. So you `git diff` to see changes and `git checkout` to revert — which
is also why I'm comfortable letting it edit source.

Scope is deliberately small: React + Vite, dev-only, one workflow. Not an app
generator, not a Figma.

Browser demo: [StackBlitz link] · Repo: [repo link]

Would love feedback from people who actually live in a Vite/React dev loop —
especially where it doesn't fit.

---

## r/webdev

**Title:** `Design feedback that lives in your git instead of a SaaS — a local-first tool for React/Vite`

**Body:**

Most design-feedback tools want to own your feedback in their cloud. I wanted the
opposite: feedback as code, in my repo.

ForkDesign is a dev-only Vite plugin. You comment on elements in your running app
and the comments are written into your source; an optional local agent generates
variants. Everything is a git diff you can review and revert — no account, no
hosted database.

It's React + Vite only and intentionally does one thing. Open source.

Browser demo: [StackBlitz link] · Repo: [repo link]

---

## awesome-vite (PR entry)

Add under the relevant plugin/integration list (alphabetical where applicable):

```md
- [forkdesign](https://github.com/PauliusKrutkis/forkdesign) - Local-first, dev-only design iteration for React: comment on running components and generate source-backed variants, with all feedback and history kept in your repo as git diffs.
```

PR title: `Add forkdesign (local-first design iteration plugin for React)`

---

## Newsletter blurbs (React Status / Bytes / JavaScript Weekly)

**One-liner (Bytes-style, punchy):**

> ForkDesign — comment on your running React components and get AI variants,
> with every change landing as a git diff in your repo. Local-first, dev-only,
> no SaaS.

**Two-sentence (React Status / JS Weekly):**

> ForkDesign is a dev-only Vite plugin that turns design feedback into code:
> click any element in your running React app to leave a comment, and it's
> written back into your source — optionally with source-backed variants from
> your local agent. Everything lives in your repo as JSX markers and on-disk
> snapshots, so every change is a reviewable `git diff` and nothing ships to a
> vendor's cloud.

Submission links: React Status / JavaScript Weekly / Bytes all have "suggest a
link" forms — include the repo URL, the GIF, and the two-sentence blurb.
