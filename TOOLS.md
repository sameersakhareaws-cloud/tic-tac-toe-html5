# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

## OpenRouter Guardrails

### 1. Minimal Context Usage
- **Never** include full file dumps, verbose tool outputs, or unnecessary narration in prompts.
- Summarize tool results before passing them along. Only send what's needed for the next step.
- Keep assistant replies concise — Sam's time matters.
- Avoid repeating context the model already has (e.g., don't re-read files you already have in context).

### 2. Auto-Fallback on Failure
If the primary model (`openrouter/owl-alpha`) fails — rate limit (429), model unavailable, context overflow, or any API error — **automatically switch** to the next fallback model and retry.

**Auto-fallback chain (OpenRouter free models):**
1. `openrouter/nvidia/nemotron-3-super-120b-a12b:free` (262K ctx, tools)
2. `openrouter/qwen/qwen3-next-80b-a3b-instruct:free` (262K ctx, tools)
3. `openrouter/qwen/qwen3-coder:free` (262K ctx, code)
4. `openrouter/openai/gpt-oss-120b:free` (131K ctx, tools)
5. `openrouter/minimax/minimax-m2.5:free` (197K ctx, tools)
6. `openrouter/meta-llama/llama-3.3-70b-instruct:free` (66K ctx, tools)
7. `openrouter/google/gemma-3-27b-it:free` (131K ctx, vision)

**GitHub Copilot (free tier, on-demand only):**
- `github-copilot/gpt-4.1` — switch via `session_status(model="github-copilot/gpt-4.1")`
- `github-copilot/o4-mini` — switch via `session_status(model="github-copilot/o4-mini")`
- ⚠️ Copilot models are NOT in the auto-fallback chain — switch manually when needed.

**How to switch:** Use `session_status(model="openrouter/...")` or `session_status(model="github-copilot/...")` to override the model for the current session.

**Rate limits:** Free models get 20 req/min, 200 req/day per model. Copilot free tier subject to GitHub's rate limits.

### 3. Current Model
- **Primary:** `openrouter/owl-alpha` (1.0M context)
- **Fallbacks:** OpenRouter free models (see chain above)
- **On-demand:** GitHub Copilot `gpt-4.1` and `o4-mini` (manual switch only)

### 4. Web Search
- **Primary:** SearXNG via `web_fetch` → `http://172.18.0.4:8080/search?q=<query>&format=json`
  - Parse JSON results from `.results[]` array (fields: `title`, `url`, `content`)
  - Fast, private, no rate limits
- **Fallback:** Built-in `web_search` tool (DuckDuckGo)
  - Use when SearXNG is unreachable or returns 0 results
- **Retry rule:** Max 2 attempts on SearXNG, then fall back to DDG. Never loop.

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
