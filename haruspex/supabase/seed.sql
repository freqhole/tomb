-- seed data for local development only
-- runs on `supabase db reset`, never deployed to production

-- create test auth users (password: testpass123 for all)
-- bcrypt hash generated via: npx bcryptjs-cli hash testpass123
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change,
  phone_change_token,
  email_change_token_current,
  email_change_confirm_status,
  reauthentication_token,
  is_sso_user,
  is_anonymous
) VALUES 
  (
    '11111111-aaaa-1111-aaaa-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'alice@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "alice@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '22222222-bbbb-2222-bbbb-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'bob@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "bob@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '33333333-cccc-3333-cccc-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'carol@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "carol@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  );

-- create identities for the users (required for auth to work)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  created_at,
  updated_at
) VALUES
  (
    '11111111-aaaa-1111-aaaa-111111111111',
    '11111111-aaaa-1111-aaaa-111111111111',
    '{"sub": "11111111-aaaa-1111-aaaa-111111111111", "email": "alice@test.local"}',
    'email',
    'alice@test.local',
    NOW(),
    NOW()
  ),
  (
    '22222222-bbbb-2222-bbbb-222222222222',
    '22222222-bbbb-2222-bbbb-222222222222',
    '{"sub": "22222222-bbbb-2222-bbbb-222222222222", "email": "bob@test.local"}',
    'email',
    'bob@test.local',
    NOW(),
    NOW()
  ),
  (
    '33333333-cccc-3333-cccc-333333333333',
    '33333333-cccc-3333-cccc-333333333333',
    '{"sub": "33333333-cccc-3333-cccc-333333333333", "email": "carol@test.local"}',
    'email',
    'carol@test.local',
    NOW(),
    NOW()
  );

-- profiles are auto-created by trigger, but let's set display names
UPDATE public.profiles SET display_name = 'Alice' WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
UPDATE public.profiles SET display_name = 'Bob' WHERE id = '22222222-bbbb-2222-bbbb-222222222222';
UPDATE public.profiles SET display_name = 'Carol' WHERE id = '33333333-cccc-3333-cccc-333333333333';

-- test groups (alice creates them)
INSERT INTO public.groups (id, name, description, invite_code, created_by)
VALUES 
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'freqhole-dev', 'Development testing group', 'dev-test-invite', '11111111-aaaa-1111-aaaa-111111111111'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'music-friends', 'Share music with friends', 'music-friends-123', '11111111-aaaa-1111-aaaa-111111111111');

-- add users to groups with roles
-- alice is owner of both groups (as creator)
INSERT INTO public.group_members (group_id, user_id, role)
VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'owner'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '11111111-aaaa-1111-aaaa-111111111111', 'owner'),
  -- bob is admin of freqhole-dev
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '22222222-bbbb-2222-bbbb-222222222222', 'admin'),
  -- carol is member of music-friends
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '33333333-cccc-3333-cccc-333333333333', 'member');

-- test credentials for local dev:
--   alice@test.local / testpass123  (owner of both groups)
--   bob@test.local / testpass123    (admin of freqhole-dev)
--   carol@test.local / testpass123  (member of music-friends)
--
-- invite codes:
--   dev-test-invite     (join freqhole-dev)
--   music-friends-123   (join music-friends)
