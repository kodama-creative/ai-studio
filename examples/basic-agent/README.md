# Basic Agent

This example exercises the complete local path:

```text
code-first agent → loader → SessionApplication → AgentEngine → Pi Run executor → authored tool
                                      ↘ SQLite checkpoints + Session history
```

It uses Pi's deterministic `faux/local` model by default, so it runs without an
API key:

```sh
mise run dev:agent -- --message "hello local agent"
```

Run without `--message` to open an interactive conversation:

```sh
mise run dev:agent
```

The CLI prints the session id. Reattach it later with:

```sh
mise run dev:agent -- --session <session-id>
```

Sessions are stored under
`$LLM_SPACE_HOME/engine/basic-agent` or, when `LLM_SPACE_HOME` is unset,
`~/.llm-space/engine/basic-agent`.

To use a real provider, select a Pi model and provide its normal environment
credential:

```sh
OPENAI_API_KEY=... \
LLM_SPACE_MODEL=openai/gpt-5.4-mini \
mise run dev:agent
```

The local host currently registers the Pi OpenAI, Anthropic, Google, and
OpenRouter providers.
