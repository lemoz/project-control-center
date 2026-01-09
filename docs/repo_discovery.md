# Repo Discovery and `.control.yml`

The local server discovers projects by scanning your filesystem for git repos, then enriching them with optional per‑repo metadata.

## Discovery roots
By default, the server scans your home directory (`$HOME`) to a limited depth.

Override with:

- `CONTROL_CENTER_SCAN_ROOTS=/path/one,/path/two`

Each root is resolved to an absolute path before scanning.

## Ignore rules
Discovery skips common junk/system folders by name. Defaults include:

`node_modules`, `.venv`/`venv`, `dist`, `build`, `.next`, `__pycache__`,
`.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.cache`, `tmp`, `logs`,
`archive`, `.idea`, `.vscode`, plus macOS media/system folders like
`Library`, `Applications`, `Movies`, `Music`, `Pictures`, `Public`.

You can customize:

- Add more ignores: `CONTROL_CENTER_IGNORE_DIRS=folderA,folderB`
- Remove defaults: `CONTROL_CENTER_IGNORE_DIRS_REMOVE=Library,Movies`

Ignore matching is by directory name (not full path) and is case-sensitive.

## Depth and cache
- `CONTROL_CENTER_SCAN_MAX_DEPTH=4` (default 4)
- `CONTROL_CENTER_SCAN_TTL_MS=60000` (default 60s)

Scanning runs at most once per TTL; `/repos` uses cached results in between.

## Per‑repo sidecar: `.control.yml`
If a repo contains `.control.yml` (or `.control.yaml`) at its root, the server reads it and uses known keys to set metadata.

### Supported keys
```yaml
id: my-stable-id         # optional; overrides auto id
name: Human Name         # optional display name
description: Short blurb # optional; shown in UI
type: prototype|long_term
stage: idea|planning|building|alpha|beta|shipping|maintenance
status: active|blocked|parked
priority: 1-5
starred: true|false      # optional; pins to top
tags:
  - video
  - agents
success_criteria: |
  Short description of what "done" means for this project.
success_metrics:
  - name: "Active users"
    target: 100
    current: 12
```

If you set `id`, it remains stable across repo moves/renames; on the next scan the server updates the stored `path` for that project id.

Unknown keys are ignored by the server (and never overwritten).

### Defaults
On first discovery (no existing SQLite row) the defaults are:
- `type`: `prototype`
- `stage`: `idea`
- `status`: `active`
- `priority`: `3`
- `starred`: `false`
- `tags`: `[]`

On subsequent scans, if the sidecar omits a key (or is absent), the server keeps the existing SQLite value for that field to avoid wiping user data.

To promote a repo to long‑term or adjust priority, add a `.control.yml` file.
For guidance on writing success criteria, see `docs/success_criteria.md`.
