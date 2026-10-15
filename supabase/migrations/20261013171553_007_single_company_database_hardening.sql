/*
# Single-company database hardening

1. Purpose
- Refactors onboarding so the connected Supabase project uses one shared company instead of creating one organization per user.
- Keeps existing organizations and records intact; no tables or user data are deleted.

2. Organization behavior
- `create_organization(text)` now reuses the first existing organization when one exists.
- When the database has no organization, it creates `Minha Empresa` with the stable slug `converso-default`.
- Every authenticated caller is added to that same organization as `owner` for the first creator or `agent` for subsequent users.
- Membership insertion is idempotent.

3. Security changes
- Explicitly revokes anonymous execution of both SECURITY DEFINER functions.
- Keeps execution available only to authenticated users.
- Both functions retain a fixed `search_path` and derive the acting user from `auth.uid()`.

4. Data safety
- Existing tables, rows, relationships, and RLS policies are preserved.
- The migration is safe to run more than once.
*/

CREATE OR REPLACE FUNCTION create_organization(org_name text)
RETURNS organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  new_org organizations;
  normalized_name text := btrim(org_name);
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  IF char_length(normalized_name) < 2 OR char_length(normalized_name) > 120 THEN
    RAISE EXCEPTION 'invalid_organization_name';
  END IF;

  SELECT * INTO new_org
  FROM organizations
  WHERE slug = 'converso-default'
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO new_org
    FROM organizations
    ORDER BY created_at ASC, id ASC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO organizations (name, slug, owner_id)
    VALUES (normalized_name, 'converso-default', caller_id)
    ON CONFLICT (slug) DO NOTHING
    RETURNING * INTO new_org;

    IF NOT FOUND THEN
      SELECT * INTO new_org
      FROM organizations
      WHERE slug = 'converso-default'
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO org_members (org_id, user_id, role, status)
  VALUES (
    new_org.id,
    caller_id,
    CASE WHEN new_org.owner_id = caller_id THEN 'owner' ELSE 'agent' END,
    'active'
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN new_org;
END;
$$;

REVOKE ALL ON FUNCTION create_organization(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_organization(text) FROM anon;
GRANT EXECUTE ON FUNCTION create_organization(text) TO authenticated;

REVOKE ALL ON FUNCTION seed_demo_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION seed_demo_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION seed_demo_data(uuid) TO authenticated;
