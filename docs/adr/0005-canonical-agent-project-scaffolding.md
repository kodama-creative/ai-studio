---
status: accepted
---

# Keep portable Agent source user-owned behind one atomic scaffolder

LLM Space will create Agent Projects through one canonical scaffolder exported
from `@llm-space/runtime/node` and consumed by both CLI and Desktop Bun. Studio
asks the user for a parent directory, creates a new kebab-case child directory,
and keeps the resulting portable source user-owned. Desktop registry, trust,
and Project Threads remain under `LLM_SPACE_HOME` and are written only after
the source project publishes successfully.

The scaffolder requires an absent target. It renders and validates the complete
project in a sibling staging directory, then publishes the whole root with one
rename; it never merges with or overwrites an existing directory. The canonical
base contains the manifest, general instructions, Agent definition, model,
reasoning, and declared environment requirement. V1 composes only the shipped
`local-tool`, `skill`, and `mcp-connection` presets. Local tool and skill
examples are independent; MCP requires an explicit HTTP(S) URL and at least one
exact allowlisted remote tool and carries no auth value.

CLI and Studio default to `local-tool` plus `skill`. CLI `--blank` remains only
as an empty-preset compatibility alias, explicit repeated `--preset` values
replace the default, and the destination is mandatory. Every supported preset
combination is covered by repository-owned conformance cases that generate,
load, and build the project without manual edits. Generated projects do not
contain a test or Eval protocol before the portable Eval capability ships.

## Consequences

Studio may auto-trust and open only the path it just generated successfully;
it does not copy source into app data or copy secrets into source. Creation
failure leaves no target, registry, trust record, or Thread. After success,
Studio creates the existing default Project Thread and opens Build so the user
can inspect the generated source before choosing to run it.

This decision does not create a marketplace, remote/community templates,
package installer, Git workflow, public runtime SDK, Eval format, hidden Agent
configuration, source merge/overwrite path, or preset for unshipped runtime and
deployment capabilities.
