# forkdesign — Execution & Launch Plan

> Living strategy doc. Created 2026-06-10. Owner: @PauliusKrutkis.
> Update the checkboxes as you go; revisit the goal section if reality diverges.

---

## North star

**Aim for A, build toward B, leave the door open to C.**

| | Goal | What "done" looks like | Effort |
|---|------|------------------------|--------|
| **A** | Reputation / portfolio | A tasteful, public, launched OSS tool that signals "I build excellent dev tools" → inbound (network, jobs, consulting) | Low — mostly already done |
| **B** | Niche OSS with real users | 10+ devs who'd miss it if it vanished; steady stars/issues; a small contributor or two | Medium, sustained |
| **C** | Commercial optionality | A validated wedge (a repeated paid-shaped ask from real users) — NOT pursued until B exists | Deferred |

**Decision rule:** optimize every choice for A first. Only do B work that also serves A. Do **zero** C work until B is real. If you catch yourself building a billing/hosted/team feature before you have 50 users, stop.

---

## Positioning (the one sentence — use it everywhere)

> **Local-first AI design iteration for React devs. Comment on any component, get source-backed variants, and keep the whole history in your repo — no SaaS, every change is a git diff.**

Supporting messages, in priority order:
1. **It lives in your git.** Feedback and variants are JSX markers + on-disk snapshots you commit, diff, and revert. No vendor database.
2. **Every change is a reviewable diff.** The "a tool that edits my source?!" fear is neutralized by `git diff` / `git checkout`.
3. **Opinionated and focused.** Vite + React, dev-only, does one workflow well.
4. *(secondary)* In-app commenting — present, but NOT the headline. It points at the wrong (non-technical, SaaS-owned) audience.

**Anti-positioning (do not say):** "design feedback tool for teams/stakeholders," "Figma alternative," "beats v0 at generation." Those pick fights you can't win or audiences who can't install a plugin.

---

## Leverage (your unfair advantages — lean on these)

- **Engineering taste** — the repo is a credibility artifact (clean seams, real test pyramid, proper packaging). Most tools here are sloppy.
- **The opinion** — "design feedback belongs in git, not a SaaS silo" is a narrative, and narratives spread where feature lists don't.
- **Trust story** — reviewable, revertable diffs.
- **Speed** — solo, can ship opinionated changes without committee.
- **Timing** — local-first + anti-SaaS-fatigue + AI-codegen wave are all tailwinds.

## Realistic gains (and non-gains)

- ✅ Reputation, network, inbound; a tool you use; optionality.
- ❌ Near-term revenue. Don't measure success by money — that was never the high-probability outcome.

---

## The hard truth

**The bottleneck is distribution, not features.** The product is already launch-worthy for a 0.x. Another month of features with zero users teaches nothing. Resist building (yes — including the agent-eval harness) until the launch is out and users tell you what's missing.

---

## Phase 0 — Repo hygiene (PREREQUISITE — you can't invite people to a mess)

> Status note: stale cursor PRs (#17–#20) already closed; EOF parser fix committed on `release-candidate`; multi-comment + agent-eval scaffolding added.

- [ ] Auto-publish + first release (trusted publishing via npm OIDC)
  - [x] `.github/workflows/publish.yml`: on push to `main`, publishes only when `package.json` version is new; gates on lint/typecheck/test/build **and a non-empty `dist/` check** so an empty build can't ship; tags `v<version>` after publish. (2026-06-13)
  - [x] Trimmed source maps from the npm tarball — `files` allowlist now excludes `*.map` (package 1.7 MB → 899 kB, unpacked 5.7 MB → 2.1 MB). (2026-06-13)
  - [ ] **First publish must be manual:** run `npm publish` for `0.1.0` once with your auth — trusted publishing requires the package to already exist on npm.
  - [ ] Configure npm **Trusted Publisher** (package Settings → Trusted Publisher → GitHub Actions): org `PauliusKrutkis`, repo `forkdesign`, workflow filename `publish.yml`, environment blank.
  - [ ] *(optional hardening)* Add a GitHub Environment (e.g. `npm-publish`) with required reviewers as a manual approval gate; set `environment:` on the publish job and reference it in the npm trusted-publisher config.
  - [ ] Confirm end-to-end: bump to `0.1.1`, merge to `main`, watch the workflow auto-publish + push the tag.
- [x] Tag a release (`v0.1.0`) — annotated tag pushed to origin (2026-06-13). `npm publish` still pending (see manual-first-publish step above).
- [x] Decide on the name: **renamed `design-crit` → `forkdesign`** (2026-06-13). "fork" is git-native dev vocabulary that reinforces the iteration/variants positioning; "design-crit" wrongly signalled the stakeholder-feedback audience. npm name + `forkdesign` GitHub org both free. **TODO:** rename the GitHub repo on github.com (auto-redirects old links) — git remote left untouched for now.

## Phase 1 — Sharpen the story (days)

- [ ] **Rewrite README** around the positioning sentence: dev-iteration value + git-native hook first; commenting demoted; trust story explicit.
- [ ] **Record a 10-second demo GIF** for the very top of the README. *Single highest-leverage asset.* Show: click element → type instruction → get variants → switch versions → the resulting git diff.
- [ ] Add an honest **"forkdesign vs v0 / Lovable / Onlook"** comparison section (where it wins: local-first, in-repo history, focused; where it doesn't: not a generator, React/Vite only).
- [ ] Add a crisp **"Is this for you? / Not for you?"** section (repel the wrong users on purpose).

## Phase 2 — Make it tryable in 30 seconds (days–1 week)

- [ ] Zero-install try path: a hosted **StackBlitz/CodeSandbox** playground link, or a one-command `npx`/`degit` scaffold. Removes the "wire a plugin into my repo before I know if I like it" barrier.
- [ ] Polish the `examples/basic-vite` so it's the obvious "play with it now" entry.
- [ ] A short README **"30-second tour"** that mirrors the GIF in text.

## Phase 3 — Launch on the opinion (1 focused day + ongoing)

Channels that actually move React tooling (lead with the *opinion/story*, not the changelog):

- [ ] **X/Twitter** — build-in-public thread with the GIF. (#1 channel for FE dev tools.)
- [ ] **Show HN** — once, title hooks on the opinion, not the feature. Be present in comments all day.
- [ ] **r/reactjs**, **r/webdev** — the demo + the "why git" angle.
- [ ] **awesome-vite** PR + Vite/React community Discords.
- [ ] Submit to **React Status / Bytes / JavaScript Weekly** (they feature tasteful OSS).
- [ ] Cross-post the blog post to **dev.to** / Hashnode.
- [ ] Bluesky FE-dev community.

> Coordinate: GIF + README + blog post must all be live *before* the Show HN / X push.

## Phase 4 — Sustain & listen (ongoing)

- [ ] Respond to issues/PRs fast — momentum is a public signal.
- [ ] Personally talk to the **first 10 real users**. This is your only reliable B→C signal.
- [ ] Keep a visible changelog / "building in public" cadence.
- [ ] **Watch for the wedge:** a repeated, specific, paid-shaped ask → that's when C becomes worth a conversation.
- [ ] *Only now* resume feature work, prioritized by what real users ask for (the agent-eval harness lands here — quality signal becomes worth it once people rely on output).

---

## Success metrics (don't over-measure; these are directional)

| Phase | Leading signal | "Good" at ~30/90 days |
|-------|----------------|------------------------|
| A (reputation) | Launch shipped, quality visible | Post landed; a few "nice work" from credible devs; repo presentable |
| B (adoption) | npm installs, stars, issues from strangers | 100–300 stars; >5 unsolicited issues/discussions; 10 users you've talked to |
| C (optionality) | Repeated paid-shaped asks | ≥1 concrete "I'd pay for X" from a real user — then reassess |

---

## Anti-goals (write these on the wall)

- ❌ Building features before launching.
- ❌ Chasing the non-technical "stakeholder feedback" market (SaaS-owned, can't install a plugin).
- ❌ Competing on generation quality vs funded incumbents.
- ❌ Adding a hosted/billing layer before 50 users.
- ❌ Letting a rename or naming debate delay the launch.

---

## This week (concrete next actions)

1. [ ] Merge `release-candidate` → `main`, tag `v0.1.0`, clean branches.
2. [ ] Rewrite README around the positioning sentence (draft can be generated, then you edit).
3. [ ] Record the 10-second demo GIF.
4. [ ] Draft the "feedback belongs in git" blog post + the Show HN / X copy.

> Next assist available: drafts of the rewritten README, the comparison section, and the launch posts.
