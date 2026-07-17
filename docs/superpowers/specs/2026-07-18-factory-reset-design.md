# Factory Reset Design

## Goal

Change the existing top-right Reset action into a destructive factory reset that restores the compiled canonical demo seed and deletes all demo activity while preserving OAuth and environment credentials.

## Scope

Reset deletes workspace conversations, Knowledge history, candidates, corrections, Eval datasets and artifacts, Telegram events and deliveries, calendar deliveries and mappings, outbox jobs, generated voice artifacts, and tracked external Google Calendar events.

Reset preserves the compiled seed template, database schema, Google OAuth connection, and API/environment credentials.

## Architecture

The browser continues to call `POST /api/demo/reset` with the expected workspace revision. The server owns orchestration: validate the compiled seed, acquire a per-workspace reset lock, delete tracked external Google events, clear voice objects, and invoke one transactional Supabase reset operation that clears workspace child rows and replaces `demo_state.state` with the compiled seed.

The client treats the response as authoritative, clears local Telegram and route caches, and reloads the returned workspace revision. The existing selective `mergeSyntheticReset` path is removed from the global reset but remains available to tests or narrow fixture-reset behavior where needed.

## Safety and UX

The confirmation dialog lists the deleted data and requires typing `RESET`. Reset is rejected on a stale workspace revision or while another reset is active. Automation that mutates the workspace is blocked by the same in-process reset lock.

The operation validates the seed before destructive work. Google event deletion happens before the database transaction; a failure aborts the database reset. Database changes are transactional. Voice cleanup failure is returned explicitly because object storage cannot participate in the database transaction.

## Post-reset invariants

- `demo_state.state` equals the compiled canonical seed.
- `demo_state.revision` increases exactly once.
- Telegram events and deliveries are empty.
- Calendar mappings, deliveries, and outbox jobs are empty.
- No workspace voice artifacts remain.
- Google OAuth remains connected.
- The browser shows the canonical conversations, Knowledge v1, and empty Eval history.
- Repeating reset produces the same canonical state.

## Testing

Domain and server tests prove full replacement rather than merge behavior. Migration tests verify transactional table cleanup and credential preservation. Store and route tests verify cache clearing, typed confirmation, revision conflicts, and failure copy. End-to-end coverage dirties all supported layers, resets once, and asserts canonical state.

