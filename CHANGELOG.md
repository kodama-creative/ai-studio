# Changelog

## [0.1.0] - 2026-07-14

### Added

- Agent runtime with definitions, shared ReAct sessions, and external agent project playgrounds
- Dual-mode authentication for OpenAI Codex provider
- Multi-tab thread playground with undo/redo and keyboard shortcuts
- File system tree view with file management and reveal support
- System prompt variables with CodeMirror autocomplete and per-message snapshots
- Structured rubric scoring for evaluations
- In-app auto-update with two-stage prompt and manual check dialog
- Tag-driven release pipeline with code signing and notarization
- macOS x64 support

### Changed

- Reduce per-flush rendering cost of streamed replies
- Memoize message rows and file system tree view for render performance
- Rename `LLM_SPACE_ROOT` to `LLM_SPACE_HOME`
- Extract headless thread semantics into core package
- Add explicit composition root and module lifecycle for desktop process

### Fixed

- Reject mutable class tool snapshots in agent runtime
- Preserve thread state across runtime runs
- Typing and textarea input performance
- `NODE_ENV` leak forcing dev-mode React into packaged builds
- Accessibility issues with labels in API key field and MCP page
