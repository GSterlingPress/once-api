# Official MCP Registry publication plan

ONCE is being prepared for publication as a public remote MCP server under:

`io.github.GSterlingPress/once`

The repository includes `server.json` using the official Registry schema and the live remote endpoint.

## Do not publish until these checks pass

1. `/mcp` supports the current Streamable HTTP initialization/handshake contract.
2. Required MCP methods respond correctly (`initialize`, initialized notification, `ping`, `tools/list`, `tools/call`).
3. The endpoint handles required HTTP transport semantics and Origin validation.
4. `once_demo` can be called twice with the same ID and the second call reports duplicate suppression.
5. Production execution remains clearly marked experimental until authenticated MCP execution is hardened.

## Publication

The official Registry accepts public remote servers through `server.json`. After compliance validation, authenticate `mcp-publisher` with GitHub and publish this metadata.

The Registry is a metadata registry; ONCE remains hosted at the Railway remote endpoint.
