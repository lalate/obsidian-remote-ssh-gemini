#!/usr/bin/env bash
# ─── iOS Release Script ───────────────────────────────────────────────
# Bumps the iOS version, rebuilds main.js, creates a GitHub Release, and
# pushes to release/ios so BRAT picks up the update.
#
# BRAT v1.1.0+ requires GitHub Releases — pushing to a branch is not
# sufficient. This script automates the full release workflow.
#
# Usage:
#   ./scripts/release-ios.sh                     # auto bump ios.NN
#   ./scripts/release-ios.sh patch               # same as default
#   ./scripts/release-ios.sh 1.1.7-ios.0         # explicit version
#
# Prerequisites:
#   - gh (GitHub CLI) authenticated with repo scope
#   - jq
#   - npm dependencies installed (esbuild)
#
# Run from plugin/ directory.
# ────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,16p' "$0"
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
STYLES="$PLUGIN/styles.css"

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

# ── 6. Commit & push to branch ───────────────────────────────────────
echo ""
echo "── Committing and pushing to $BRANCH ──"
cd "$REPO"
git add "$PLUGIN/manifest.json" "$PLUGIN/versions.json" "$PLUGIN/main.js"
git commit -m "chore: bump version to $new_ver"
git push origin "$BRANCH"

# ── 7. Build & upload Go daemon binaries ──────────────────────────────
echo ""
echo "── Building Go daemon binaries ──"
SERVER="$REPO/server"
DIST_DIR="$SERVER/dist"
rm -rf "$DIST_DIR"
make -C "$SERVER" cross 2>&1 | sed 's/^/  [make] /'

# Generate daemon-manifest.json with sha256 sums
echo "  generating daemon-manifest.json…"
MANIFEST_FILE="$DIST_DIR/daemon-manifest.json"
echo "{" > "$MANIFEST_FILE"
first=true
for f in "$DIST_DIR"/obsidian-remote-server-*; do
  name="$(basename "$f")"
  sha="$(sha256sum "$f" | cut -d' ' -f1)"
  if [ "$first" = true ]; then first=false; else echo "," >> "$MANIFEST_FILE"; fi
  printf '  "%s": "%s"' "$name" "$sha" >> "$MANIFEST_FILE"
done
echo "" >> "$MANIFEST_FILE"
echo "}" >> "$MANIFEST_FILE"
echo "✓ daemon-manifest.json generated"

echo "✓ Go binaries built in $DIST_DIR"

# ── 8. Create GitHub Release ─────────────────────────────────────────
echo ""
echo "── Creating GitHub Release $new_ver ──"
git tag "$new_ver"
git push origin "$new_ver"

# Collect all release assets
RELEASE_ASSETS=(
  "$PLUGIN/main.js"
  "$PLUGIN/manifest.json"
  "$STYLES"
  "$MANIFEST_FILE"
)
for f in "$DIST_DIR"/obsidian-remote-server-*; do
  RELEASE_ASSETS+=("$f")
done

gh release create "$new_ver" \
  --title "$new_ver" \
  --notes "iOS release $new_ver — server auto-update via WebSocket" \
  --target "$BRANCH" \
  "${RELEASE_ASSETS[@]}"

echo ""
echo "✓ Released $new_ver"
echo "  Branch: $BRANCH (commit pushed)"
echo "  Tag:    $new_ver (GitHub Release created)"
echo "  BRAT will pick it up on next update check."
echo ""
echo "  iOS test: update via BRAT, reconnect, then run 'Remote SSH: Check LLM status'"
