# creamlon-postcard

Creamlon Postcard is a playable local demo for Creamlon: get a one-time
postcard ticket, submit an async GitHub task, and verify the signed delivery
proof.

This repository is a bundled Creamlon melon. Public protocol files live in
`.creamlon/`; private operator state stays in `.creamlon/runtime/`.

## What You Will See

1. A local vendor issues a private `crv1_...` credential for `echo-cred`.
2. A caller submits a GitHub Issue task with the credential binding.
3. The operator auto-delivers a sealed postcard response.
4. Anyone can verify `signature_ok` and `binding_ok` from the public proof.
5. Reusing the same credential is rejected during node validation.

## Local Operator Setup

```bash
npx --yes creamlon@0.8.2 keygen --out .creamlon/runtime
```

1. Put `.creamlon/runtime/public.b64url` in `.creamlon/manifest.yaml` at `identity.public_key`.
2. Keep the repository public with GitHub Issues enabled.
3. Add the GitHub Topic `creamlon-node`.
4. Commit `.creamlon/manifest.yaml` and `.creamlon/trust/`.
5. Keep private operator state in `.creamlon/runtime/`, which is git-ignored.

Do not ignore the whole `.creamlon/` directory in this layout. The manifest
and trust records are public protocol files; `.creamlon/runtime/` is private
operator state.

## Run the Local MVP

Start the vendor:

```bash
node vendor/server.mjs
```

In another terminal, run the auto-deliver loop or a single pass:

```bash
node scripts/auto-deliver.mjs --capability-id echo-cred --push --limit 5
```

Then ask an agent to use `SKILL.md`, or run the Quest manually:

```bash
npx --yes creamlon@0.8.2 inspect imjszhang/creamlon-postcard --pretty
```

The local vendor URL is advertised in `.creamlon/manifest.yaml`:
`http://localhost:8787/buy/echo-cred`.

## External Agents

Agents do not need the Creamlon CLI to inspect this node. They can read
`.creamlon/README.md` for orientation and `.creamlon/manifest.yaml` for the
machine-readable capability list, access requirements, and GitHub Issue
transport details.

The root `SKILL.md` is the buyer playbook for Creamlon Postcard. It is separate
from the operator commands below.

## Operator Tasks

```bash
npx --yes creamlon@0.8.2 watch owner/repo --repo-path . --once --pretty
npx --yes creamlon@0.8.2 deliver owner/repo <issue-number> \
  --repo-path . \
  --output-file ./result.txt \
  --pretty
npx --yes creamlon@0.8.2 status --repo-path .
```

Commit `.creamlon/trust/proofs.log` and `.creamlon/trust/status.json` after
delivery. Use `npx --yes creamlon@0.8.2 deliver --resume` after an interrupted
delivery.

This template accepts free tasks. Add the optional authorization profile from
the Creamlon protocol for caller allowlists. To sell one-time task access, add
the credential profile and capability access block documented in the protocol,
then issue credentials with:

```bash
npx --yes creamlon@0.8.2 credential create \
  --repo-path . \
  --capability-id <capability-id>
```

Keep `.creamlon/runtime/credentials.json` private. Commit
`.creamlon/trust/redemptions.log` alongside `.creamlon/trust/proofs.log` after
credential-backed delivery.

## Security

- Never commit `.creamlon/runtime/`, `.env`, `.data/`, or complete
  `crv1_...` credentials.
- Commit only public protocol state: `.creamlon/manifest.yaml`,
  `.creamlon/README.md`, and `.creamlon/trust/`.
- The first MVP uses a localhost vendor. Publish to ClawHub only after choosing
  a public vendor URL.
