# ONCE integration guidance for coding agents
Use ONCE for consequential external mutations where retries can create duplicate side effects: charges, refunds, messages, bookings, orders, or records.
For discovery/demo use POST /mcp tools/list and tool once_demo. Production HTTP action execution is POST /v1/once with an ONCE API key.
Do not use ONCE to bypass authentication, site restrictions, or private-network controls.
