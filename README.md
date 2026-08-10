# ONCE — Milestone 1, Phase 5
**Your agent says it worked. ONCE makes sure it actually did — once.**

This package completes Phase 4 deployment hardening and adds the Phase 5 public-launch/MCP probe.

## Included
- durable exactly-once/idempotency receipts
- cross-process locking
- postcondition verification
- API keys + quotas + metering
- `/health`, `/ready`, `/version`
- public duplicate-suppression demo at `POST /v1/demo`
- outbound SSRF/private-network protection by default
- rate limits + request IDs + security headers
- Docker + Railway + Render deployment configs
- V0 MCP endpoint at `POST /mcp`
- MCP manifest template + `AGENTS.md`
- first-live-call smoke script

## Local proof
```bash
npm test
npm start
# another terminal
npm run smoke
```

## Deploy
Read `LAUNCH.md`. Keep V0 to one replica with persistent storage.

## API key
```bash
npm run key:issue -- --name local
```

## Deliberately NOT in Milestone 1
Stripe billing, horizontal scaling, hosted SQL, cryptographic receipts, package-registry SDKs, and full production MCP authenticated execution. Those should follow evidence from the public probe.
