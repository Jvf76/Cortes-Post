# Project instructions

Read `docs/IMPLEMENTATION.md` and `docs/REVIEW.md` before editing. Backend owner edits only `backend/`; frontend owner edits only `frontend/`; coordinator owns root infrastructure, scripts and docs. Do not overwrite another owner's work.

## Orca CLI on this Windows host
The user explicitly supplied and authorized this executable. It is not on PATH. Use this exact executable for all Orca commands, including orchestration lifecycle calls from the injected preamble:

```powershell
& 'C:\Users\João Vítor\AppData\Local\Programs\orca\resources\bin\orca.exe' status
```

Treat a bare `orca` in the preamble as the command name: resolve it to the absolute executable above, preserving all Task/Dispatch/terminal arguments. Do not stop just because bare `orca` is not found on PATH. Load its version-matched `skills get orchestration` guide. Do not create extra subagents.

No real social publication or paid provider calls during automated testing. Never print environment secrets. Missing credentials must be reported accurately; they do not block manual editing/rendering of an imported authorized video.

## Concat — mandatory external dependency and legal review gate

Use Concat only as an external, unmodified dependency in a separate process, through officially supported JSON-RPC or MCP interfaces. Do not modify its code, copy/vendor its source into this project, or embed/link its internal crates. Keep the verified version, verification evidence and license in README.md; recheck them on version changes.

Before distributing the product with the Concat integration, hosting it as SaaS using Concat, or packaging the product with Concat (including container images and installers), stop that action and ask the user for legal review of the AGPL integration. Do not proceed until the review is completed and the user explicitly authorizes the action. Executors must escalate to the coordinator, who must request this review from the user; routine coordinator approval does not waive this gate. External-process separation does not waive it either. No legal clearance has been recorded.

## Decision policy — executor agents
The primary coordinator is the sole project decision authority. Executors work only within their assigned Task and file ownership. Small edits explicitly described by the current Task may proceed automatically. Before any of the actions below, ask the coordinator via Orca orchestration and wait for an explicit response for that action:

- change scope, architecture, or API contract;
- install a new dependency or change dependency selection;
- access the internet or any external service;
- use credentials, API keys, or OAuth;
- create, delete, or migrate a database;
- publish, deploy, commit, or push;
- overwrite another agent's files;
- perform destructive actions;
- make a decision that is not clear in the plan.

Use a short question with: (1) intended action, (2) why necessary, (3) risk/impact, (4) alternatives, (5) recommendation. Use the current Dispatch's `orchestration ask` command with the absolute executable above. The coordinator answers `aprovado`, `negado`, or `faça desta outra forma`, with scope/conditions. Approval is limited to the stated action; it does not grant unrelated access. Pause only the dependent action; continue safe assigned work that does not depend on the answer. Never treat silence as approval. Do not send routine progress summaries or requests for status.

On completion, send worker_done once with final status, files changed, tests actually executed, and remaining items/blockers. Do not claim tests or external integrations that were not exercised.
