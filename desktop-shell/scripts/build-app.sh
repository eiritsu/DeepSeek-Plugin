#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SHELL_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SHELL_ROOT/.." && pwd)
DEFAULT_SOURCE_ROOT="$PLUGIN_ROOT/../DeepSeek Harness"
SOURCE_ROOT=${DSH_SOURCE_DIR:-$DEFAULT_SOURCE_ROOT}
SOURCE_ROOT=$(CDPATH= cd -- "$SOURCE_ROOT" && pwd)
OUTPUT_ROOT="$SHELL_ROOT/dist"
APP_ROOT="$OUTPUT_ROOT/DeepSeek Harness.app"
ICON_SOURCE="$SHELL_ROOT/Resources/AppIcon.svg"
ICON_WORK=$(mktemp -d)
SNAPSHOT_WORK=""
copy_tracked_files() {
  ROOT=$1
  DESTINATION=$2
  shift 2
  (
    cd "$ROOT"
    git ls-files --cached -z -- "$@" \
      | LC_ALL=C sort -z \
      | COPYFILE_DISABLE=1 /usr/bin/tar --null -cf - -T -
  ) | COPYFILE_DISABLE=1 /usr/bin/tar -xf - -C "$DESTINATION"
}
cleanup() {
  rm -rf "$ICON_WORK"
  if [ -n "$SNAPSHOT_WORK" ]; then rm -rf "$SNAPSHOT_WORK"; fi
}
trap cleanup EXIT

if [ ! -f "$SOURCE_ROOT/apps/cli/package.json" ]; then
  echo "build-app: DSH source not found at $SOURCE_ROOT; set DSH_SOURCE_DIR" >&2
  exit 1
fi

DISTRIBUTION=false
if [ "${1:-}" = "--distribution" ]; then
  DISTRIBUTION=true
elif [ "$#" -ne 0 ]; then
  echo "usage: $0 [--distribution]" >&2
  exit 2
fi

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "build-app: rsvg-convert is required (brew install librsvg)" >&2
  exit 1
fi

swift build --package-path "$SHELL_ROOT" -c release

rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS" "$APP_ROOT/Contents/Resources"
cp "$SHELL_ROOT/.build/release/DeepSeekHarnessDesktop" "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"
/usr/bin/strip -S "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"
cp "$SHELL_ROOT/Resources/Info.plist" "$APP_ROOT/Contents/Info.plist"
if [ "$DISTRIBUTION" = true ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ai.deepseek.harness.desktop" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Delete :DSHSourceRoot" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :DSHSourceRepository https://github.com/eiritsu/DeepSeek-Harness-Desktop.git" "$APP_ROOT/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :DSHSourceBranch main" "$APP_ROOT/Contents/Info.plist"
  SNAPSHOT_WORK=$(mktemp -d)
  SNAPSHOT_ROOT="$SNAPSHOT_WORK/source"
  mkdir -p "$SNAPSHOT_ROOT"
  copy_tracked_files "$SOURCE_ROOT" "$SNAPSHOT_ROOT" .
  rm -rf \
    "$SNAPSHOT_ROOT/packages/client/ui-plugin-library" \
    "$SNAPSHOT_ROOT/desktop-shell"
  copy_tracked_files "$PLUGIN_ROOT" "$SNAPSHOT_ROOT" \
    packages/client/ui-plugin-library \
    desktop-shell
  copy_tracked_files "$SOURCE_ROOT" "$SNAPSHOT_ROOT" \
    packages/client/ui-plugin-library/package.json \
    packages/client/ui-plugin-library/tsconfig.json
  PLUGIN_LIBRARY_VERSION=$(node -p "require('$PLUGIN_ROOT/packages/client/ui-plugin-library/package.json').version")
  node - "$SNAPSHOT_ROOT/packages/client/ui-plugin-library/package.json" "$PLUGIN_LIBRARY_VERSION" <<'NODE'
const fs = require('node:fs')
const [manifestPath, version] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.version = version
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
NODE
  git -C "$SNAPSHOT_ROOT" init -q -b main
  git -C "$SNAPSHOT_ROOT" remote add origin https://github.com/eiritsu/DeepSeek-Harness-Desktop.git
  git -C "$SNAPSHOT_ROOT" add -A
  git -C "$SNAPSHOT_ROOT" \
    -c user.name='DeepSeek Harness Builder' \
    -c user.email='build@localhost' \
    commit -q -m 'Bundled source snapshot'
  COPYFILE_DISABLE=1 /usr/bin/tar -czf \
    "$APP_ROOT/Contents/Resources/SourceBootstrap.tar.gz" \
    -C "$SNAPSHOT_ROOT" .
else
  /usr/libexec/PlistBuddy -c "Set :DSHSourceRoot $SOURCE_ROOT" "$APP_ROOT/Contents/Info.plist"
fi
# Launch Services caches icons by bundle id and build number. Give every local
# build a fresh numeric version so replacing the App refreshes its icon too.
BUILD_NUMBER=$(date -u +%Y%m%d%H%M%S)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$APP_ROOT/Contents/Info.plist"
chmod 755 "$APP_ROOT/Contents/MacOS/DeepSeekHarnessDesktop"

ICON_MASTER="$ICON_WORK/AppIcon.png"
# Quick Look flattens SVG thumbnails onto an opaque white square. Render with
# librsvg so the transparent canvas around the macOS-style rounded plate stays
# transparent all the way into the generated ICNS representations.
rsvg-convert --width 1024 --height 1024 --output "$ICON_MASTER" "$ICON_SOURCE"
ICONSET="$ICON_WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for SPEC in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  SIZE=${SPEC%% *}
  NAME=${SPEC#* }
  sips -z "$SIZE" "$SIZE" "$ICON_MASTER" --out "$ICONSET/$NAME" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP_ROOT/Contents/Resources/AppIcon.icns"
codesign --force --sign - --timestamp=none "$APP_ROOT"

echo "$APP_ROOT"
