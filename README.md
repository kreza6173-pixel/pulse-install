# PULSE // INSTALL

**Universal APK / APKS / XAPK / APKM installer** — a Shevery ADB module.
Browse device storage, select one file or many, and install — including
proper handling of split-APK bundles and the OBB expansion files that
APKPure-style `.xapk` packages carry.

## Supported formats

| Format | What it is | How it's installed |
|---|---|---|
| `.apk` | A single package | `pm install` |
| **Split bundles** (multiple loose `.apk` files) | Base + config splits you select together, not wrapped in any container | `pm install-multiple`, when you confirm they belong to one app |
| `.apks` | Google's own bundletool split archive | Extracted; installs `universal.apk` if present, otherwise every split found |
| `.xapk` | APKPure's bundle format | Extracted; reads `manifest.json` for the exact split list and package name, copies any `.obb` files to `/sdcard/Android/obb/<pkg>/` |
| `.apkm` | APKMirror's bundle format | Extracted; reads `info.json` when present, otherwise installs every `.apk` found inside |

## Why "split bundles" get their own toggle

Selecting several loose `.apk` files is ambiguous on purpose: they might be
unrelated apps, or they might be the base + split configs of one app. This
module never guesses — when 2+ plain `.apk` files are selected, a card
appears asking you to confirm whether to combine them into one
`pm install-multiple` call. Leave it off and each file installs separately.

## Features

- 🗂 Built-in device file browser (starts at `/sdcard/Download`), no need to type full paths for everyday use.
- ☑️ Multi-select, batch install.
- 📦 Real container-format handling for APKS/XAPK/APKM — not just "rename to .zip and hope."
- 🧩 Explicit split-bundle control for loose multi-APK selections.
- 🗜 OBB expansion file placement for XAPK bundles that include them.
- ⚙️ Install flags: replace existing (`-r`), auto-grant runtime permissions (`-g`), delete
  the source file after a successful install.
- 🕒 Install history log.
- 📥 **Auto-install folder** — drop files into `/sdcard/pulse-install/auto/` and they're
  installed automatically the next time Shevery starts this module's session (e.g. on
  boot), or on demand with a button. Installed files move to that folder's `installed/`
  subfolder so nothing installs twice.
- 🌗 Light/dark theme toggle, remembered per device.
- 🦠 **VirusTotal scan** — checks a file's SHA-256 hash against VirusTotal before and/or
  after install. See below for why this is hash-lookup only, not file upload.
- 📤 **Extract an installed app** — pulls an installed package's APK (and splits) back out
  as loose files, or bundled into a real `.xapk` you can hand to this same installer (or
  any XAPK-compatible one) later.
- 🖥 Console drawer — every shell command and its raw output is visible in-app.

## VirusTotal scanning — hash lookup, not upload

The scan checks a file's SHA-256 hash against VirusTotal's database of previously-scanned
files. It works for any file size and barely touches your API quota, but it can only find a
result if someone else has already submitted this exact file before — it never uploads the
file itself.

This isn't a corner cut for convenience: the files live on the device's filesystem and are
only ever accessed through shell paths, not as in-browser File objects. Getting a 40–90MB
APK's actual bytes into the WebUI to upload it would mean routing them through
`window.Shizuku.exec()`, and that bridge call has to fit in a single Android Binder
transaction — capped around 1MB. A real APK doesn't fit. Rather than silently truncating or
failing on large files, this module doesn't attempt upload at all; if a hash comes back
unknown, it says so plainly and links to VirusTotal's own upload page for a manual first
scan.

## The generated .xapk isn't APKPure's exact format — it's a compatible one

Extracting to `.xapk` produces a real ZIP containing the APKs plus a `manifest.json` with
`package_name`, `version_name`/`version_code`, and a `split_apks` list — enough for this
module's own installer (and most other XAPK-aware installers) to read correctly. It's not a
byte-for-byte reconstruction of what APKPure's own generator produces — no permissions list,
icon, or the extra metadata their build includes. If `zip` isn't available on the device, the
same files are left as loose APKs plus `manifest.json` in a folder instead of failing outright.

## Requirements

- [Shevery](https://github.com/HmnDev-Tech/shevery), access mode **Full** (or **Custom**
  with "WebUI shell bridge" enabled).
- No root needed.
- `unzip` on the device's `PATH` for APKS/XAPK/APKM extraction — checked automatically on
  load and shown in the header. Plain `.apk` and split-bundle installs don't need it.

## Install

**From a release ZIP:** ADB Modules → Import → select the ZIP. `module.prop` sits at the
ZIP's root:

```bash
git clone https://github.com/kreza6173-pixel/pulse-install.git
cd pulse-install
zip -r ../pulse-install.zip . -x ".git/*"
```

## Architecture

```
pulse-install/
├── module.prop      # Module manifest (usesShellBridge=true)
├── lib.sh            # Shared shell path constants
├── action.sh          # Read-only summary shown on the module's Action button
├── service.sh          # Boot/session-start scan of the auto-install folder
├── webui/
│   ├── index.html        # Install / History tabs
│   ├── style.css           # PULSE design system, shared with pulse-battery
│   └── script.js             # window.Shizuku.exec() shell bridge + all UI logic
├── LICENSE
└── README.md
```

## How it works

| Step | Shell mechanism |
|---|---|
| Browse | `ls -la <path>` |
| Plain APK install | Streamed via `pm install-create` → `install-write -S <size> -` → `install-commit` |
| Split bundle install | Same streaming session, one `install-write` per split |
| Container extraction | `unzip -o -q <file> -d <workdir>` |
| Locate APKs inside | `find <workdir> -iname "*.apk"` |
| Manifest read (XAPK/APKM) | `cat <workdir>/manifest.json` or `info.json`, parsed in the WebUI (not shell) |
| OBB placement | `cp *.obb /sdcard/Android/obb/<pkg>/` when a package name is known |
| History | JSON log at `/data/local/tmp/.pulse-install-history.json` |
| Auto-install scan | `service.sh`, run at boot/session start — finds files in `/sdcard/pulse-install/auto/`, installs each with the same streaming approach, moves successes to `installed/`, logs to `/data/local/tmp/.pulse-install-auto.log` |
| VirusTotal hash lookup | `sha256sum <path>` locally, then a plain `fetch()` from the WebUI to `GET /api/v3/files/<hash>` — no shell involvement beyond hashing |
| Extract installed app | `pm path <pkg>` → `cp` each split → optional `manifest.json` + `zip -j` into a `.xapk` |

**Why streaming, not a direct path install:** `pm install <path-on-sdcard>` and
`pm install-multiple <paths...>` both hand system_server a raw file path to open
itself — and system_server frequently can't read `/sdcard`'s FUSE-mounted paths
directly (`SELinux: no access to read file context u:object_r:fuse:s0`). Every
install here goes through `pm install-create` → `pm install-write -S <size> -`
(the file's bytes piped in via `cat`, not a path) → `pm install-commit`, which
sidesteps that restriction entirely since the shell — not system_server — is
the one reading the file.

**Resolution order inside a container:** a `universal.apk` wins if present (always installable
regardless of device config); otherwise the manifest's split list is used, resolved against
what was actually extracted; if neither applies — or the manifest lists files that aren't
actually in the archive — every `.apk` found gets installed together as a best-effort fallback,
rather than silently installing nothing.

## Known limitations

- **`.apks` support is inherently partial.** Google's bundletool format is designed to be
  processed by `bundletool` on a PC with real device-spec matching (ABI, screen density,
  language) to pick the exact right splits. This module can't replicate that on-device — it
  installs `universal.apk` when the bundle includes one (common for sideloading-friendly
  exports), and falls back to installing every split otherwise, which may not always be the
  correct combination for a given device.
- **`unzip` isn't guaranteed present** on every ROM. This is checked on load; if missing,
  container formats can't be extracted here — extract on a PC and install the resulting
  `.apk` files as a split bundle instead.
- **OBB placement only happens when a package name is known**, which in practice means
  XAPK bundles with a `manifest.json`. Found-but-unplaced OBB files are still reported, with
  their extracted path, so you can move them manually.
- **`stat -c%s` (used to size each streamed file) depends on toybox's stat supporting `-c`**,
  which is standard on modern Android but, like everything else here, its real output is
  always visible in the console drawer if something about a specific ROM's `stat` differs.
- **The auto-install folder is scanned once per session start, not watched continuously.**
  Same reasoning as the rest of this project's `service.sh` scripts: a persistent background
  loop is the kind of thing that risks hanging or draining battery with no guaranteed
  survival across Doze. Use the WebUI's "Scan auto-install folder now" button for on-demand
  installs without waiting for a reboot.
- **VirusTotal free-tier API keys are rate-limited** (4 requests/minute, 500/day as of this
  writing) — scanning many files back-to-back can hit that limit; the module surfaces a
  clear "rate limit hit" message rather than silently failing when it does.

## License

MIT — see [LICENSE](LICENSE).
