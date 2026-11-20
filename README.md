# Agent Receipts

Prove what your agent did. An interactive, browser-based proof of concept for
**tamper-evident agent execution receipts**.

Live demo: https://kulraj69.github.io/agent-receipts/

## What it does

Run a demo agent episode (e.g. "Plan a weekend trip"). Every step, a tool call
with its input and output, is sealed into a hash chain:

```
receipt[i] = SHA-256({ index, tool, input, output, prev: receipt[i-1].hash })
```

Then, in the browser:

- **Verify chain**, recomputes every hash and link. A clean chain shows its seal.
- **Tamper mode**, edit any recorded output and watch verification flag exactly
  that step as tampered and invalidate everything after it.
- **Replay steps**, re-executes replayable tools (fixed demo data, pure
  functions) and compares against the recorded outputs. Side-effecting steps
  like `send_summary` cannot be honestly re-run; their receipt is the record.
- **Export / verify a file**, download the chain as JSON, verify an upload.

Everything runs client-side. No accounts, no servers, no API keys, no cost.

## Why

Agents take actions, and "trust me, the agent did X" is not evidence. A receipt
chain makes an agent's history tamper-evident: anyone with the receipts can
check that the record was not edited after the fact, and deterministic steps can
be replayed against their recorded outputs.

Sibling project: [trace-replay](https://github.com/Kulraj69/trace-replay) is a
Python library for deterministic span recording, replay and diffing of agent
traces. Agent Receipts is the hosted, interactive angle: tamper evidence and
verification anyone can try in a browser.

## Run locally

It is a static site, open `index.html`, or serve the folder:

```
python3 -m http.server 8000
```

## Tests

The core (`receipts.js`) has a Node test suite covering chain building,
determinism, tamper detection, link breaks, replay, and export round-trips:

```
node test.js
```

## Honest scope

This is a proof of concept. The tool registry uses fixed demo data so replay is
meaningful.

Security boundary, stated plainly:

- An **unkeyed** hash chain is tamper-evident, not tamper-proof. It detects
  edits relative to the retained hashes, but anyone holding the receipts can
  rewrite the whole history and recompute a clean-looking chain.
- A receipt does not prove a step actually executed, only that the record was
  sealed. It says nothing about whether the agent's outputs were correct.
- Proving an execution to someone else needs the seal **anchored** somewhere
  the editor cannot rewrite: a digital signature, a trusted timestamping
  service, or publishing the seal to an independent log. Anchoring is out of
  scope for this demo.
- A receipt for a side effect proves the record exists, not that the world
  agrees with it.

## License

MIT, see [LICENSE](LICENSE).
