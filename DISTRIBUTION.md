# ONCE Distribution Kit

## One-line pitch
Never let an AI agent accidentally do the same consequential action twice.

ONCE is a tiny reliability layer for agent side effects: idempotency + outcome verification + durable receipt.

## Copy/paste launch post
AI agents retry. Consequential actions sometimes return ambiguous results. A naive retry can create a second refund, payment, email, booking, order, webhook or record.

ONCE sits around the action, verifies the post-state, and stores a receipt so a retry can return the known outcome instead of blindly doing the action again.

Try the public duplicate-suppression demo twice with the same ID:

`curl -X POST https://optimistic-compassion-production.up.railway.app/v1/demo -H 'content-type: application/json' -d '{"id":"hello-once"}'`

The second call should report `duplicateSuppressed: true`.

Repo: https://github.com/GSterlingPress/once-api

## Short social version
Agents retry. Side effects shouldn't.

ONCE prevents duplicate consequential AI-agent actions using idempotency + outcome verification + durable receipts.

Refunds. Payments. Emails. Bookings. Orders. Webhooks.
https://github.com/GSterlingPress/once-api

## Hacker News / technical community version
**ONCE: a small execution-safety layer for AI agent side effects**

The failure mode is simple: an agent performs an external action, receives a timeout or ambiguous response, and retries. If the first action actually succeeded, the retry can duplicate the side effect.

ONCE wraps that boundary with an idempotency key, authoritative postcondition verification and a durable receipt. Repeated calls can return the verified receipt rather than execute again.

There is a no-signup public demo, self-serve experimental keys, REST and remote MCP support. The current V0 is intentionally conservative and is not positioned for high-stakes financial production use yet.

## Search phrases to use naturally
AI agent idempotency; prevent duplicate agent actions; agent retry safety; exactly-once AI actions; AI payment retry safety; AI agent side effects; MCP idempotency; agent execution reliability.

## Integration trigger
If an agent is about to perform a side effect that would be harmful or annoying to repeat, use ONCE.

## Public endpoints
Demo: https://optimistic-compassion-production.up.railway.app/v1/demo
Trial: https://optimistic-compassion-production.up.railway.app/v1/trial
MCP: https://optimistic-compassion-production.up.railway.app/mcp
Stats: https://optimistic-compassion-production.up.railway.app/v1/stats

## Distribution targets
- MCP ecosystem listings and clients
- agent framework examples
- AI reliability / observability / payments discussions
- developer newsletters and directories
- Hacker News / Show HN
- relevant Reddit communities, with technical value rather than link spam
- GitHub search/discovery
- automation and workflow developer communities

## Rule
Lead with the duplicate-action failure mode and the 30-second demo. Never overstate production readiness.
