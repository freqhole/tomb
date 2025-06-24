#!/bin/bash

# Simple audio waveform generator test
# Usage: ./audio-waveform-test.sh input.mp3

if [ $# -eq 0 ]; then
    echo "Usage: $0 <audio_file>"
    echo "Example: $0 song.mp3"
    exit 1
fi

INPUT_FILE="$1"
OUTPUT_DIR="waveform_tests"
BASE_NAME=$(basename "$INPUT_FILE" | cut -d. -f1)

# Create test output directory
mkdir -p "$OUTPUT_DIR"

echo "Generating waveform variations for: $INPUT_FILE"

# Test 1: Square 300x300 (current plan)
echo "1. Square 300x300..."
ffmpeg -i "$INPUT_FILE" -filter_complex "showwavespic=s=300x300:colors=blue" -frames:v 1 -f webp -y "$OUTPUT_DIR/${BASE_NAME}_square_300x300.webp" 2>/dev/null

# Test 2: Wide rectangle 400x150 (more natural for waveforms)
echo "2. Wide 400x150..."
ffmpeg -i "$INPUT_FILE" -filter_complex "showwavespic=s=400x150:colors=blue" -frames:v 1 -f webp -y "$OUTPUT_DIR/${BASE_NAME}_wide_400x150.webp" 2>/dev/null

# Test 3: Very wide 500x100 (classic waveform shape)
echo "3. Very wide 500x100..."
ffmpeg -i "$INPUT_FILE" -filter_complex "showwavespic=s=500x100:colors=blue" -frames:v 1 -f webp -y "$OUTPUT_DIR/${BASE_NAME}_vwide_500x100.webp" 2>/dev/null

# Test 4: Different colors
echo "4. Different colors 400x150..."
ffmpeg -i "$INPUT_FILE" -filter_complex "showwavespic=s=400x150:colors=green" -frames:v 1 -f webp -y "$OUTPUT_DIR/${BASE_NAME}_green_400x150.webp" 2>/dev/null
ffmpeg -i "$INPUT_FILE" -filter_complex "showwavespic=s=400x150:colors=white" -frames:v 1 -f webp -y "$OUTPUT_DIR/${BASE_NAME}_white_400x150.webp" 2>/dev/null

echo ""
echo "✓ Generated waveform tests in: $OUTPUT_DIR/"
echo "Files created:"
ls -lh "$OUTPUT_DIR"/${BASE_NAME}_*.webp

echo ""
echo "Open the files to compare:"
echo "- Square: ${BASE_NAME}_square_300x300.webp"
echo "- Wide: ${BASE_NAME}_wide_400x150.webp"
echo "- Very wide: ${BASE_NAME}_vwide_500x100.webp"
echo ""
echo "Recommendation: Wide formats usually look better for audio waveforms!"
