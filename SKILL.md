---
name: creamlon-postcard
description: "Playable demo: get a postcard ticket, submit an async GitHub task, verify signed proof, and burn the ticket. Works with OpenClaw, Claude Code, Cursor, or any agent."
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

Creamlon Postcard is a local MVP. The node operator must be running the local
demo vendor at `http://localhost:8787` and the auto-deliver loop for
`echo-cred`.

Never print tokens, complete `crv1_...` credentials, HMAC secrets, private keys,
or private runtime paths. Only report the `credential_id`, Issue number, proof
URL, and verification summary.

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
- `extensions.payment.providers[].id: demo-vendor`

### 2. Request a Postcard Ticket

Call the local demo vendor. Replace `github` and `ref` with the user's GitHub
login and source tag.

```bash
curl -sS -X POST http://localhost:8787/buy/echo-cred \
  -H "content-type: application/json" \
  -d '{"github":"your-github-login","ref":"local-dev","skill":"creamlon-postcard","skill_version":"0.1.0"}'
```

The response contains a complete `crv1_...` credential. Keep it private and do
not paste it into public logs or Issues. It will be sent to Creamlon only through
the `submit --credential` argument.

### 3. Submit the Credential Task

```bash
npx --yes creamlon@0.8.2 submit imjszhang/creamlon-postcard \
  --capability-id echo-cred \
  --media-type text/plain \
  --input "Please seal this Creamlon Postcard for local-dev." \
  --requester github:your-github-login/creamlon-postcard-demo \
  --credential "crv1_..." \
  --pretty
```

Record the Issue number. The public Issue should contain only a `credential_id`
and HMAC binding, never the complete `crv1_...` secret.

### 4. Wait for Delivery

The operator's auto-deliver loop will watch pending `echo-cred` tasks, generate a
sealed postcard reply, sign the delivery proof, and push public trust logs.

### 5. Verify the Seal

```bash
npx --yes creamlon@0.8.2 fetch-proof imjszhang/creamlon-postcard <issue-number> \
  --verify \
  --pretty
```

Report the important fields:

```text
┌─────────────────────────────────┐
│  CREAMLON POSTCARD              │
│  Issue #<number> · verified ✓   │
│  signature_ok · binding_ok      │
│  ref: local-dev                 │
└─────────────────────────────────┘
```

### 6. Try the Same Ticket Again

Submit another `echo-cred` task with the same credential. It should be rejected
because the postcard ticket was already redeemed. This is the redemption part of
the demo.

### 7. Epilogue

If the user wants to open their own melon, install the platform skill:

```bash
npx skills add imjszhang/js-creamlon --skill creamlon-skill -g -y
```

Then follow `creamlon-skill` for seller and buyer workflows.

## Security

- Never expose complete `crv1_...` credentials.
- Never commit `.creamlon/runtime/`, `.env`, `.data/`, or generated private
  state.
- Public trust files live in `.creamlon/trust/`.
- This first MVP uses a localhost vendor. Do not publish the skill to remote
  users until the vendor URL is public and stable.
