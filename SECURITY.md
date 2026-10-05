# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: the **Security** tab of this repository → **Report a vulnerability**. If you cannot use that, write through the contact form at https://domia.ai/contact and say it is a security report; you will be given a private channel.

Include what you can: the affected version or commit, how to reproduce it, and what an attacker gains. Never include real tokens, secrets or other people's voice recordings.

You will get an acknowledgement within a few days. A fix is prepared privately and credited to you in the release notes unless you prefer otherwise.

## Supported versions

Domia is pre-1.0. Only the `main` branch receives security fixes.

## What is in scope

Domia runs on a home or local network and is designed to keep voice, memory and configuration on the user's own devices. Reports are especially useful about:

- the node's HTTP and gRPC surface: authentication with the mesh secret on non-loopback access, secret rotation, satellite tokens, TLS and mTLS
- the mesh between nodes: heartbeat signatures, config sync, delegation of inference
- skills: an MCP server is untrusted input by default — tool results, tool descriptions and the descriptor a server ships (`domia://descriptor`) must not be able to change policy, run tools without the confirmation its risk class requires, or inject instructions into the model
- model and asset installation: download hosts, archive extraction
- anything that makes a secret, a provider token or a private memory appear in logs, traces, exports or replies
- satellites: pairing, encryption keys, audio that leaves the device it was captured on

## Out of scope

- Attacks that require an already compromised host or physical access to an unlocked device.
- The behaviour of third-party services a user connects (a Home Assistant instance, a music server, a model server), unless Domia makes it worse.
- Model quality problems (a wrong answer, a misheard sentence) that have no security consequence — use a normal issue.
