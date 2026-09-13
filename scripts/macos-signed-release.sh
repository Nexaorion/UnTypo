#!/usr/bin/env bash
# Sign, notarize, staple, and Gatekeeper-check the macOS arm64 DMG and ZIP.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

: "${MACOS_CODESIGN_IDENTITY:?MACOS_CODESIGN_IDENTITY is required}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH is required}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is required}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is required}"

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "App Store Connect API key is missing: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

if [[ "$MACOS_CODESIGN_IDENTITY" != *"($APPLE_TEAM_ID)" ]]; then
  echo "Signing identity '$MACOS_CODESIGN_IDENTITY' does not match APPLE_TEAM_ID $APPLE_TEAM_ID" >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/untypo-macos-release.XXXXXX")"
cleanup() {
  if [[ -n "${dmg_mount:-}" ]]; then
    hdiutil detach "$dmg_mount" -quiet || true
  fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

sign_config="$tmp_dir/electron-builder.sign.json"
python3 - "$sign_config" <<'PY'
import json
import os
import sys

path = sys.argv[1]
with open(path, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "mac": {
                "forceCodeSigning": True,
                "identity": os.environ["MACOS_CODESIGN_IDENTITY"],
            },
            "dmg": {"sign": True},
        },
        handle,
    )
    handle.write("\n")
PY

builder=(./node_modules/.bin/electron-builder --config electron-builder.yml --config "$sign_config")
builder_env=(
  CSC_IDENTITY_AUTO_DISCOVERY=true
  CSC_NAME="$MACOS_CODESIGN_IDENTITY"
)
if [[ -n "${CSC_KEYCHAIN:-}" ]]; then
  builder_env+=(CSC_KEYCHAIN="$CSC_KEYCHAIN")
fi

env "${builder_env[@]}" "${builder[@]}" --mac dir --arm64 --publish never

app="$(find release -maxdepth 3 -type d -name 'UnTypo.app' -print -quit)"
if [[ -z "$app" ]]; then
  echo "UnTypo.app was not produced in release/" >&2
  exit 1
fi
app_dir="$(cd "$(dirname "$app")" && pwd)"
app="$app_dir/UnTypo.app"
helper="$app/Contents/Resources/bin/untypo_native_helper"

codesign --verify --deep --strict --verbose=4 "$app"
if [[ -f "$helper" ]]; then
  codesign --verify --strict --verbose=4 "$helper"
else
  echo "Native helper is missing from the signed app: $helper" >&2
  exit 1
fi

identity_team="$(codesign -dv --verbose=4 "$app" 2>&1 | awk -F= '/^TeamIdentifier=/{print $2; exit}')"
if [[ "$identity_team" != "$APPLE_TEAM_ID" ]]; then
  echo "Signed app team '$identity_team' does not match APPLE_TEAM_ID $APPLE_TEAM_ID" >&2
  exit 1
fi

env "${builder_env[@]}" "${builder[@]}" \
  --mac dmg zip \
  --arm64 \
  --prepackaged "$app_dir" \
  --publish never

version="$(node -p "require('./package.json').version")"
dmg="release/UnTypo-${version}-mac-arm64.dmg"
zip="release/UnTypo-${version}-mac-arm64.zip"
if [[ ! -f "$dmg" || ! -f "$zip" ]]; then
  echo "Expected $dmg and $zip" >&2
  ls -la release >&2 || true
  exit 1
fi

submit_json="$(
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --no-s3-acceleration \
    --wait \
    --timeout 1h \
    --output-format json
)"
status="$(printf '%s' "$submit_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')"
if [[ "$status" != Accepted ]]; then
  echo "Apple notarization failed with status '$status'" >&2
  printf '%s\n' "$submit_json" >&2
  submission_id="$(printf '%s' "$submit_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')"
  if [[ -n "$submission_id" ]]; then
    xcrun notarytool log "$submission_id" \
      --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY_ID" \
      --issuer "$APPLE_API_ISSUER" >&2 || true
  fi
  exit 1
fi

xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
codesign --verify --verbose=4 "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"

dmg_mount="$tmp_dir/dmg"
mkdir -p "$dmg_mount"
hdiutil attach -nobrowse -readonly -mountpoint "$dmg_mount" "$dmg"
spctl --assess --type execute --verbose=4 "$dmg_mount/UnTypo.app"
hdiutil detach "$dmg_mount" -quiet
dmg_mount=""

printf 'Signed and notarized %s and %s\n' "$dmg" "$zip"
