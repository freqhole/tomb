#!/bin/bash
# demo script for ruhroh prototype
# run this to set up a quick 2-client demo

set -e

CENTRAL_URL="http://localhost:3000"

echo "=== ruhroh demo ==="
echo ""

# check if central is running
if ! curl -s "$CENTRAL_URL" > /dev/null 2>&1; then
    echo "error: central server not running"
    echo "start it with: cargo run --bin ruhroh-central"
    exit 1
fi

echo "central server is running at $CENTRAL_URL"
echo ""

# create two invite codes
echo "creating invite codes..."
ALICE_INVITE=$(curl -s -X POST "$CENTRAL_URL/api/admin/invites" \
    -H "Content-Type: application/json" \
    -d '{"label": "alice"}' | jq -r '.code')

BOB_INVITE=$(curl -s -X POST "$CENTRAL_URL/api/admin/invites" \
    -H "Content-Type: application/json" \
    -d '{"label": "bob"}' | jq -r '.code')

echo "  alice invite: $ALICE_INVITE"
echo "  bob invite: $BOB_INVITE"
echo ""

# clean up old data
rm -rf ./demo-alice ./demo-bob

# register alice
echo "registering alice..."
cargo run --quiet --bin ruhroh-client -- \
    --data-dir ./demo-alice \
    --central-url "$CENTRAL_URL" \
    register "$ALICE_INVITE" "alice"

# get alice's api key
ALICE_API_KEY=$(jq -r '.api_key' ./demo-alice/config.json)
echo "  alice api_key: ${ALICE_API_KEY:0:20}..."
echo ""

# register bob
echo "registering bob..."
cargo run --quiet --bin ruhroh-client -- \
    --data-dir ./demo-bob \
    --central-url "$CENTRAL_URL" \
    register "$BOB_INVITE" "bob"

BOB_API_KEY=$(jq -r '.api_key' ./demo-bob/config.json)
echo "  bob api_key: ${BOB_API_KEY:0:20}..."
echo ""

# create a group (as alice)
echo "creating group 'music-lovers' (as alice)..."
GROUP_RESPONSE=$(curl -s -X POST "$CENTRAL_URL/api/groups" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ALICE_API_KEY" \
    -d '{"name": "music-lovers"}')
GROUP_ID=$(echo "$GROUP_RESPONSE" | jq -r '.group_id')
echo "  group_id: $GROUP_ID"
echo ""

# bob joins the group
echo "bob joining group..."
cargo run --quiet --bin ruhroh-client -- \
    --data-dir ./demo-bob \
    --central-url "$CENTRAL_URL" \
    join "$GROUP_ID"
echo ""

# show alice's peers
echo "alice's peers:"
cargo run --quiet --bin ruhroh-client -- \
    --data-dir ./demo-alice \
    --central-url "$CENTRAL_URL" \
    peers
echo ""

echo "=== setup complete! ==="
echo ""
echo "now open two terminals and run:"
echo ""
echo "  terminal 1 (alice):"
echo "    cargo run --bin ruhroh-client -- --data-dir ./demo-alice chat"
echo ""
echo "  terminal 2 (bob):"
echo "    cargo run --bin ruhroh-client -- --data-dir ./demo-bob chat"
echo ""
echo "then type messages to chat!"
