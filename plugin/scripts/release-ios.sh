#!/usr/bin/env bash
# ─── iOS Release Script ───────────────────────────────────────────────
# Bumps the iOS version, rebuilds main.js, commits, and pushes to
# release/ios so BRAT picks up the update.
#
# Usage:
#   ./scripts/release-ios.sh          # auto bump ios.NN (default)
#   ./scripts/release-ios.sh patch    # Same as default
#   ./scripts/release-ios.sh 1.1.7-ios.0  # Explicit version
#
# Run from plugin/ directory.
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,13p' "$0"
  exit 0
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$PLUGIN/.." && pwd)"
BRANCH="release/ios"

cd "$PLUGIN"

# ── 1. Read current version ──────────────────────────────────────────
MANIFEST="$PLUGIN/manifest.json"
VERSIONS="$PLUGIN/versions.json"

current_ver="$(jq -r '.version' "$MANIFEST")"
echo "Current version: $current_ver"

# ── 2. Determine new version ─────────────────────────────────────────
if [[ $# -ge 1 && "$1" != "patch" ]]; then
  new_ver="$1"
else
  base="${current_ver%-ios.*}"
  rev="${current_ver#*-ios.}"
  new_rev=$(( rev + 1 ))
  new_ver="${base}-ios.${new_rev}"
fi

echo "New version:     $new_ver"

# Validate version format
if ! echo "$new_ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+-ios\.[0-9]+$'; then
  echo "ERROR: Invalid version format '$new_ver' — expected X.Y.Z-ios.N"
  exit 1
fi

# ── 3. Update files ──────────────────────────────────────────────────
jq --arg v "$new_ver" '.version = $v' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"
jq --arg v "$new_ver" \
   --arg mv "$(jq -r '.minAppVersion' "$MANIFEST")" \
   '. + {($v): $mv}' "$VERSIONS" > "$VERSIONS.tmp" && mv "$VERSIONS.tmp" "$VERSIONS"

# ── 4. Build iOS main.js ─────────────────────────────────────────────
echo ""
echo "── Building iOS main.js ──"
node esbuild.ios.mjs production

# ── 5. Verify build ──────────────────────────────────────────────────
if ! grep -q 'check-llm-status\|send-last-chat-section\|cancel-current-chat' "$PLUGIN/main.js"; then
  echo "ERROR: iOS main.js is missing chat command symbols — build may be broken."
  exit 1
fi
echo "✓ iOS main.js built and verified."

# ── 6. Commit & push ─────────────────────────────────────────────────
echo ""
echo "── Committing and pushing to $BRANCH ──"
cd "$REPO"
git add "$PLUGIN/manifest.json" "$PLUGIN/versions.json" "$PLUGIN/main.js"
git commit -m "chore: bump version to $new_ver"
git push origin "$BRANCH"

echo ""
echo "✓ Released $new_ver → pushed to $BRANCH"
echo "  BRAT will pick it up on next update check."
