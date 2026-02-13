# Frasier

An autonomous AI organization known as NERV. Frasier, the Chief of Staff, leads 7 specialized agents running 24/7 — researching markets, creating content, and shipping products. Built with Node.js, PostgreSQL, and Discord.

## The Agents

| Agent | Role |
|-------|------|
| **Jet** | Chief of Staff / COO — strategic oversight, delegation, approval |
| **Edward** | Research & Intelligence — market research, competitive intel, trend analysis |
| **Faye** | Content Creator — copywriting, social media, brand storytelling |
| **Spike** | Full-Stack Engineer — code, architecture, deployment |
| **Ein** | QA & Testing — quality assurance, security audits, bug detection |
| **Vicious** | Growth & Marketing — SEO, distribution, funnel optimization |
| **Julia** | Knowledge Curator — documentation, summaries, knowledge management |

## How It Works

No frameworks. No LangChain. No AutoGPT. Just PostgreSQL + Node.js workers + a rule engine.

- **PostgreSQL is the orchestration layer** — all state, missions, policies, memories, and events live in the database. No Redis, no message queues. Polling + status flags.
- **Three processes** — Discord bot (interface), heartbeat (orchestrator), worker (executor). Managed by PM2.
- **Agents remember** — persistent memory, lessons learned, and skill growth influence every decision.
- **Agents interact** — 10-15 conversations per day: standups, debates, watercooler chats, mentoring sessions.

## Architecture

> For the full deep-dive, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Architecture Overview

Three layers working together — the control plane (heartbeat), the execution engine (VPS workers), and the shared brain (Supabase/PostgreSQL).

![Architecture Overview](docs/architecture/architecture-overview.jpeg)

### The Autonomous Agent Blueprint

The full lifecycle from proposal to execution to feedback — and how it loops back to create a self-sustaining cycle.

![Autonomous Agent Blueprint](docs/architecture/autonomous-agent-blueprint.jpeg)

### The 5 Pillars of Autonomy

The foundational design principles that make the system self-governing without constant human oversight.

![5 Pillars of Autonomy](docs/architecture/5-pillars-of-autonomy.jpeg)

1. **Centralised Proposal Service** — All work enters through a single proposal pipeline.
2. **Cap Gates (Reject Early)** — Cost and policy checks happen before execution, not after.
3. **Policy-Driven Config** — Rules live in the database, not in code.
4. **Sole Executor (VPS)** — One worker processes one task at a time. No race conditions.
5. **Self-Healing Heartbeat** — Monitors itself via an external health endpoint.

### The Closed Loop

How the core loop cycles through proposal, approval, mission, worker execution, events, and reactions — continuously.

![The Closed Loop](docs/architecture/closed-loop.jpeg)

## Tech Stack

- **Runtime:** Node.js
- **Database:** Supabase (PostgreSQL)
- **Interface:** Discord.js
- **Process Manager:** PM2
- **Hosting:** DigitalOcean VPS
- **LLM:** Claude via OpenRouter

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your keys
3. `npm install --production`
4. `pm2 start src/discord_bot.js --name discord_bot`
5. `pm2 start src/heartbeat.js --name heartbeat`
6. `pm2 start src/worker.js --name worker`
7. `pm2 save`
