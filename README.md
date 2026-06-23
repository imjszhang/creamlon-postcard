# creamlon-postcard

Creamlon Postcard is a playable Creamlon demo: use a GitHub Pages checkout,
receive a one-time private `postcard` credential through a buyer-owned GitHub
inbox, submit a private prompt by digest, receive a private `postcard.png`, and
verify the signed delivery proof.

This repository is a bundled Creamlon melon. Public protocol files live in
`.creamlon/`; private operator state stays in `.creamlon/runtime/`.

## What You Will See

1. A buyer agent uses the GitHub Pages demo checkout for `postcard`.
2. The buyer creates a private GitHub inbox repo and grants seller write access.
3. The seller agent validates the demo paid receipt and writes a private
   `crv1_...` credential to the inbox.
4. The buyer writes the postcard prompt to the private inbox and submits a
   public task with only `input.digest` and credential binding.
5. The operator reads the private prompt, verifies the digest, renders
   `postcard.png`, and writes private artifacts back to the inbox.
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

The agent checkout landing page lives at:

```text
https://imjszhang.github.io/creamlon-postcard/
```

Configure GitHub Pages for this repository to use GitHub Actions as the source.
The workflow in `.github/workflows/pages.yml` builds `site/src` into `dist` and
publishes the generated artifact.

Install the Chromium browser used by Playwright before running postcard image
delivery:

```bash
npm run browser:install
```

After a buyer opens a purchase-redeem Issue and grants access to their private
inbox repo, issue the credential:

```bash
node scripts/redeem-purchase.mjs --issue <purchase-issue-number>
```

The demo redeem script expects `payment_intent_id` values like
`pi_demo_YYYYMMDD_<buyer-login>`, applies a small per-buyer/private-inbox rate
limit, and marks successful redeem Issues with the `redeemed` label.

Then ask an agent to inspect GitHub and run one reviewed delivery pass:

```bash
# Read the task and private input, verify the digest, and write a review report.
node scripts/auto-deliver.mjs --capability-id postcard --issue <task-issue-number> --stop-after preflight

# Optional: render local HTML/PNG artifacts for visual review.
node scripts/auto-deliver.mjs --capability-id postcard --issue <task-issue-number> --stop-after render

# Optional: sign the delivery and stop before publishing private inbox files.
node scripts/auto-deliver.mjs --capability-id postcard --issue <task-issue-number> --stop-after deliver

# Publish artifacts from a reviewed --stop-after deliver run.
node scripts/auto-deliver.mjs --capability-id postcard --issue <task-issue-number> --publish-reviewed

# Or perform render, deliver, and private inbox publishing in one reviewed run.
node scripts/auto-deliver.mjs --capability-id postcard --issue <task-issue-number>
```

The experimental operator flow is intentionally conservative: it processes one
task by default, aborts on validation errors instead of skipping ahead, writes a
local `.data/auto-deliver/issue-*/run-report.json` review report, keeps local
artifacts by default, and refuses to overwrite existing private inbox delivery
files unless `--allow-overwrite-private` is explicitly set after review. Use
`--batch --limit <n>` only after the pending queue has been inspected.
Operator runs also use local `.data/locks/` directories to avoid concurrent
redemption or delivery of the same purchase/task. Add `--push` only when the
local proof/trust diff has been reviewed and should be published. After
`--stop-after deliver`, use `--publish-reviewed` so the already-reviewed local
proof is published without running `creamlon deliver` a second time.

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
  --output-file ./delivery.json \
  --pretty
npx --yes creamlon@0.8.2 status --repo-path .
```

Commit `.creamlon/trust/proofs.log`, `.creamlon/trust/redemptions.log`, and
`.creamlon/trust/status.json` after delivery. Use
`npx --yes creamlon@0.8.2 deliver --resume` after an interrupted delivery.

This template accepts credential-gated `postcard` tasks. The demo payment
provider has price `0`, but keeps the checkout, receipt, private inbox, and
credential redemption shape needed for a future paid vendor.

Buyer agents should use the private submit helper instead of public `--input`:

```bash
node scripts/submit-private-postcard.mjs \
  --inbox-repo buyer-login/creamlon-inbox-postcard \
  --requester github:buyer-login/creamlon-postcard-demo \
  --credential-file ./postcard_credential.json \
  --input-file ./prompt.txt
```

The helper writes `.creamlon-inbox/requests/<request_id>/input.txt`, submits
only `input.digest`, and adds `extensions.postcard_private_input` so the
operator can read the private input from the issued inbox.

For e2e and agent-to-agent runs, failure recovery is driven by the runner's
structured failure summary or by `creamlon caller inbox check`. The normal
Postcard permission model has two GitHub surfaces: public Issues on this melon
repository, and a separate buyer-owned private inbox for credentials, prompts,
and private delivery artifacts.

To issue a local credential by hand:

```bash
npx --yes creamlon@0.8.2 credential create \
  --repo-path . \
  --capability-id <capability-id>
```

Keep `.creamlon/runtime/credentials.json` private. Commit
`.creamlon/trust/redemptions.log` alongside `.creamlon/trust/proofs.log` after
credential-backed delivery.

For tighter GitHub permissions, set `CREAMLON_PUBLIC_GITHUB_TOKEN` for seller
repo Issue/trust operations and `CREAMLON_INBOX_GITHUB_TOKEN` for buyer private
inbox reads/writes. If they are unset, scripts fall back to `GITHUB_TOKEN` or
`GH_TOKEN` for local demo compatibility.

## Security

- Never commit `.creamlon/runtime/`, `.env`, `.data/`, or complete
  `crv1_...` credentials.
- Use a dedicated buyer private inbox repo for credentials and private
  prompts and artifacts. Do not mix unrelated code or secrets into that repo.
- Commit only public protocol state: `.creamlon/manifest.yaml`,
  `.creamlon/README.md`, and `.creamlon/trust/`.
- Public Issues and trust logs may contain `credential_id`, `input.digest`, and
  private inbox paths, but never the full credential secret or private prompt.
