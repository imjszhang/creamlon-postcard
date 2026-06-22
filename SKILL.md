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
one-time `postcard` ticket, submit a private prompt, receive a private
`postcard.png`, and verify the signed delivery proof.

Creamlon Postcard is an agent-native MVP. The buyer agent creates a dedicated
private GitHub inbox repo, receives the complete `crv1_...` credential there,
writes the postcard prompt there, and submits only an `input.digest` publicly.

Never print tokens, complete `crv1_...` credentials, HMAC secrets, private keys,
private runtime paths, private prompts, or private inbox contents. Only report
the `credential_id`, Issue number, inbox paths, proof URL, and verification
summary.

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

- `postcard`
- `capabilities[].access.mode: credential`
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

### 3. Redeem a Postcard Ticket

Open the provider URL from the manifest:

```text
https://imjszhang.github.io/creamlon-postcard/
```

The buyer agent should confirm the authenticated GitHub login, generate the demo
receipt, and write it to the private inbox:

```text
.creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

The receipt must use `capability_id: postcard`. Open a public redeem Issue:

```yaml
type: purchase-redeem
version: "1"
provider: github-pages-demo-vendor
payment_intent_id: pi_demo_YYYYMMDD_your-github-login
capability_id: postcard
buyer: github:your-github-login
inbox_repo: your-github-login/creamlon-inbox-postcard
receipt_path: .creamlon-inbox/purchases/pi_demo_YYYYMMDD_your-github-login.json
```

Wait for the seller agent to comment with `credential_id` and a private inbox
credential path. Read the complete `crv1_...` only from the private inbox. Keep
it private and do not paste it into public logs or Issues.

### 4. Submit a Private Postcard Prompt

Write the prompt only to the private inbox, then submit a public task with
`input.digest` and the private input extension. The helper script performs both
steps:

```bash
node scripts/submit-private-postcard.mjs \
  --inbox-repo your-github-login/creamlon-inbox-postcard \
  --requester github:your-github-login/creamlon-postcard-demo \
  --credential-file ./postcard_credential.json \
  --input "Create a warm birthday postcard for Alice with cats, cake, and stars."
```

The public Issue should contain only `input.digest`, `credential_id`, and HMAC
binding. It must never contain the private prompt or the complete credential.

### 5. Wait for Delivery

The operator's auto-deliver loop watches pending `postcard` tasks, reads the
private prompt from the buyer inbox, verifies the digest, renders `postcard.png`,
writes private artifacts back to the inbox, signs `delivery.json`, and pushes
public trust logs.

### 6. Verify the Seal

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
delivery_path: .creamlon-inbox/deliveries/issue-<number>/delivery.json
postcard_path: .creamlon-inbox/deliveries/issue-<number>/postcard.png
```

### 7. Try the Same Ticket Again

Submit another `postcard` task with the same credential. GitHub will accept the
Issue, but the node's `watch` validation should reject it with
`credential already redeemed`.

## Security

- Never expose complete `crv1_...` credentials.
- Never put private prompts in public Issue bodies; use `input.digest`.
- Never commit `.creamlon/runtime/`, `.env`, `.data/`, or generated private
  state.
- Use only a dedicated private inbox repository for credentials, prompts, and
  private postcard artifacts.
- Public trust files live in `.creamlon/trust/`.
