#!/usr/bin/env bash
# Screenshot a page with headless Chrome: $CHROME_PATH or /usr/bin/google-chrome
# in a cloud session, Google Chrome's app bundle on macOS.
#   scripts/screenshot.sh <url> <out.png> [--cookie token=<jwt>] [--width 1280]
#                         [--height 900] [--wait 300] [--until-gone css] [--dark]
# Page errors (exceptions, console.error) are printed to stderr.
exec node "$(dirname "$0")/screenshot.js" "$@"
