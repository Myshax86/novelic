# Novelic

Desktop app for novel writers to manage multiple timelines, drag events, and inspect overlaps with a synchronized cursor.

## Tech

- Electron + React + TypeScript + Vite
- SQLite via `better-sqlite3`
- Zustand for UI state + undo/redo history
- `react-big-calendar` for timeline interaction

## Implemented MVP Scope

- Secure Electron architecture (`contextIsolation: true`, `nodeIntegration: false`)
- SQLite schema (`novels`, `timelines`, `events`, `snapshots`) with WAL mode
- IPC handlers for CRUD, overlap query, snapshots, export/import
- Zustand state store with in-memory undo/redo (max 50 snapshots) persisted to DB snapshots
- DB snapshot retention guard (keeps latest 200 snapshots per novel)
- Multi-timeline calendar view with drag-and-drop event movement
- Event create/edit modal, delete action, search/filter sidebar
- Export full novel to JSON and timeline to CSV
- Import novel from JSON with schema shape checks

## Project Structure

- `src/main` Electron main process, DB layer, IPC handlers
- `src/preload` secure API bridge to renderer
- `src/renderer` React UI, store, hooks, components
- `src/shared` shared types

## Commands

```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
npm run dist
```

## Verification Checklist

- App starts and initializes DB in Electron user data directory
- Novel/timeline/event CRUD through UI
- Drag events in calendar updates DB
- Cursor overlap panel updates from `events:getOverlapping`
- Undo/redo updates both UI state and DB payload
- Snapshot table remains bounded per novel (latest 200 retained)
- Export/import round-trip preserves timelines/events

## Quick Manual Verification

- Perform many edits (create/update/delete events or timelines) so snapshots are created.
- Restart app and verify undo/redo still works from recent history.
- Optional DB check: inspect `snapshots` for a novel and confirm count does not exceed 200.

## Notes

This workspace currently lacks Node/npm in the active environment, so dependency installation and runtime verification must be executed once Node is available.
