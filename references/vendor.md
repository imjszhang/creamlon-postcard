# Creamlon Postcard Vendor

Creamlon Postcard uses a local demo vendor to issue one-time credentials for the
`echo-cred` capability. The vendor is part of the local MVP and is not a public
payment service.

## Endpoint

```http
POST http://localhost:8787/buy/echo-cred
content-type: application/json
```

Request body:

```json
{
  "github": "your-github-login",
  "ref": "local-dev",
  "skill": "creamlon-postcard",
  "skill_version": "0.1.0"
}
```

Successful response:

```json
{
  "credential": "crv1_<id>.<secret>",
  "credential_id": "<id>",
  "capability_id": "echo-cred",
  "expires_at": "2026-06-21T00:00:00.000Z",
  "flavor": "Postcard ticket sealed for local-dev."
}
```

## Ref Values

Use a short source tag:

| Ref | Use |
| --- | --- |
| `local-dev` | Local MVP testing |
| `postcard-clawhub` | Future ClawHub traffic |
| `postcard-skills-sh` | Future skills.sh traffic |
| `postcard-x-YYYYMMDD` | Future X campaign |

## Credential Hygiene

- Treat the complete `crv1_...` string as a secret.
- Do not paste the complete credential into GitHub Issues, commits, screenshots,
  or logs.
- The public Issue should contain only a credential id and task-bound HMAC.
- Report only the `credential_id`, Issue number, and verification summary.

## Local MVP Limits

- The vendor binds credentials to `echo-cred`.
- It stores issuance records under `.data/issuance.json`.
- It rate-limits by GitHub login and IP in memory.
- It is intended for localhost testing until a public vendor URL is chosen.
