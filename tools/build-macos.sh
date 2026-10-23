#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == "Darwin" ]] || { echo "Build requires macOS 13+ and Xcode Command Line Tools" >&2; exit 1; }
bundle="dist/Aemeath Startup.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/web/assets" .build/module-cache
swiftc -O -module-cache-path .build/module-cache Native/App.swift -o "$bundle/Contents/MacOS/AemeathStartup" -framework AppKit -framework WebKit
cp index.html style.css animation.js image-settings.js "$bundle/Contents/Resources/web/"
cp assets/character.png "$bundle/Contents/Resources/web/assets/"
rm -f "$bundle/Contents/Resources/web/character-rig.js" "$bundle/Contents/Resources/web/assets/character-rig.png" "$bundle/Contents/Resources/web/assets/character-blink.png" "$bundle/Contents/Resources/web/assets/character-hand.png" "$bundle/Contents/Resources/web/assets/character-motion.png" "$bundle/Contents/Resources/web/assets/aemeath.png" "$bundle/Contents/Resources/web/assets/avatar.png"
cat > "$bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>AemeathStartup</string>
<key>CFBundleIdentifier</key><string>local.aemeath.startup</string>
<key>CFBundleName</key><string>Codex Quiet Startup</string>
<key>CFBundleDisplayName</key><string>Codex Quiet Startup</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.2.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$bundle"
printf 'Built: %s\n' "$PWD/$bundle"
