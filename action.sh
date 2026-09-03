#!/system/bin/sh
# pulse-install — Action button summary. Read-only: prints current state.

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib.sh"

if command -v unzip >/dev/null 2>&1; then
  unzip_label="available"
else
  unzip_label="MISSING — APKS/XAPK/APKM extraction will not work, plain APK install still fine"
fi

if [ -f "$HISTORY_FILE" ]; then
  install_count="$(grep -o '"file"' "$HISTORY_FILE" 2>/dev/null | grep -c .)"
else
  install_count=0
fi

echo "unzip: $unzip_label"
echo "Installs logged: $install_count"
