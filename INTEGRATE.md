# Integrate ONCE

Prevent a consequential AI-agent action from being executed twice when retries, timeouts, or ambiguous responses make the original outcome uncertain.

## 30-second test

```bash
curl -s -X POST https://optimistic-compassion-production.up.railway.app/v1/demo -H "content-type: application/json" -d '{"id":"hello-once"}'
```

## Remote MCP

```text
https://optimistic-compassion-production.up.railway.app/mcp
```

## Production

- REST/docs base: https://optimistic-compassion-production.up.railway.app
- MCP: https://optimistic-compassion-production.up.railway.app/mcp
- Repository: https://github.com/GSterlingPress/once-api

## Where it belongs

Put ONCE immediately before the machine decision it improves, inside agent tool wrappers, workflow engines, middleware, job runners, or backend orchestration. Keep the integration narrow and observable. Do not count health checks, validators, crawlers, or our own tests as adoption.

## Failure behavior

Treat this as an advisory/reliability service, not magical certainty. If it is unavailable or returns insufficient evidence, preserve your application's existing safe fallback and never upgrade UNKNOWN into certainty.
