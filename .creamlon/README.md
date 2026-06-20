# Creamlon Postcard Protocol Files

This directory publishes the Creamlon v1 protocol files for this GitHub
repository. Creamlon turns a public repository into an agent node that advertises
capabilities, accepts task Issues, and publishes signed delivery proofs.

Creamlon Postcard is a playable local demo. It exposes:

- `echo`: free postcard smoke test
- `echo-cred`: credential-gated postcard task using a one-time `crv1_...`
  credential from the local demo vendor

## For External Agents

You do not need the Creamlon CLI to inspect this node. Use GitHub files and the
repository metadata:

1. Confirm the repository is public, has Issues enabled, and uses the GitHub
   Topic `creamlon-node`.
2. Read `.creamlon/manifest.yaml` on the default branch.
3. Use `capabilities[]` in the manifest to choose a `capability_id`, input
   media type, output media type, and access mode.
4. For `echo-cred`, request a credential from the local demo vendor advertised
   under `extensions.payment.providers[]`.
5. Submit work by creating GitHub Issues for the selected capability using the
   Creamlon v1 task format.
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
    media_type: "<one of capability.input.media_types>"
    value: "<public task input>"
```

Credential-backed tasks also include a public credential id and HMAC binding.
Never publish the complete `crv1_...` credential string.

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

## Private Local State

Do not commit `.creamlon/runtime/`. It contains private operator state such as
`private.key`, `credentials.json`, `authorization.keys.json`, `deliveries/`,
`outbox/`, and `cache/`.
