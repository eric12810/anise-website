# Anise staging deployment

- Order-confirmation sender: `anise@loveanise.co.uk` (Gmail/Google Workspace). Cash-order receipt and acceptance emails were deployed and verified in the checkout workflow chat. Do not store passwords or access tokens in this file.

- Website staging URL: https://staging.anise.dotnetcloud.co.uk/ (HTTPS verified 30 October 2026).
- Hosting: Winserve FTP over TLS, using the FileZilla site-manager profile for host `wsuk32.pronameserver.com` and account `188230`. Credentials remain in FileZilla, not this document.
- Website directory: `/188230/staging.anise.dotnetcloud.co.uk/wwwroot`.
- Existing POS menu API: `https://www.anise.dotnetcloud.co.uk/api/menu`. This is not confirmed to be a staging POS.
- The user confirmed there is no separate staging POS; the existing AnisePOS project is the intended test project. The user confirmed that the running POS and its database may receive test changes and orders. Card payments must remain disabled until the complete payment flow is verified.
- The existing POS runs at `https://www.anise.dotnetcloud.co.uk`; the user authorized using its database for testing. The delivery quote endpoint is enabled. The website cash-order endpoint is enabled for testing and creates real unpaid orders in the running POS database. Staff acceptance and estimated times were subsequently deployed. Website card checkout remains disabled; see the verification record below.

## Stripe verification record (reviewed 5 November 2026)

- The earlier checkout workflow chat records a successful £6.50 Stripe test payment creating POS order #1034, marked Online / Paid and STRIPE TEST - DO NOT PREPARE. The Stripe webhook returned HTTP 200; replaying the event returned HTTP 200 without creating another order. No real card was charged.
- Temporary test-session settings were removed after that test. The hosted card-availability endpoint returned `{"available":false}` on 4 November 2026.
- The current local checks passed on 4 November, including Stripe confirmation, signature validation, paid-event validation, refund success/retry/pending/failure/amount validation, and email wording checks. These checks do not establish current end-to-end hosted readiness.
- On 5 November, verified the hosted test keys, webhook secret, return URLs and active Stripe webhook destination. Temporarily enabled session creation for two labelled £1.50 collection tests, then restored `StripeSessionsEnabled=false` and verified public card availability was false.
- Both checkout requests returned the same Stripe session when retried; both initially returned HTTP 202 from customer tracking. The cancellation link returned to the correct payment-not-completed page. The browser resume button was not exercised because these sessions were created through the website API rather than the checkout form.
- Refund test: Stripe rejected its simulated decline card; tracking remained HTTP 202. Retrying the same session with the successful test card created POS order #1074 (Online / Paid, STRIPE TEST REFUND, kitchen note DO NOT PREPARE). The browser returned to the customer tracking page with that order number.
- Declining #1074 in the POS completed successfully. A direct Stripe read confirmed `livemode=false`, amount 150 pence, `refunded=true`, and `amount_refunded=150`. Customer tracking reports Cancelled. No real money was charged or refunded.
- The second payment subsequently succeeded on 5 November, creating #1075 (STRIPE TEST ACCEPTANCE, DO NOT PREPARE). Staff acceptance with a 15-minute estimate produced Accepted status and an estimated collection time of 15:11 on the customer page; the API returned 2026-11-05T15:11:58+00:00. Stripe confirmed the 150-pence test payment as paid. #1075 remains accepted and labelled as a test.
- Gmail verified receipt and acceptance emails for #1075 in the Anise inbox, with the same 15:11 estimate. Receipt and decline messages for #1074 were also found, in Trash. No mailbox messages were sent manually, moved or deleted during this verification.
- Final public card availability remained false. Remaining before launch: verify the full website form and cancellation-page resume flow, implement explicit live-mode support (current guards reject live keys/events/refunds), configure live Stripe settings and webhook, then verify launch readiness. Successful test-mode verification is not live-payment activation.

### Full unpaid resume browser test — 5 November 2026

Passed in Chrome on HTTPS staging: added Still Water 330ml (£1.50), kitchen note UNPAID RESUME TEST - DO NOT PREPARE, entered collection checkout details and selected card. Stripe opened a test session. Clicking Back to Anise returned to the cancellation page with Return to secure checkout available. Clicking that button reopened the exact same Stripe session and £1.50 amount.

Direct Stripe verification afterward confirmed session open, payment unpaid, amount 150 pence. Customer tracking returned HTTP 202 (no completed order). No payment was submitted. Public card checkout was restored to disabled and the availability endpoint returned false. This completes the previously outstanding unpaid resume browser path; live-mode implementation and configuration remain separate work.

### User testing enabled — 5 November 2026

At the user’s explicit request, public card checkout was enabled in Stripe test mode and the hosted availability endpoint returned true. It is intentionally left enabled for the user to inspect the flow. Live payments remain unsupported and no live keys were configured. This supersedes the disabled status recorded above.
