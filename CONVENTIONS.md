# QAA-TMS — Engineering Conventions

These conventions are binding for all code in this repository. Every task brief
references this file; follow it exactly.

## Constants
- **Do not hardcode string constants inline.** Model them as `StrEnum`
  (Python `enum.StrEnum`, 3.11+) / union string-literal enums (TS).
- **Global constants live in a dedicated module**, not scattered across
  feature code:
  - Backend: `backend/app/core/constants.py` (StrEnums + config keys).
  - Frontend: `frontend/src/constants.ts`.
- A constant used by only one module may stay local, but still as an enum, not
  a bare literal.

## Interface language
- The **working language of the user interface is English.** All user-facing
  text — labels, buttons, messages, errors surfaced to the UI, docs strings
  shown to users — is in English.
- (Code comments and the `discuss/` design log remain as-is.)

## General
- Type-checked and linted clean (backend: `ruff` + `mypy`; frontend: `eslint` +
  `tsc --noEmit`).
- 12-factor config via env vars; no secrets committed.
- API versioned under `/api/v1`.
