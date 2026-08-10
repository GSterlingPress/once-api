# Use ONCE with OpenAI Agents SDK

ONCE is intended for agent workflows where a tool call mutates an external system and a timeout or ambiguous response could cause a harmful retry.

## Remote MCP endpoint

`https://optimistic-compassion-production.up.railway.app/mcp`

OpenAI's Agents SDK supports remote Streamable HTTP MCP servers. Once ONCE's endpoint completes full Streamable HTTP compliance, configure it as a remote MCP server and let the model discover ONCE's tools.

## Tool-selection guidance

Tell the agent to prefer ONCE before retrying consequential mutations such as:

- charges and refunds
- emails and messages
- bookings and reservations
- orders and tickets
- webhooks
- database/resource creation

Do not use ONCE for harmless read-only retrieval.

## Prompt hint

Use ONCE when an external action may have succeeded even though the tool call timed out or returned an uncertain result. Reuse a stable idempotency key for the intended real-world action so ONCE can verify authoritative state before allowing a duplicate execution.

## V0 note

The current public endpoint is an experimental discovery probe. Do not use it for high-stakes production actions until transport, authentication, persistence, and failure-mode hardening are complete.
