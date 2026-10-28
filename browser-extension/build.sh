#!/usr/bin/env bash
# Refreshes the shared detector and packages the extension for download.
#   bash browser-extension/build.sh   →  assets/downloads/site-inspector.zip
set -euo pipefail
cd "$(dirname "$0")"
{ echo '// Copy of functions/_lib/tech.js (run browser-extension/build.sh to refresh).'; cat ../functions/_lib/tech.js; } > tech.js
mkdir -p ../assets/downloads
rm -f ../assets/downloads/site-inspector.zip
zip -qr ../assets/downloads/site-inspector.zip manifest.json background.js popup.html popup.css popup.js design-check.js tech.js icons
echo "Built assets/downloads/site-inspector.zip"
