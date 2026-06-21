---
name: creamlon-postcard
description: "Playable demo: use a GitHub Pages checkout, receive a private postcard ticket in a GitHub inbox, submit an async GitHub task, verify signed proof, and burn the ticket."
version: 0.1.0
metadata:
  openclaw:
    requires:
      env:
        - GITHUB_TOKEN
      bins:
        - npx
    primaryEnv: GITHUB_TOKEN
---

# Creamlon Postcard

Use this skill when the user wants to run the Creamlon Postcard demo: get a
one-time postcard ticket, submit an async GitHub task, and verify the signed
delivery proof.

Creamlon Postcard is an agent-native MVP. The buyer agent uses the GitHub Pages
demo checkout, creates a dedicated private GitHub inbox repo, and opens a public
purchase-redeem Issue. The seller agent writes the complete credential only to
that private inbox.

Never print tokens, complete `crv1_...` credentials, HMAC secrets, private keys,
private runtime paths, or private inbox contents. Only report the
`credential_id`, Issue number, inbox path, proof URL, and verification summary.

## Quick Start

Use the published Creamlon CLI through npm:

```bash
npx --yes creamlon@0.8.2 help
```

Require Node.js 18 or newer. Set `GITHUB_TOKEN`, `GH_TOKEN`, or pass `--token`
for GitHub writes.

## Quest

### 1. Inspect the Postcard Melon

```bash
npx --yes creamlon@0.8.2 inspect imjszhang/creamlon-postcard --pretty
```

Confirm the manifest includes:

- `echo-cred`
- `profiles.credential.scheme: voucher-hmac-v1`
- `extensions.payment.providers[].id: github-pages-demo-vendor`

### 2. Prepare the Private Inbox

Create a dedicated private GitHub repository for this node, such as
`your-github-login/creamlon-inbox-postcard`. Grant the seller GitHub account
write access. Do not use a repository that contains unrelated code or secrets.

Write this file:

```text
.creamlon-inbox/manifest.json
```

```json
{
  "version": "1",
  "type": "creamlon_private_inbox",
  "owner": "github:your-github-login",
  "seller": "github:imjszhang",
  "public_request_repo": "imjszhang/creamlon-postcard",
  "purpose": "credential-and-delivery-inbox"
}
```

### 3. Hand Off the Agent Checkout

Open the provider URL from the manifest:

```text
https://imjszhang.github.io/creamlon-postcard/
```

Use the page as an agent handoff card. The buyer agent should confirm the
authenticated GitHub login, generate the demo receipt, and write it to the
private inbox, for example:

```text
.creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

### 4. Open the Public Purchase Redeem Issue

Open a GitHub Issue in `imjszhang/creamlon-postcard` using the body shape from
the landing page:

```yaml
type: purchase-redeem
version: "1"
provider: github-pages-demo-vendor
payment_intent_id: pi_demo_YYYYMMDD_your-github-login
capability_id: echo-cred
buyer: github:your-github-login
inbox_repo: your-github-login/creamlon-inbox-postcard
receipt_path: .creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

Wait for the seller agent to comment with `credential_id` and a private inbox
credential path. Read the complete `crv1_...` only from the private inbox. Keep
it private and do not paste it into public logs or Issues.

### 5. Submit the Credential Task

```bash
npx --yes creamlon@0.8.2 submit imjszhang/creamlon-postcard \
  --capability-id echo-cred \
  --media-type text/plain \
  --input "Please seal this Creamlon Postcard for postcard-demo." \
  --requester github:your-github-login/creamlon-postcard-demo \
  --credential "crv1_..." \
  --pretty
```

Record the Issue number. The public Issue should contain only a `credential_id`
and HMAC binding, never the complete `crv1_...` secret.

### 6. Wait for Delivery

The operator's auto-deliver loop will watch pending `echo-cred` tasks, generate a
sealed postcard reply, write private artifacts to the buyer inbox when the
credential came from a private inbox purchase, sign the delivery proof, and push
public trust logs.

### 7. Verify the Seal

```bash
npx --yes creamlon@0.8.2 fetch-proof imjszhang/creamlon-postcard <issue-number> \
  --verify \
  --pretty
```

Report the important fields:

```text
CREAMLON POSTCARD
Issue #<number> verified
signature_ok
binding_ok
ref: postcard-demo
```

If a private inbox delivery was used, read the postcard artifact from:

```text
.creamlon-inbox/deliveries/issue-<number>/
```

### 8. Try the Same Ticket Again

Submit another `echo-cred` task with the same credential. GitHub will accept the
Issue, but the node's `watch` validation should reject it with
`credential already redeemed`. This is the redemption part of the demo.

### 9. Epilogue

If the user wants to open their own melon, install the platform skill:

```bash
npx skills add imjszhang/js-creamlon --skill creamlon-skill -g -y
```

Then follow `creamlon-skill` for seller and buyer workflows.

## Security

- Never expose complete `crv1_...` credentials.
- Never commit `.creamlon/runtime/`, `.env`, `.data/`, or generated private
  state.
- Use only a dedicated private inbox repository for credentials and private
  artifacts.
- Public trust files live in `.creamlon/trust/`.
