#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUTPUT_ROOT="$SHELL_ROOT/dist"
APP_ROOT="$OUTPUT_ROOT/DeepSeek Harness.app"
DMG_PATH="$OUTPUT_ROOT/DeepSeek-Harness-macOS.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

"$SCRIPT_DIR/build-app.sh" --distribution
codesign --verify --deep --strict "$APP_ROOT"

if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_ROOT/Contents/Info.plist")" != "ai.deepseek.harness.desktop" ]; then
  echo "package-dmg: distribution app uses the development bundle identifier" >&2
  exit 1
fi
if /usr/libexec/PlistBuddy -c 'Print :DSHSourceRoot' "$APP_ROOT/Contents/Info.plist" >/dev/null 2>&1; then
  echo "package-dmg: distribution app contains DSHSourceRoot" >&2
  exit 1
fi
if strings "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop" | grep -F "$HOME" >/dev/null; then
  echo "package-dmg: executable contains the builder home path" >&2
  exit 1
fi
if [ ! -f "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" ]; then
  echo "package-dmg: bundled source snapshot is missing" >&2
  exit 1
fi

ditto "$APP_ROOT" "$STAGE/DeepSeek Harness.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "DeepSeek Harness" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "$DMG_PATH"
