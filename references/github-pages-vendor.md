# GitHub Pages Demo Vendor

Creamlon Postcard now models the paid credential flow without running a public
backend. GitHub Pages is the public checkout surface, and a buyer-owned private
GitHub repository is the private delivery inbox for complete credentials and
postcard artifacts.

This is still a demo vendor: the payment amount is `0 POSTCARD`, and the receipt
uses `status: "paid"` as a simulated checkout result. The shape is intentionally
close to a future paid provider so the demo can later replace the receipt check
with Stripe, ClawHub, GitHub Sponsors, or another payment proof.

## Public Checkout

Provider id:

```text
github-pages-demo-vendor
```

Checkout URL:

```text
https://imjszhang.github.io/creamlon-postcard/
```

The page does not create credentials or authenticate GitHub users. It gives
buyer agents a copyable task card with the receipt and purchase request shapes
they need to create a private inbox and open a public purchase redeem Issue.

## Buyer Private Inbox

The buyer creates a dedicated private repository and grants the seller write
access. Do not use a repository that contains unrelated code or secrets.

Expected layout:

```text
.creamlon-inbox/
  manifest.json
  purchases/
    <payment_intent_id>.json
  credentials/
    echo-cred_<credential_id>.json
  deliveries/
    issue-<number>/
      result.txt
      proof.json
      status.json
```

Inbox manifest:

```json
{
  "version": "1",
  "type": "creamlon_private_inbox",
  "owner": "github:buyer-login",
  "seller": "github:imjszhang",
  "public_request_repo": "imjszhang/creamlon-postcard",
  "purpose": "credential-and-delivery-inbox"
}
```

Purchase receipt:

```json
{
  "version": "1",
  "type": "purchase_receipt",
  "payment_intent_id": "pi_demo_20260621_buyer",
  "provider": "github-pages-demo-vendor",
  "status": "paid",
  "buyer": "github:buyer-login",
  "capability_id": "echo-cred",
  "ref": "postcard-demo",
  "created_at": "2026-06-21T00:00:00.000Z"
}
```

For the demo vendor, `payment_intent_id` must use the shape
`pi_demo_YYYYMMDD_<buyer-login>`. The buyer suffix must match the GitHub login
that opens the public redeem Issue.

## Public Purchase Redeem Issue

Open an Issue in `imjszhang/creamlon-postcard` with this body:

```yaml
type: purchase-redeem
version: "1"
provider: github-pages-demo-vendor
payment_intent_id: pi_demo_20260621_buyer
capability_id: echo-cred
buyer: github:buyer-login
inbox_repo: buyer-login/creamlon-inbox-postcard
receipt_path: .creamlon-inbox/purchases/pi_demo_20260621_buyer.json
```

The public Issue must never include the complete `crv1_...` credential.

## Seller Processing

The seller agent validates the public Issue, reads the receipt from the private
inbox, creates a one-time Creamlon credential, writes the complete credential
back to the private inbox, and comments publicly with only the `credential_id`
and inbox path. Demo redeem is lightly rate-limited per buyer and private inbox;
successful redeem Issues are marked with the `redeemed` label.

Credential delivery file:

```json
{
  "version": "1",
  "type": "credential_delivery",
  "credential": "crv1_<id>.<secret>",
  "credential_id": "<id>",
  "capability_id": "echo-cred",
  "payment_intent_id": "pi_demo_20260621_buyer",
  "expires_at": "2026-06-21T01:00:00.000Z",
  "issued_by": "github:imjszhang/creamlon-postcard"
}
```

Complete credentials are allowed only in the buyer private inbox. Public Issues,
comments, logs, and trust files may contain `credential_id` only.

## Future Paid Upgrade

The upgrade path is to keep the same `payment_intent_id` and `purchase_receipt`
shape, then replace the demo receipt validator with a provider-specific proof:

- Stripe checkout session id and status.
- ClawHub payment receipt.
- GitHub Sponsors entitlement.
- Crypto payment proof.

The Creamlon credential submission and redemption proof flow does not need to
change.
