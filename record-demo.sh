#!/bin/bash
# Record a demo GIF for the README
#
# How to use:
# 1. Run: bash record-demo.sh
# 2. It starts recording your terminal
# 3. Do this in the recording:
#    - Type: claude
#    - Wait for it to start
#    - Type: load soul context
#    - Wait for it to load (shows frameworks, identity, state)
#    - Type: what frameworks are active?
#    - Wait for the response
#    - Type: exit
# 4. Press Ctrl+D or type 'exit' to stop recording
# 5. The script converts it to demo.gif automatically
#
# Tips:
# - Keep it under 30 seconds
# - Let each response fully render before typing next
# - The GIF will be ~900px wide

echo "=== Starting terminal recording ==="
echo "Do your demo, then press Ctrl+D or type 'exit' when done."
echo ""

asciinema rec /tmp/demo.cast --cols 100 --rows 25

echo ""
echo "=== Converting to GIF ==="

agg /tmp/demo.cast demo.gif --theme monokai --font-size 14

echo "=== Done! demo.gif created ==="
echo "Now commit and push it."
