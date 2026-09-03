#!/system/bin/sh
# pulse-install — service.sh
#
# Runs once when Shevery starts this module's session (e.g. on boot). Scans
# AUTO_DIR for .apk/.apks/.xapk/.apkm files and installs each one using the
# same session-streaming approach the WebUI uses (pm install-create ->
# install-write -S <size> - -> install-commit), which is what avoids the
# system_server FUSE-read restriction on /sdcard paths.
#
# This is NOT a persistent watcher — it's a one-shot scan on session start,
# same reasoning as every other service.sh in this project: a long-lived
# shell loop is the kind of thing that hangs, drains battery, and has no
# guaranteed survival across Doze. Drop files in AUTO_DIR whenever, they get
# picked up next session start, or on demand via the WebUI's
# "Scan auto-install folder now" button, which runs the equivalent logic
# in JS.
#
# Successfully installed files are moved to AUTO_DIR/installed/ so they are
# never installed twice. Every attempt is logged to LOG_FILE.

DIR="$(cd "$(dirname "$0")" && pwd)"
. "$DIR/lib.sh"

AUTO_DIR="/sdcard/pulse-install/auto"
DONE_DIR="$AUTO_DIR/installed"
AUTO_LOG="/data/local/tmp/.pulse-install-auto.log"
WORK_ROOT="/data/local/tmp/.pulse-install-auto-work"

mkdir -p "$AUTO_DIR" "$DONE_DIR"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$AUTO_LOG" 2>/dev/null
}

# Streams one or more APK paths into a single install session.
# Usage: stream_install "$apk1" ["$apk2" ...]
stream_install() {
  create_out="$(pm install-create -r 2>&1)"
  session="$(printf '%s' "$create_out" | sed -n 's/.*\[\([0-9][0-9]*\)\].*/\1/p')"
  if [ -z "$session" ]; then
    echo "create failed: $create_out"
    return 1
  fi

  i=0
  for apk in "$@"; do
    sz="$(stat -c%s "$apk" 2>/dev/null)"
    if [ -z "$sz" ]; then
      pm install-abandon "$session" >/dev/null 2>&1
      echo "stat failed: $apk"
      return 1
    fi
    if ! cat "$apk" | pm install-write -S "$sz" "$session" "split$i" - >/dev/null 2>&1; then
      pm install-abandon "$session" >/dev/null 2>&1
      echo "write failed: $apk"
      return 1
    fi
    i=$((i + 1))
  done

  commit_out="$(pm install-commit "$session" 2>&1)"
  case "$commit_out" in
    Success*) return 0 ;;
    *) echo "commit failed: $commit_out"; return 1 ;;
  esac
}

install_one() {
  file="$1"
  name="$(basename "$file")"
  lower="$(printf '%s' "$name" | tr 'A-Z' 'a-z')"

  case "$lower" in
    *.apk)
      stream_install "$file"
      return $?
      ;;
    *.apks|*.xapk|*.apkm)
      if ! command -v unzip >/dev/null 2>&1; then
        echo "unzip not available"
        return 1
      fi
      work="$WORK_ROOT/$$-$(date +%s)"
      mkdir -p "$work"
      unzip -o -q "$file" -d "$work" >/dev/null 2>&1
      universal="$(find "$work" -iname "universal.apk" | head -n1)"
      if [ -n "$universal" ]; then
        stream_install "$universal"
        rc=$?
      else
        apks="$(find "$work" -iname "*.apk")"
        if [ -z "$apks" ]; then
          rm -rf "$work"
          echo "no .apk found inside bundle"
          return 1
        fi
        stream_install $apks
        rc=$?
      fi
      rm -rf "$work"
      return $rc
      ;;
    *)
      return 2 # not a supported extension, not an error
      ;;
  esac
}

find "$AUTO_DIR" -maxdepth 1 -type f \( -iname "*.apk" -o -iname "*.apks" -o -iname "*.xapk" -o -iname "*.apkm" \) 2>/dev/null > "$WORK_ROOT.list" || true

if [ -s "$WORK_ROOT.list" ]; then
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    name="$(basename "$file")"
    if err="$(install_one "$file" 2>&1)"; then
      mv "$file" "$DONE_DIR/$name"
      log "OK $name"
    else
      log "FAIL $name: $err"
    fi
  done < "$WORK_ROOT.list"
fi
rm -f "$WORK_ROOT.list"
