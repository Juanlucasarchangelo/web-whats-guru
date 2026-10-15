/*
# Converso CRM - Secure organization onboarding

## Purpose
Creates a single server-side onboarding function that creates an organization and its owner membership together.
This avoids a partially-created organization and avoids relying on a client-side sequence of RLS-protected inserts.

## Function
- create_organization(org_name text): creates one organization for the authenticated caller,
  creates the caller as owner, and returns the new organization's fields.

## Security
- SECURITY DEFINER with a fixed search_path.
- Callable only by authenticated users.
- The owner is always taken from auth.uid(); the client cannot choose another owner.
- The function rejects blank or overly long organization names.
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
  generated_slug text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  IF char_length(normalized_name) < 2 OR char_length(normalized_name) > 120 THEN
    RAISE EXCEPTION 'invalid_organization_name';
  END IF;

  generated_slug := regexp_replace(
    lower(unaccent(normalized_name)),
    '[^a-z0-9]+', '-', 'g'
  );
  generated_slug := trim(both '-' from generated_slug) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO organizations (name, slug, owner_id)
  VALUES (normalized_name, generated_slug, caller_id)
  RETURNING * INTO new_org;

  INSERT INTO org_members (org_id, user_id, role, status)
  VALUES (new_org.id, caller_id, 'owner', 'active');

  RETURN new_org;
END;
$$;

REVOKE ALL ON FUNCTION create_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_organization(text) TO authenticated;
