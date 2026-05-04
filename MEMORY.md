# MEMORY.md - Jarvis's Long-Term Memory

## Sam
- **Telegram user ID:** 1794800215
- **Timezone:** IST (UTC+5:30)
- **Notes:** Concise, direct communication preferred. No filler.

## Setup
- Telegram bot configured with `dmPolicy: allowlist`, only Sam (1794800215) can DM.
- Gateway running on 127.0.0.1:18789.

## Model Fallback Chain
- **Primary:** `openrouter/openrouter/owl-alpha` (1.0M context)
- **Premium fallbacks (GitHub Copilot OAuth):** claude-opus-4.7 → gpt-4.1 → o4-mini → gemini-2.5-pro
- **Free fallbacks (OpenRouter):** Nemotron 3 Super → Qwen3 Next 80B → GPT-OSS 120B → Llama 3.3 70B → Gemma 3 27B → MiniMax M2.5
- **Switch via:** `session_status(model="github-copilot/...")` or `session_status(model="openrouter/...")`

## Google Workspace
- **Account:** sameer.sakhare.aws@gmail.com
- **Services:** Gmail, Calendar, Drive, Contacts, Sheets, Docs
- **Auth:** OAuth via `gog` CLI, credentials at `~/.config/gogcli/credentials.json`
- **Contact:** samsakhare@gmail.com → "Sameer (Owner)" (people/c8899495264296066499)
