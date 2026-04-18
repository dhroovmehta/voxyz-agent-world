# Hermes + Frasier — State of the Union
**Compiled:** 2026-04-18
**Purpose:** Single-pane-of-glass understanding before Dhroov assigns the next task.

---

## 1. What "Hermes" and "Frasier" mean in your stack

- **Hermes Agent** — NousResearch's open-source agent runtime (`github.com/NousResearch/hermes-agent`). Multi-provider LLM router + skill ecosystem + Discord/Telegram gateway + ACP/MCP integration. Pre-1.0 (currently `v0.10.0 (2026.4.16)` on prod). Pip+Docker install — NOT the git-clone install the upstream installer assumes.
- **Frasier** — Originally your custom routing agent. **DECOMMISSIONED (D-121).** Replaced by **Treize** as Paperclip CEO/orchestrator. Only artifact still bearing the name: the Mac Discord bot user `frasier#5393` (that bot is actually the Hermes gateway, branding retained). Memory explicitly says: *"Frasier is DEAD. Use off-the-shelf orchestration."*
- **Directive:** Consolidate everything Hermes-related (which subsumes anything still called Frasier) under `frasier/hermes_frasier/` going forward.

---

## 2. Where Hermes runs

### 2a. Local Mac — **INTENTIONALLY DECOMMISSIONED** (wiped 2026-04-18)
The original April 3 install was deliberately removed because it was redundant with the VPS and was creating confusion for management/updates. Cleanup completed 2026-04-18:
- `~/.hermes/` — deleted.
- Stale `/Users/dhroov/.hermes/hermes-agent` project entry in `~/.claude.json` — removed (backup at `~/.claude.json.bak-20260418-hermes-cleanup`).
- Shell profiles, launchd, `$PATH`, brew/pip/uv — already clean.
- `~/hermes-hudui/` (joeynyc's web UI, 334 MB) — **preserved per Dhroov's instruction**. Note: now orphaned (no local Hermes to read from). The VPS runs its own `hermes-hudui-gateway` + `hermes-hudui-paperclip` Docker services; those are independent.

**Secrets exposed during this audit (flagged for revocation):**

| # | Key | Location | Action |
|---|---|---|---|
| 1 | Anthropic API key `sk-ant-api03-T5sj…sR2w-2M1kwQAA` | Old Mac `~/.hermes/auth.json` (now deleted) | Revoke at console.anthropic.com |
| 2 | Exa API key `026a5a04-b9cd-43f1-af22-617402a8ca10` | Old Mac `.claude.json` MCP URL (now removed) | Revoke at dashboard.exa.ai |
| 3 | GitHub PAT `github_pat_11ACCMYEI0…Rr` | VPS `/opt/hermes/data/memories/MEMORY.md` (still live in Frasier's memory) | Revoke at github.com/settings/tokens, rotate into 1P `Agents2` |
| 4 | Supabase service_role JWT (project ref `juaekekwvcuyeleyvrvc`, valid through 2036-02-11) | `v1/Frasier_PRD.md:1331` — redacted inline 2026-04-18 | Rotate via Supabase dashboard → Settings → API |
| 5 | Supabase legacy key `sb_secret_PXMMmpfa9jI…FIMvtSRq` | `v1/Frasier_PRD.md:1315` — redacted inline 2026-04-18 | Rotate via Supabase dashboard (GitHub push-scanner flagged as real) |

\#4 and \#5 were uncovered during the first push attempt to `github.com/0xDecay/frasier` — gitleaks missed them, GitHub's push-protection scanner caught them. Both redacted before the commit landed.

Discord bot `frasier#5393` — if still referenced anywhere, it would now only run off the VPS gateway's token (`/opt/hermes/data/.env`). Not verified today; flag for future check.

### 2b. Production VPS (mootoshi — `srv1353416.tail274b87.ts.net` / `187.77.8.89`)
Five live systemd services:
- `hermes-gateway.service` — Docker gateway for Discord/Telegram DMs (image `hermes:0.10.0`).
- `hermes-hudui-gateway.service` — HUD Web UI for gateway consciousness.
- `hermes-hudui-paperclip.service` — HUD Web UI for agent fleet.
- `paperclip.service` — Paperclip control plane on `127.0.0.1:3100`, nginx-reverse-proxied to `srv1353416.tail274b87.ts.net` (Tailscale HTTPS). Legacy `ops.thinkfraction.xyz` deprecated (teardown 2026-04-21).
- `thinkfraction-poller.service` — Paperclip → Discord `#tf-*` activity mirror.

Paths: `/opt/hermes/src/hermes-agent/` (git clone, build source), `/opt/hermes/venv/` (shared pip venv), `/opt/hermes/docker-compose.yml`, `/opt/hermes/data/{config.yaml,.env}` (gateway), `/home/paperclip/.hermes/{config.yaml,.env,profiles/}` (Paperclip agents, DRY'd via symlinks).

---

## 2c. Frasier — Dhroov's personal Hermes agent (the one he actually talks to)

**This is distinct from Paperclip.** Paperclip is the 14-agent worker fleet (§3). Frasier is the single conversational AI Dhroov DMs with.

### Identity
- **Persona:** Dr. Frasier Crane — Harvard/Oxford psychiatrist, KACL 780 AM, "I'm listening." Defined in `/opt/hermes/data/SOUL.md`. Not an assistant; he *is* Frasier.
- **Alternate personalities in config** (menu, not default): helpful, concise, technical, creative, teacher, kawaii, catgirl, pirate, shakespeare, surfer, noir, uwu, philosopher, hype.
- **Mac Discord bot `frasier#5393` was the pre-VPS interface** — that's gone with the Mac wipe. Now Frasier is reachable only via the VPS gateway.

### How Dhroov reaches him
- **Discord** — `require_mention: true`, `auto_thread: true`, `reactions: true`. Allowed user: `771845444241981440`.
- **Telegram** — via gateway, chat id `6243163539`.
- **WhatsApp** — scaffolded (`whatsapp: {}`) but empty.
- Bot token + allowed-users list in `/opt/hermes/data/.env`.

### Model routing (distinct from Paperclip)
DeepSeek-chat → MiniMax-M2.7 → claude-opus-4-6. Aux tasks (vision/web_extract/compression/session_search/skills_hub/approval/mcp/flush_memories) all pinned to `openrouter/google/gemini-3-flash-preview`.

### Persistent brain
- `/opt/hermes/data/memories/MEMORY.md` — Frasier's own notes, 2,200 char cap, auto-flush every 6+ turns, nudge every 10.
- `/opt/hermes/data/memories/USER.md` — his notes on Dhroov (emails, phone, name preferences, active projects), 1,375 char cap.
- Checkpoints: up to 50 per session.
- Compression: fires at 50% context, keeps last 20 turns verbatim, summarizer = Gemini-3-flash-preview.
- **128 sessions** archived in `/opt/hermes/data/sessions/` (latest today 2026-04-18 11:56).

### What Frasier can reach
| Integration | Mechanism |
|---|---|
| **Frasier's Ledger** | Notion DB `33cc642f-7e70-805d-a29e-ca3697861c38` — offers to publish plans/research there before finishing |
| **1Password** | `op` CLI, service account read-only on `Agents2`, item `frasier-env` |
| **GitHub (0xDecay)** | PAT — **stored in plaintext in MEMORY.md** ⚠️ |
| **Browsers** | `/opt/hermes/bin/browser-manager` dispatches to agent-browser, lightpanda, pinchtab, cloakbrowser, dev-browser |
| **Jina reader** | `GET r.jina.ai/{url}` bearer + `X-Return-Format: markdown` |
| **Twitter** | `X_USERNAME` + `X_PASSWORD` env (scraping-style, not API) |
| **Browserbase** | Env configured (advanced stealth + proxies) |
| **Tirith** | Built-in security scan on tool calls, 5s timeout, fail-open |

### Exposed secret (third one flagged this session)
GitHub PAT `github_pat_11ACCMYEI0…Rr` lives in plaintext inside Frasier's MEMORY.md and allegedly also in `/home/paperclip/thinkfraction/.env`. Self-contradicts the "1Password only, no flat files" rule stated on the very next line of that same memory. Revoke + rotate into `Agents2` vault.

### Visual skin (SHIPPED 2026-04-18)
Frasier runs the **neonwave-recolored sakura skin** — Dhroov's custom fork of `joeynyc/hermes-skins` sakura, with the palette swapped to hot magenta / electric pink / cyan on void purple. Defined in two places (both kept in sync):

| Path | Used by | Notes |
|---|---|---|
| `/opt/hermes/data/skins/sakura.yaml` | Docker gateway (Discord/Telegram DMs) | Canonical. Owner `10000:10000`, mode `644`. Pre-ship backup at `sakura.yaml.bak-pre-neonwave-20260418-144944`. |
| `/root/.hermes/skins/sakura.yaml` | Host-side `hermes chat` when SSH'd into mootoshi | Must mirror the canonical file — `hermes chat` on host defaults HERMES_HOME to `~/.hermes` and reads skins from there, not from `/opt/hermes/data/skins`. Stale-version backup at `sakura.yaml.bak-stale-20260418-145723`. |

Activated in config at `/opt/hermes/data/config.yaml` → `display.skin: sakura`. Pre-change config backup: `config.yaml.bak-20260418-144944`.

**Recolor helper** (idempotent, re-runnable): `frasier/hermes_frasier/ops/sakura_recolor.py`. Reads `~/Downloads/sakura.yaml`, applies the neonwave palette mapping, emits `sakura-neonwave.yaml` + a faithful `sakura-preview.html` dashboard.

**Known gotcha — host↔container skin-path drift:** the Docker gateway uses `HERMES_HOME=/data` (→ `/opt/hermes/data/skins/`), but the host CLI defaults `HERMES_HOME` to `$HOME/.hermes` (→ `/root/.hermes/skins/`). Updating only one location leaves the other stale. Long-term fix candidate: patch `/usr/local/bin/hermes` wrapper to export `HERMES_HOME=/opt/hermes/data` so both surfaces resolve identically. Not done yet.

**Skins only apply to the CLI/terminal surface.** Discord platform (`gateway/platforms/discord.py`) imports zero from `skin_engine` — Rich markup `[bold #hex]text[/]` isn't translated to Discord's limited ANSI/markdown. The banner, per-character gradient, and braille hero render only when Dhroov is in an interactive `hermes chat` session on the VPS.

### ⚠️ Color rendering fix — truecolor not forwarded through `docker exec` (SHIPPED 2026-04-18)

**Symptom:** skin colors rendered as washed-out pastels when running `hermes` over SSH to the VPS, even though the exact same hex codes rendered vibrantly on Dhroov's previous local Mac install of Hermes. Deep purple `#4400AA` looked baby-blue, hot magenta `#FF2975` looked pink, cyan `#00FFFF` looked white-ish, etc. Cost many hours of debugging during the 2026-04-18 skin deploy.

**Root cause:** bare `hermes` on mootoshi drops into the gateway container via `docker exec -it -u hermes hermes-gateway …` (line 109 of `/usr/local/bin/hermes`). Docker's `exec` does **NOT** forward the outer shell's `TERM` or `COLORTERM` env vars by default. Inside the container, Hermes's Rich library probes the terminal, sees no color-capability signals, and concludes `color_system: None` → silently downsamples every 24-bit hex to its nearest 256-color (or lower) palette approximation. Result: the *exact* skin YAML renders flat/pastel instead of neon-saturated.

**Why the local install didn't have this bug:** the previous Mac-resident hermes ran directly in the user's terminal — no `docker exec` layer, no env-var loss.

**Fix:** patch all four `docker exec` invocations in `/usr/local/bin/hermes` to forward the vars explicitly:
```
docker exec -it -e COLORTERM=truecolor -e TERM=${TERM:-xterm-256color} -u hermes …
```
Pre-patch backup: `/usr/local/bin/hermes.bak-20260418-154910`.

**Verification probe** (run inside a VPS SSH session):
```bash
sudo docker exec -e TERM=xterm-256color -e COLORTERM=truecolor hermes-gateway \
  bash -lc "source /opt/hermes/.venv/bin/activate && \
            python3 -c 'from rich.console import Console; print(Console().color_system)'"
# expect: truecolor
```

**User-visible test:** the 6 banner_logo color stops printed as solid block chars should all render distinctly vibrant, not muted variants of each other. See `/tmp/probe_colors.sh` on VPS for the probe script used.

**Lesson:** when a color/formatting issue only appears on the Dockerized deployment and not a direct-install one, always check what TTY/TERM/COLORTERM the process inside the container actually sees. `docker exec -it` gives you a TTY but does NOT give you the caller's terminal environment — it inherits the container's (usually empty or minimal) env.

### Gaps / dead threads
- **Spell Book cron** (9am ET Apple Notes sorter, cron id `a813bcd125af` → Discord channel `1494017207724675313`) — referenced in old session notes but `/root/.hermes/cron/`, `/opt/hermes/data/cron/`, and root crontab are all empty. Only live cron is `openclaw-monitor.py` every 5min. Was it Mac-hosted (now wiped) or was it never migrated to VPS? TBD.
- **`/root/.hermes/` is NOT empty** — previously noted as empty; actually contains the host-CLI skin/config state parallel to `/opt/hermes/data/`. Source of the skin-path drift gotcha above.
- **No MCP servers registered** in Frasier's config (`mcp: {}` implicit). Notion access goes through the memory-stored DB id + NOTION_API_KEY env, not MCP.

---

## 3. Paperclip agent fleet (ThinkFraction — only tenant)

Company ID: `67b065e1-2716-49f6-ad3a-5e8d903d7d0b`. All 14 agents on `adapterType: hermes_local` since 2026-04-14 (D-110):

```
Treize  (CEO / Chief Orchestrator)
├── Heero   (Lead Engineer)
│   ├── Ritsuko (Backend)   ├── Asuka (Frontend)   ├── Quatre (Full-Stack)
│   ├── Cid (DevOps)        └── Wufei (QA)
├── Misato  (Eng PM)
│   ├── Ed (Research)       └── Toji (Financial)
├── Spike   (Outreach Lead)
└── Jet     (Content Lead)
    ├── Faye (Twitter/X)    └── Vicious (Signal/Ideation)
```

Each agent: `hermesCommand: "hermes"`, `extraArgs: ["-p", "<slug>"]`, `persistSession: true`, role-appropriate `toolsets`, profile dir on VPS (10 of 14 symlink parent config for DRY credentials — D-119).

---

## 4. Model routing (migrated 2026-04-17, SHIPPED)

| Context | Primary | Fallback 1 | Fallback 2 (safety net) | Aux tasks |
|---|---|---|---|---|
| **Paperclip agents** (`/home/paperclip/.hermes/config.yaml`) | `minimax/MiniMax-M2.7` (direct) | `deepseek/deepseek-chat` | `anthropic/claude-opus-4-6` | — |
| **Hermes gateway** (`/opt/hermes/data/config.yaml`) | `deepseek/deepseek-chat` | `minimax/MiniMax-M2.7` | `anthropic/claude-opus-4-6` | `openrouter/google/gemini-3-flash-preview` |

All 14 agents' `adapterConfig.model` PATCHed to `MiniMax-M2.7`. Parked: Together AI key (Hermes has no native Together provider), direct Google Gemini key (Hermes has no native `google`; Gemini rides OR). Backup timestamp if rollback needed: `20260417-172154` (Paperclip config) and `20260417-191922` (gateway config).

---

## 5. Auto-update harness (SHIPPED 2026-04-17)

Systemd timer (`hermes-auto-update.timer`, `OnCalendar=*-*-* 00/6:00:00`, ±30m jitter) → one-shot service → `/usr/local/bin/hermes-auto-update`. Polls `NousResearch/hermes-agent` GitHub releases, compares `hermes --version` to latest tag.

- **Patch bumps:** auto-apply.
- **Minor/major bumps:** supervision gate — Discord DM alert, blocks until `touch /opt/hermes/src/.approved-<tag>`.
- **On failure:** auto-rollback (image, compose file, venv, 4 services) + Discord ❌ alert via raw REST.
- **Wrapper** at `/usr/local/bin/hermes` intercepts `gateway {status,start,stop,restart,logs,shell,exec,version}` and `update` to route to local docker-compose + harness; blocks `gateway {install,uninstall,setup,run}` to protect the custom systemd setup; passes everything else through.

### Known open upstream bugs (non-fatal)
- Discord `/skill*` slash commands exceed 8000-char size limit → sync fails. DMs still work.
- Bare `hermes` on host → tries to spawn sandbox container, fails OCI exec. Workaround: always use explicit subcommands (`hermes doctor`, `hermes chat`, etc.).
- v0.10.0 Dockerfile dropped CMD; our compose now pins `command: ["gateway","run","--replace"]`. Harness sed only touches `image:` line so the pin persists.

---

## 6. Lessons on the shelf (all from the 0.7.0 → 0.10.0 jump, 2026-04-17)

1. **Root umask 0077 + pip install → venv files at 0600.** Non-root callers (paperclip user) can't import. Surfaces as misleading `ModuleNotFoundError`, not a perms error. Fix: `chmod -R a+rX /opt/hermes/venv` step baked into the harness post-install. Backup of pre-patch harness at `/usr/local/bin/hermes-auto-update.bak-20260418-003152`.
2. **Shallow health checks miss crash loops.** Post-update probe now requires RestartCount unchanged AND uptime ≥ 60s.
3. **Heartbeats OFF ≠ agents healthy.** Silent ≠ working. Enable a cheap no-op canary heartbeat to surface runtime breakage early.

---

## 7. Source-of-truth inventory (what gets consolidated into `hermes_frasier/`)

### In `fractional/`
| Kind | Path |
|---|---|
| Ops scripts | `ops/hermes-auto-update/` (7 files: orchestrator, service, timer, logrotate, default, wrapper, README) |
| Patches | `ops/patches/hermes-paperclip-adapter.patch` |
| Plans | `docs/plans/2026-04-17-paperclip-hermes-model-config.md` (v3, shipped) |
| Plan recon data | `docs/plans/recon/2026-04-17-agents-before.json`, `...-after.json`, `...-patch-payload.json` |
| Agent configs | `paperclip-package/agents/<slug>/AGENTS.md` (14 files) + `COMPANY.md` + `paperclip.manifest.json` |
| Migration log | `docs/paperclip-10day-summary.md` |
| VPS ops | `docs/paperclip-vps-operations.md` |
| Decision log | `docs/decision-log.md` (D-110, D-119, D-120, D-121, D-122) |
| Changelog | `CHANGELOG.md` (Apr 14 migration + Apr 17 model config entries) |

### In `_knowledge/` (Obsidian vault "Epyon")
| Kind | Path |
|---|---|
| Runbook | `runbooks/hermes-auto-update.md` |
| Decision | `decisions/fractional/hermes-migration.md` (D-110) |
| Lesson | `lessons/2026-04-17-hermes-auto-update-perms-regression.md` |
| Infra snapshot | `infrastructure/hermes-agent-setup-2026-04-03.md` (Mac install, outdated re: VPS) |

### In session memory
| Kind | Path |
|---|---|
| Reference | `~/.claude/projects/-Users-dhroov-Claude-Code-Projects/memory/reference_hermes_agent.md` (Mac install, 14 days old) |
| Feedback | `~/.claude/projects/-Users-dhroov-Claude-Code-Projects/memory/feedback_no_custom_frameworks.md` ("Frasier is DEAD") |
| Rules | `~/.claude/rules/paperclip-setup.md` (Paperclip bootstrap gotchas) |

### Legacy Frasier artifacts (to triage, likely archive)
- `~/Claude_Code_Projects/frasier/v1/` — PRD, spec, src/, pixel-agents/, deploy.sh, ecosystem.config.js. Pre-Treize routing framework. Per D-121: dead.

### Git repo
- `github.com/0xDecay/thinkfraction` (private, main branch). Most recent Hermes-touching commits:
  - `27c0d71` fix(hermes): bare `hermes` on mootoshi drops into container
  - `22dc6a7` docs(hermes): container-access snippet
  - `39859df` feat(hermes): auto-update harness + management wrapper
  - `5cd52b4` feat(hermes): gateway phase — DeepSeek primary + OR Gemini aux
  - `f28bcbc` feat(paperclip): 14 agents migrated anthropic → MiniMax-M2.7
  - `a60ccee` docs(plan): v2 — pivot to MiniMax direct
  - `aa05637` chore(recon): pre-migration snapshot of 14 agents

---

## 8. What's NOT done / open threads

- Mac Hermes install intentionally decommissioned and wiped 2026-04-18 (§2a). Decision locked: VPS-only going forward.
- Two API keys exposed in the old Mac install files — flagged above, Dhroov to revoke.
- Mac Discord bot `frasier#5393`: not verified where (if anywhere) it's still active after Mac wipe. Check gateway `.env` on VPS.
- `~/hermes-hudui/` kept but now orphaned locally — no action needed unless Dhroov wants it pointed at the VPS Hermes remotely.
- Together AI, OR, direct Google Gemini keys parked in 1Password `Agents2`; no code path uses them.
- Aux-task routing only configured on gateway, not on Paperclip user config. Deferred on purpose.
- No canary/no-op heartbeat probe yet (lesson #3 from §6 not yet acted on).
- Frasier v1 code under `frasier/v1/` has not been formally archived with a tombstone.

---

## 9. Infrastructure quick reference

| Thing | Where |
|---|---|
| VPS SSH | `ssh mootoshi` (alias), key in 1P `Agents2/mootoshi-thinkfraction-agent/private key?ssh-format=openssh` |
| Paperclip API | `https://srv1353416.tail274b87.ts.net` — token in `~/.paperclip/auth.json` |
| Discord allowed user | `771845444241981440` (Dhroov) |
| Telegram chat id | `6243163539` |
| 1Password vault | `Agents2` (service account: `claude-code-agents-sa`) |
| Backup timestamps | `20260417-172154` (Paperclip), `20260417-191922` (gateway) |

---

## 10. Consolidation plan for `hermes_frasier/`

Proposed subfolder structure (already scaffolded):
```
hermes_frasier/
├── STATE-OF-THE-UNION.md     (this file — living doc)
├── docs/                      (plans, architecture, migration logs)
├── ops/                       (auto-update harness, wrapper, systemd units)
├── agents/                    (14 Paperclip AGENTS.md + COMPANY.md + manifest)
├── plans/                     (model-config plan, recon snapshots)
├── runbooks/                  (auto-update runbook)
├── lessons/                   (perms regression, etc.)
└── reference/                 (Mac install snapshot, memory pointers)
```

Next step (awaiting Dhroov's task): pull copies (or symlinks, TBD) from the source-of-truth locations listed in §7 into this tree so everything Hermes-related is reviewable in one place without disturbing the live paths the VPS + systemd + auto-update harness depend on.
