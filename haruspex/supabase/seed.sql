-- seed data for local development only
-- runs on `supabase db reset`, never deployed to production
--
-- characters from Nancy (the comic strip):
--   fritzi (aunt), rollo (rich kid), butch (rough kid)
--   nancy (main character), sluggo (nancy's friend)

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
    'fritzi@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "fritzi@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '22222222-bbbb-2222-bbbb-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'rollo@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "rollo@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '33333333-cccc-3333-cccc-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'butch@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "butch@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '44444444-dddd-4444-dddd-444444444444',
    '00000000-0000-0000-0000-000000000000',
    'nancy@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "nancy@test.local"}',
    'authenticated',
    'authenticated',
    '', '', '', '', '', '', '', 0, '',
    false, false
  ),
  (
    '55555555-eeee-5555-eeee-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'sluggo@test.local',
    '$2a$10$NBf4BYH3IITDY1RSlqdA6OTrYrGgO/sRhEahGrJ8DEGSgI2ivjK/.',
    NOW(),
    NOW(),
    NOW(),
    '{"provider": "email", "providers": ["email"]}',
    '{"email": "sluggo@test.local"}',
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
    '{"sub": "11111111-aaaa-1111-aaaa-111111111111", "email": "fritzi@test.local"}',
    'email',
    'fritzi@test.local',
    NOW(),
    NOW()
  ),
  (
    '22222222-bbbb-2222-bbbb-222222222222',
    '22222222-bbbb-2222-bbbb-222222222222',
    '{"sub": "22222222-bbbb-2222-bbbb-222222222222", "email": "rollo@test.local"}',
    'email',
    'rollo@test.local',
    NOW(),
    NOW()
  ),
  (
    '33333333-cccc-3333-cccc-333333333333',
    '33333333-cccc-3333-cccc-333333333333',
    '{"sub": "33333333-cccc-3333-cccc-333333333333", "email": "butch@test.local"}',
    'email',
    'butch@test.local',
    NOW(),
    NOW()
  ),
  (
    '44444444-dddd-4444-dddd-444444444444',
    '44444444-dddd-4444-dddd-444444444444',
    '{"sub": "44444444-dddd-4444-dddd-444444444444", "email": "nancy@test.local"}',
    'email',
    'nancy@test.local',
    NOW(),
    NOW()
  ),
  (
    '55555555-eeee-5555-eeee-555555555555',
    '55555555-eeee-5555-eeee-555555555555',
    '{"sub": "55555555-eeee-5555-eeee-555555555555", "email": "sluggo@test.local"}',
    'email',
    'sluggo@test.local',
    NOW(),
    NOW()
  );

-- profiles are auto-created by trigger, but let's set display names
UPDATE public.profiles SET display_name = 'Fritzi' WHERE id = '11111111-aaaa-1111-aaaa-111111111111';
UPDATE public.profiles SET display_name = 'Rollo' WHERE id = '22222222-bbbb-2222-bbbb-222222222222';
UPDATE public.profiles SET display_name = 'Butch' WHERE id = '33333333-cccc-3333-cccc-333333333333';
UPDATE public.profiles SET display_name = 'Nancy' WHERE id = '44444444-dddd-4444-dddd-444444444444';
UPDATE public.profiles SET display_name = 'Sluggo' WHERE id = '55555555-eeee-5555-eeee-555555555555';

-- test groups (fritzi creates them)
INSERT INTO public.groups (id, name, description, invite_code, created_by)
VALUES 
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'freqhole-dev', 'Development testing group', 'dev-test-invite', '11111111-aaaa-1111-aaaa-111111111111'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'music-friends', 'Share music with friends', 'music-friends-123', '11111111-aaaa-1111-aaaa-111111111111');

-- add users to groups with roles
-- fritzi is owner of both groups (as creator)
INSERT INTO public.group_members (group_id, user_id, role)
VALUES
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '11111111-aaaa-1111-aaaa-111111111111', 'owner'),
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '11111111-aaaa-1111-aaaa-111111111111', 'owner'),
  -- rollo is admin of freqhole-dev
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '22222222-bbbb-2222-bbbb-222222222222', 'admin'),
  -- butch is member of music-friends only
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '33333333-cccc-3333-cccc-333333333333', 'member'),
  -- nancy is member of freqhole-dev
  ('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', '44444444-dddd-4444-dddd-444444444444', 'member'),
  -- sluggo is member of music-friends
  ('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', '55555555-eeee-5555-eeee-555555555555', 'member');

-- test credentials for local dev:
--   fritzi@test.local / testpass123  (owner of both groups)
--   rollo@test.local / testpass123   (admin of freqhole-dev)
--   butch@test.local / testpass123   (member of music-friends)
--   nancy@test.local / testpass123   (member of freqhole-dev - has 2 node_ids!)
--   sluggo@test.local / testpass123  (member of music-friends)
--
-- invite codes:
--   dev-test-invite     (join freqhole-dev)
--   music-friends-123   (join music-friends)

-- add peer nodes for testing node_id resolution
INSERT INTO public.peers (id, user_id, group_id, node_id, last_seen)
VALUES
  -- fritzi has a node_id in freqhole-dev (rollo and nancy can resolve)
  (
    'eeeeeeee-1111-1111-1111-eeeeeeeeeeee',
    '11111111-aaaa-1111-aaaa-111111111111',  -- fritzi
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',  -- freqhole-dev group
    'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    NOW()
  ),
  -- butch has a node_id in music-friends (rollo should NOT be able to resolve - different group)
  (
    'eeeeeeee-2222-2222-2222-eeeeeeeeeeee',
    '33333333-cccc-3333-cccc-333333333333',  -- butch
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',  -- music-friends group
    'cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333',
    NOW()
  ),
  -- nancy has TWO node_ids (laptop + desktop) in freqhole-dev
  (
    'eeeeeeee-3333-3333-3333-eeeeeeeeeeee',
    '44444444-dddd-4444-dddd-444444444444',  -- nancy
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',  -- freqhole-dev group
    'dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444',
    NOW()
  ),
  (
    'eeeeeeee-4444-4444-4444-eeeeeeeeeeee',
    '44444444-dddd-4444-dddd-444444444444',  -- nancy (second device)
    'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',  -- freqhole-dev group
    'dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555',
    NOW()
  ),
  -- sluggo has a node_id in music-friends
  (
    'eeeeeeee-5555-5555-5555-eeeeeeeeeeee',
    '55555555-eeee-5555-eeee-555555555555',  -- sluggo
    'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',  -- music-friends group
    'eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555',
    NOW()
  );

-- test node_ids for resolution testing:
--   fritzi: aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111 (freqhole-dev)
--   butch:  cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333 (music-friends)
--   nancy:  dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444 (freqhole-dev, device 1)
--           dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555dddd5555 (freqhole-dev, device 2)
--   sluggo: eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555eeee5555 (music-friends)
--
-- group membership:
--   freqhole-dev:  fritzi (owner), rollo (admin), nancy (member)
--   music-friends: fritzi (owner), butch (member), sluggo (member)
--
-- resolution tests:
--   as rollo: can resolve fritzi, nancy (same group: freqhole-dev)
--             cannot resolve butch, sluggo (different group: music-friends)
--   as sluggo: can resolve fritzi, butch (same group: music-friends)
--              cannot resolve rollo, nancy (different group: freqhole-dev)
