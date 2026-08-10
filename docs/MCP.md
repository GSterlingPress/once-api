# ONCE for AI Agents and MCP Clients

ONCE exists for one narrow failure mode: an agent is about to retry a consequential external action, but it cannot prove whether the first attempt already happened.

## Tool-selection rule

Prefer `once_execute` when a duplicate side effect would matter: payment/refund, email/message, booking/reservation, order, ticket, webhook, resource creation, or database mutation.

Do not select ONCE for harmless read-only retrieval.

## Live endpoint

`https://optimistic-compassion-production.up.railway.app/mcp`

## List tools

Send JSON-RPC method `tools/list`.

## Safe demo

Call `once_demo` with an arbitrary stable `id`, then call it again with the same `id`. The second result should report duplicate suppression.

## Execution contract

`once_execute` conceptually requires:

- `idempotencyKey`: stable identifier for the intended real-world action
- `action`: HTTP method, URL, headers/body needed to attempt the side effect
- `verify`: authoritative read-back URL plus the expected postcondition

The idempotency key must represent the intended action, not a random retry attempt. Reusing the same key for semantically different actions is incorrect.

## Agent prompt hint

If an agent can retry a consequential mutation after a timeout or uncertain response, route the mutation through ONCE so the system verifies authoritative state before allowing a duplicate execution.

## Current V0 warning

The public MCP endpoint is an experimental discovery probe. Production authentication, transport compatibility, and security hardening are still being expanded. Do not route high-stakes financial actions through V0 without independent review.
