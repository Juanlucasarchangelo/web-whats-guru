/*
# WhatsApp webhook signature support

1. Modified table
- Adds `app_secret` to `integration_credentials` for validating Meta's X-Hub-Signature-256 header.
- The value remains inaccessible to anon and authenticated browser roles.

2. Security
- The webhook can reject forged Meta callbacks when an app secret is supplied.
- Existing credential records remain valid because the new field is optional.
*/

ALTER TABLE integration_credentials
ADD COLUMN IF NOT EXISTS app_secret text;

REVOKE ALL ON TABLE integration_credentials FROM anon;
REVOKE ALL ON TABLE integration_credentials FROM authenticated;
