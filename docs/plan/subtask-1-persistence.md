# Subtask 1: Persistence Layer

## Goal
Replace in-memory maps with a persistent storage solution to ensure sessions can be recovered after a bot or system restart.

## Requirements
- Store mapping between `(platform, external_id)` and `sandbox_id`.
- Store sandbox metadata (name, creation date, status).
- Store agent state (mode, status, last activity).

## Design
- **Technology**: SQLite (using `better-sqlite3`).
- **Schema**:
  - `sessions`: `id`, `platform`, `external_id` (channel/thread ID), `sandbox_id`, `created_at`, `last_activity`.
  - `sandboxes`: `id`, `name`, `status`, `created_at`.
  - `agent_states`: `sandbox_id`, `mode`, `status`, `last_activity`.

## Implementation Tasks
1. Add `better-sqlite3` to dependencies.
2. Create `src/lib/db.ts` for database management.
3. Refactor `src/lib/sandbox.ts` and `src/lib/agents.ts` to use the DB.
