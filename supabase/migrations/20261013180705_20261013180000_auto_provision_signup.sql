/*
# Automatic organization provisioning on signup

1. Purpose
- Automatically creates the user's profile, organization, and owner membership when a new account is created.
- Removes the need for a company-request or onboarding approval screen.

2. Trigger behavior
- Runs after a row is inserted into `auth.users`.
- Uses the new user's ID from the trigger record, never a client-supplied owner ID.
- Uses the signup full name when available and falls back to `Minha Empresa`.
- Generates a unique organization slug.

3. Security
- The trigger function is SECURITY DEFINER with a fixed `search_path`.
- Direct EXECUTE access is revoked from public roles; the function is used only by the database trigger.
- Existing RLS policies on `user_profiles`, `organizations`, and `org_members` remain in force for browser access.

4. Compatibility
- Uses `IF NOT EXISTS` and conflict-safe inserts so the trigger is safe for existing users and repeated deployments.
- Existing organizations, memberships, profiles, and user data are preserved.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user_auto_provision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  display_name text;
  organization_name text;
  organization_slug text;
  new_org_id uuid;
BEGIN
  display_name := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '');
  organization_name := COALESCE(display_name || ' - Empresa', 'Minha Empresa');
  organization_slug := trim(both '-' from regexp_replace(lower(organization_name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(NEW.id::text, 1, 8);

  INSERT INTO public.user_profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(display_name, ''))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.organizations (name, slug, owner_id)
  VALUES (organization_name, organization_slug, NEW.id)
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO new_org_id;

  IF new_org_id IS NULL THEN
    SELECT id INTO new_org_id
    FROM public.organizations
    WHERE owner_id = NEW.id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF new_org_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status)
    VALUES (new_org_id, NEW.id, 'owner', 'active')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user_auto_provision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_auto_provision() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_auto_provision() FROM authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_auto_provision ON auth.users;
CREATE TRIGGER on_auth_user_created_auto_provision
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_auto_provision();