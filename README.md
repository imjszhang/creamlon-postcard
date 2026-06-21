# creamlon-postcard

Creamlon Postcard is a playable Creamlon demo: use a GitHub Pages checkout,
receive a one-time private credential through a buyer-owned GitHub inbox, submit
an async GitHub task, and verify the signed delivery proof.

This repository is a bundled Creamlon melon. Public protocol files live in
`.creamlon/`; private operator state stays in `.creamlon/runtime/`.

## What You Will See

1. A buyer agent uses the GitHub Pages demo checkout for `echo-cred`.
2. The buyer creates a private GitHub inbox repo and grants seller write access.
3. The seller agent validates the demo paid receipt and writes a private
   `crv1_...` credential to the inbox.
4. The buyer submits a GitHub Issue task with the credential binding.
5. The operator auto-delivers a sealed postcard response and writes private
   artifacts back to the inbox.
6. Anyone can verify `signature_ok` and `binding_ok` from the public proof.
7. Reusing the same credential is rejected during node validation.

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

## Run the Agent MVP

The public demo checkout lives at:

```text
https://imjszhang.github.io/creamlon-postcard/buy/echo-cred/
```

Configure GitHub Pages for this repository to use GitHub Actions as the source.
The workflow in `.github/workflows/pages.yml` builds `site/src` into `dist` and
publishes the generated artifact.

After a buyer opens a purchase-redeem Issue and grants access to their private
inbox repo, issue the credential:

```bash
node scripts/redeem-purchase.mjs --issue <purchase-issue-number>
```

Then run the auto-deliver loop or a single pass:

```bash
node scripts/auto-deliver.mjs --capability-id echo-cred --push --limit 5
```

Ask an agent to use `SKILL.md`, or inspect the node manually:

```bash
npx --yes creamlon@0.8.2 inspect imjszhang/creamlon-postcard --pretty
```

The GitHub Pages demo vendor URL is advertised in `.creamlon/manifest.yaml`.
The legacy local vendor remains available for local-only experiments:
`node vendor/server.mjs`.

## External Agents

Agents do not need the Creamlon CLI to inspect this node. They can read
`.creamlon/README.md` for orientation and `.creamlon/manifest.yaml` for the
machine-readable capability list, access requirements, payment provider, and
GitHub Issue transport details.

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

Commit `.creamlon/trust/proofs.log`, `.creamlon/trust/redemptions.log`, and
`.creamlon/trust/status.json` after delivery. Use
`npx --yes creamlon@0.8.2 deliver --resume` after an interrupted delivery.

This template accepts free `echo` tasks and credential-gated `echo-cred` tasks.
The demo payment provider has price `0`, but keeps the checkout, receipt, and
credential redemption shape needed for a future paid vendor.

To issue a local credential by hand:

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
- Use a dedicated buyer private inbox repo for credentials and private
  artifacts. Do not mix unrelated code or secrets into that repo.
- Commit only public protocol state: `.creamlon/manifest.yaml`,
  `.creamlon/README.md`, and `.creamlon/trust/`.
- Public Issues and trust logs may contain `credential_id`, but never the full
  credential secret.
