#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/build-macos.sh
destination="$HOME/Applications/Codex Quiet Startup.app"
mkdir -p "$HOME/Applications"
if [[ -e "$destination" ]]; then
  identifier=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist")
  [[ "$identifier" == local.aemeath.startup ]] || { echo "Refusing to replace a different application" >&2; exit 1; }
  mv "$destination" "${destination%.app}.backup-$(date +%Y%m%d-%H%M%S).app"
fi
ditto 'dist/Aemeath Startup.app' "$destination"
/usr/libexec/PlistBuddy -c 'Add :QuietStartupLaunchByDefault bool true' "$destination/Contents/Info.plist"
codesign --force --sign - "$destination"
codesign --verify --deep --strict "$destination"
printf 'Installed: %s\nDouble-click to play and launch Codex. Use --preview or --settings for configuration.\n' "$destination"
