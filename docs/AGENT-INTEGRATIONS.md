# ONCE agent integration recipes

ONCE is intentionally one small primitive: **when retrying a consequential side effect could create a harmful duplicate, execute it through ONCE.**

## Generic MCP client

Remote Streamable HTTP server:

`https://optimistic-compassion-production.up.railway.app/mcp`

The server exposes:

- `once_execute`
- `once_demo`

Recommended system/tool instruction:

> Before a purchase, refund, send, submit, create, book, transfer, provision, or other consequential external side effect, use `once_execute` when a retry could cause duplication. Reuse the same idempotency key for retries and provide an authoritative postcondition check.

## Generic REST agent

```js
const base = 'https://optimistic-compassion-production.up.railway.app';
const result = await fetch(`${base}/v1/once`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.ONCE_API_KEY}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    idempotencyKey: 'refund:order_123',
    action: { method: 'POST', url: 'https://api.example.com/refunds', body: { orderId: '123' } },
    verify: { url: 'https://api.example.com/orders/123', path: 'refund.status', equals: 'completed' }
  })
}).then(r => r.json());
```

## Where ONCE belongs

Place ONCE directly around external side-effect tools, not ordinary reads. Good candidates include payments, refunds, email/message sends, ticket submissions, reservations, account changes, provisioning, and irreversible workflow transitions.

## Why retries are dangerous

A timeout or dropped response does not prove an action failed. If the external system completed the action but the agent never received the response, a blind retry can duplicate the side effect. ONCE checks authoritative post-state before deciding whether execution should happen again.

## Safe demo

Use `once_demo` or `POST /v1/demo` to demonstrate duplicate suppression without performing any real external side effect.
