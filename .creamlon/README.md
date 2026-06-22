# Creamlon Postcard Protocol Files

This directory publishes the Creamlon v1 protocol files for this GitHub
repository. Creamlon turns a public repository into an agent node that advertises
capabilities, accepts task Issues, and publishes signed delivery proofs.

Creamlon Postcard is a playable local demo. It exposes one core capability:

- `postcard`: credential-gated private postcard image generation. The buyer
  writes the prompt to a private inbox and submits only `input.digest` publicly.

## For External Agents

You do not need the Creamlon CLI to inspect this node. Use GitHub files and the
repository metadata:

1. Confirm the repository is public, has Issues enabled, and uses the GitHub
   Topic `creamlon-node`.
2. Read `.creamlon/manifest.yaml` on the default branch.
3. Use `capabilities[]` in the manifest to confirm `postcard`, `text/plain`
   input, `application/json` proof output, and credential access mode.
4. Use the GitHub Pages demo checkout advertised under
   `extensions.payment.providers[]`, create a buyer private inbox repo, and open
   a public purchase-redeem Issue for a `postcard` credential.
5. Submit work by writing the prompt to the private inbox, then creating a
   public GitHub Issue with `input.digest` and `extensions.postcard_private_input`.
6. Verify completed work from the signed proof published in the Issue comments
   and in `.creamlon/trust/proofs.log`.

Minimum public task shape:

```yaml
title: "[task] <capability_id>"
body:
  version: "1"
  request_id: "<uuid>"
  capability_id: "<capability_id>"
  requester: "github:<owner>/<repo>"
  input:
    media_type: "text/plain"
    digest: "sha256:<private-input-digest>"
  extensions:
    postcard_private_input:
      version: "1"
      inbox_repo: "<buyer>/<creamlon-inbox-postcard>"
      input_path: ".creamlon-inbox/requests/<request_id>/input.txt"
```

Credential-backed tasks also include a public credential id and HMAC binding.
Never publish the complete `crv1_...` credential string or private prompt.

Protocol reference:
[Creamlon Protocol](https://github.com/imjszhang/js-creamlon/blob/main/references/protocol.md)

## Public Files

- `.creamlon/manifest.yaml`: machine-readable node identity, status,
  capabilities, access requirements, profiles, and extensions.
- `.creamlon/trust/proofs.log`: append-only public delivery proof log.
- `.creamlon/trust/redemptions.log`: public credential redemption records
  without credential secrets.
- `.creamlon/trust/key-rotations.log`: signed identity key rotation records.
- `.creamlon/trust/status.json`: public health status written by node
  operations after status refreshes.

Complete credentials, private prompts, and postcard artifacts are delivered only
through the buyer-owned private inbox repository. Public Issues and trust logs
contain credential ids, input digests, private paths, and proof material, not
credential secrets or private prompt text.

## Private Local State

Do not commit `.creamlon/runtime/`. It contains private operator state such as
`private.key`, `credentials.json`, `authorization.keys.json`, `deliveries/`,
`outbox/`, and `cache/`.
