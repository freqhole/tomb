#!/usr/bin/env bash

# Usage: ./youtube_music_guess.sh VIDEO_ID
# Example: ./youtube_music_guess.sh dQw4w9WgXcQ

video_id="$1"

if [[ -z "$video_id" ]]; then
  echo "Usage: $0 <youtube_video_id>"
  exit 1
fi

json=$(yt-dlp -j --no-playlist "https://www.youtube.com/watch?v=${video_id}")

# Extract raw fields
title=$(jq -r '.title' <<< "$json")
uploader=$(jq -r '.uploader' <<< "$json")
track=$(jq -r '.track // empty' <<< "$json")
artist=$(jq -r '.artist // empty' <<< "$json")
album=$(jq -r '.album // empty' <<< "$json")
tags=$(jq -r '.tags // empty | join(", ")' <<< "$json")

# Heuristic fallback: parse title like "Artist - Song Title"
if [[ -z "$track" && "$title" == *" - "* ]]; then
  artist_guess="${title%% - *}"
  title_guess="${title#* - }"
else
  artist_guess="$artist"
  title_guess="$track"
fi

# Clean up common junk
title_guess=$(sed -E 's/\[.*\]|\(.*\)|\"//g' <<< "$title_guess" | xargs)
artist_guess=$(sed -E 's/\[.*\]|\(.*\)|\"//g' <<< "$artist_guess" | xargs)
album=$(sed -E 's/\[.*\]|\(.*\)|\"//g' <<< "$album" | xargs)

# Final fallback if everything is missing
[[ -z "$artist_guess" ]] && artist_guess="$uploader"
[[ -z "$title_guess" ]] && title_guess="$title"

# Output JSON
jq -n \
  --arg artist "$artist_guess" \
  --arg title "$title_guess" \
  --arg album "$album" \
  --arg uploader "$uploader" \
  --arg tags "$tags" \
  '{
    artist: $artist,
    title: $title,
    album: $album,
    uploader: $uploader,
    tags: $tags
  }'
