/*
# Secure WhatsApp integration credentials

1. New table
- `integration_credentials`
- Stores the Meta access token and webhook verification token outside the browser-readable integration configuration.
- Links one credential record to one organization integration.

2. Security
- Enables RLS on the credentials table.
- Grants no direct access to anon or authenticated browser roles.
- Server-side Edge Functions using the service role are the only path for reading and writing credentials.

3. Existing data
- If an older integration stored `access_token` inside its JSON configuration, the value is copied into the protected table and removed from the browser-readable JSON.
- Existing integrations and messages are preserved.
*/

CREATE TABLE IF NOT EXISTS integration_credentials (
  integration_id uuid PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  verify_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_org_id
  ON integration_credentials(org_id);

ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE integration_credentials FROM anon;
REVOKE ALL ON TABLE integration_credentials FROM authenticated;

INSERT INTO integration_credentials (integration_id, org_id, access_token, verify_token)
SELECT
  i.id,
  i.org_id,
  i.config->>'access_token',
  coalesce(nullif(i.config->>'webhook_verify_token', ''), encode(gen_random_bytes(24), 'hex'))
FROM integrations i
WHERE i.type = 'whatsapp'
  AND nullif(i.config->>'access_token', '') IS NOT NULL
ON CONFLICT (integration_id) DO NOTHING;

UPDATE integrations
SET config = config - 'access_token',
    updated_at = now()
WHERE type = 'whatsapp'
  AND config ? 'access_token';
