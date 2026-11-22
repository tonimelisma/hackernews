#!/usr/bin/env bash
# Screenshot a page with headless Chrome: $CHROME_PATH or /usr/bin/google-chrome
# in a cloud session, the Mac's Google Chrome locally.
#   scripts/screenshot.sh <url> <out.png> [--cookie token=<jwt>] [--width 1280]
#                         [--height 900] [--wait 300] [--until-gone css] [--dark]
# Page errors (exceptions, console.error) are printed to stderr.
exec node "$(dirname "$0")/screenshot.js" "$@"
