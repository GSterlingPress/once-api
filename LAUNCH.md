# ONCE — First Public Launch

## Recommended V0 host: Railway
1. Create a new project from the ONCE GitHub repository or upload the project through your normal Railway flow.
2. Railway will use `railway.toml` + `Dockerfile`.
3. Add a persistent volume mounted at `/var/lib/once`.
4. Set `ONCE_DATA_DIR=/var/lib/once` and `ONCE_ALLOW_PRIVATE_NETWORK=false`.
5. Generate a public domain in Railway.
6. Confirm `https://YOUR-DOMAIN/ready` returns `ready:true`.
7. Run locally against the public service: `ONCE_BASE_URL=https://YOUR-DOMAIN npm run smoke`.
8. Issue the first production key from a shell attached to the persistent service: `npm run key:issue -- --name first-live`.
9. Store the displayed key securely; ONCE stores only its hash.

## First real authenticated call
Use a public test endpoint/system you control. Never place third-party secrets into the public demo.

## MCP launch
`POST /mcp` exposes V0 discovery and the safe `once_demo` tool. `mcp.json` is a publication template; replace `YOUR-ONCE-DOMAIN` only after deployment.

## V0 architecture warning
This filesystem-backed release is intentionally ONE service replica + ONE persistent volume. Do not horizontally scale it yet. A hosted database/lock service belongs in the next milestone.
