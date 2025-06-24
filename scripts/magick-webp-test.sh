#! /bin/sh

# High quality (90)
convert input.jpg -resize 300x300 -quality 90 -format webp output_high.webp

# Medium quality (70) 
convert input.jpg -resize 300x300 -quality 70 -format webp output_medium.webp

# Low quality (50)
convert input.jpg -resize 300x300 -quality 50 -format webp output_low.webp

