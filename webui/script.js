(() => {
  "use strict";

  const INSTALL_TMP = "/data/local/tmp/.pulse-install-work";
  const HISTORY_FILE = "/data/local/tmp/.pulse-install-history.json";

  const el = {
    bridgeWarning: document.getElementById("bridge-warning"),
    bridgeBadge: document.getElementById("bridge-badge"),
    bridgeRetryBtn: document.getElementById("bridge-retry-btn"),
    tabs: document.querySelectorAll(".tab-btn"),
    panels: document.querySelectorAll(".panel-view"),
    statSelected: document.getElementById("stat-selected"),
    statSize: document.getElementById("stat-size"),
    statUnzip: document.getElementById("stat-unzip"),
    pathInput: document.getElementById("path-input"),
    pathGoBtn: document.getElementById("path-go-btn"),
    fileList: document.getElementById("file-list"),
    splitBundleCard: document.getElementById("split-bundle-card"),
    splitBundleCheck: document.getElementById("split-bundle-check"),
    optReplace: document.getElementById("opt-replace"),
    optGrant: document.getElementById("opt-grant"),
    optDeleteAfter: document.getElementById("opt-delete-after"),
    installBtn: document.getElementById("install-btn"),
    installProgress: document.getElementById("install-progress"),
    historyList: document.getElementById("history-list"),
    historyClearBtn: document.getElementById("history-clear-btn"),
    autoScanBtn: document.getElementById("auto-scan-btn"),
    autoLogBtn: document.getElementById("auto-log-btn"),
    autoProgress: document.getElementById("auto-progress"),
    vtApiKeyInput: document.getElementById("vt-apikey-input"),
    vtKeyToggleBtn: document.getElementById("vt-key-toggle-btn"),
    vtRememberKey: document.getElementById("vt-remember-key"),
    vtScanBefore: document.getElementById("vt-scan-before"),
    vtScanAfter: document.getElementById("vt-scan-after"),
    vtProgress: document.getElementById("vt-progress"),
    scanExtractAppsBtn: document.getElementById("scan-extract-apps-btn"),
    extractAppSearch: document.getElementById("extract-app-search"),
    extractScopeUser: document.getElementById("extract-scope-user"),
    extractAppList: document.getElementById("extract-app-list"),
    extractFormat: document.getElementById("extract-format"),
    extractBtn: document.getElementById("extract-btn"),
    extractProgress: document.getElementById("extract-progress"),
    consoleDrawer: document.getElementById("console-drawer"),
    consoleToggle: document.getElementById("console-toggle"),
    consoleBody: document.getElementById("console-body"),
    consoleCount: document.getElementById("console-count"),
    confirmBackdrop: document.getElementById("confirm-backdrop"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmBody: document.getElementById("confirm-body"),
    confirmOk: document.getElementById("confirm-ok"),
    confirmCancel: document.getElementById("confirm-cancel"),
  };

  let consoleLines = 0;
  let currentPath = "/sdcard/Download";
  let entries = []; // {name, isDir, sizeBytes, format, fullPath}
  const selected = new Map(); // fullPath -> entry
  let unzipAvailable = null;

  // ---------- theme toggle (light/dark, persisted in localStorage) ----------

  (function initThemeToggle() {
    const KEY = "pulse-theme";
    const btn = document.getElementById("theme-toggle-btn");
    if (!btn) return;
    function current() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
    function apply(theme) {
      if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      btn.textContent = theme === "dark" ? "☀ light" : "☾ dark";
      try { localStorage.setItem(KEY, theme); } catch (e) { /* storage unavailable, theme just won't persist */ }
    }
    apply(current());
    btn.addEventListener("click", () => apply(current() === "dark" ? "light" : "dark"));
  })();

  // ---------- shell bridge ----------

  function bridgeAvailable() { return typeof window.Shizuku !== "undefined" && window.Shizuku !== null; }
  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

  function logConsole(text, kind) {
    consoleLines++;
    el.consoleCount.textContent = String(consoleLines);
    const line = document.createElement("div");
    line.className = "console-line" + (kind ? ` ${kind}` : "");
    line.textContent = text;
    el.consoleBody.appendChild(line);
    el.consoleBody.scrollTop = el.consoleBody.scrollHeight;
    while (el.consoleBody.children.length > 300) el.consoleBody.removeChild(el.consoleBody.firstChild);
  }

  async function exec(cmd) {
    logConsole("$ " + cmd.split("\n")[0] + (cmd.indexOf("\n") !== -1 ? " …" : ""));
    if (!bridgeAvailable()) {
      logConsole("window.Shizuku is not available.", "err");
      return { ok: false, exitCode: -1, stdout: "", stderr: "window.Shizuku is not available", timedOut: false };
    }
    let raw;
    try { raw = window.Shizuku.exec(cmd); }
    catch (e) { logConsole(String(e), "err"); return { ok: false, exitCode: -1, stdout: "", stderr: String(e), timedOut: false }; }
    let res;
    try { res = JSON.parse(raw); }
    catch (e) { logConsole("unparseable bridge response: " + String(raw).slice(0, 200), "err"); return { ok: false, exitCode: -1, stdout: "", stderr: "unparseable bridge response", timedOut: false }; }
    if (res.stdout) logConsole(res.stdout.trim(), "ok");
    if (res.stderr) logConsole(res.stderr.trim(), "err");
    return res;
  }

  async function checkBridge() {
    if (!bridgeAvailable()) {
      el.bridgeBadge.textContent = "bridge unavailable";
      el.bridgeBadge.className = "bridge-badge error";
      el.bridgeWarning.classList.remove("hidden");
      return false;
    }
    el.bridgeBadge.textContent = "connected";
    el.bridgeBadge.className = "bridge-badge ok";
    el.bridgeWarning.classList.add("hidden");
    const unzipRes = await exec("command -v unzip");
    unzipAvailable = !!(unzipRes.ok && unzipRes.stdout && unzipRes.stdout.trim());
    el.statUnzip.textContent = unzipAvailable ? "OK" : "missing";
    if (!unzipAvailable) el.statUnzip.parentElement.querySelector(".stat-num").style.color = "var(--amber)";
    return true;
  }

  // ---------- confirm modal ----------

  function confirmAction(title, body) {
    el.confirmTitle.textContent = title;
    el.confirmBody.textContent = body;
    el.confirmBackdrop.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = (r) => {
        el.confirmBackdrop.classList.add("hidden");
        el.confirmOk.removeEventListener("click", onOk);
        el.confirmCancel.removeEventListener("click", onCancel);
        resolve(r);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      el.confirmOk.addEventListener("click", onOk);
      el.confirmCancel.addEventListener("click", onCancel);
    });
  }

  // ---------- tabs ----------

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      el.tabs.forEach((t) => t.classList.remove("active"));
      el.panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
      if (tab.dataset.tab === "history") loadHistory();
    });
  });
  el.consoleToggle.addEventListener("click", () => el.consoleDrawer.classList.toggle("open"));

  // ---------- file browser ----------

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function detectFormat(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".apk")) return "apk";
    if (lower.endsWith(".apks")) return "apks";
    if (lower.endsWith(".xapk")) return "xapk";
    if (lower.endsWith(".apkm")) return "apkm";
    return null;
  }

  function parseLsLa(stdout) {
    const lines = (stdout || "").split("\n");
    const out = [];
    for (const line of lines) {
      if (!line.trim() || line.startsWith("total")) continue;
      const tokens = line.trim().split(/\s+/);
      if (tokens.length < 8) continue;
      const perms = tokens[0];
      const name = tokens.slice(7).join(" ");
      if (name === "." || name === "..") continue;
      const isDir = perms[0] === "d";
      const sizeBytes = parseInt(tokens[4], 10);
      out.push({ name, isDir, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null });
    }
    return out;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function browsePath(path) {
    currentPath = path;
    el.pathInput.value = path;
    el.fileList.innerHTML = `<div class="empty-state">Loading…</div>`;
    const res = await exec(`ls -la ${shq(path)} 2>&1`);
    const parsed = parseLsLa(res.stdout);
    entries = parsed.map((e) => ({ ...e, format: e.isDir ? null : detectFormat(e.name), fullPath: path.replace(/\/+$/, "") + "/" + e.name }));
    renderFileList();
  }

  function renderFileList() {
    const rows = [];
    if (currentPath !== "/") {
      const parent = currentPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
      rows.push(`<div class="item-row" data-nav="${escapeHtml(parent)}" style="cursor:pointer;"><span class="item-name">.. (up)</span></div>`);
    }
    const dirs = entries.filter((e) => e.isDir);
    const files = entries.filter((e) => !e.isDir);
    dirs.forEach((e) => rows.push(`<div class="item-row" data-nav="${escapeHtml(e.fullPath)}" style="cursor:pointer;"><span class="item-name">📁 ${escapeHtml(e.name)}</span></div>`));
    files.forEach((e) => {
      const installable = !!e.format;
      rows.push(`
        <div class="item-row" data-path="${escapeHtml(e.fullPath)}">
          <div class="item-main">
            <span class="item-name">${escapeHtml(e.name)}</span>
            <span class="item-sub">${formatSize(e.sizeBytes)}${e.format ? ` · <span class="badge ok">${e.format}</span>` : ""}</span>
          </div>
          ${installable ? `<input type="checkbox" ${selected.has(e.fullPath) ? "checked" : ""}>` : ""}
        </div>
      `);
    });
    el.fileList.innerHTML = rows.join("") || `<div class="empty-state">Empty directory.</div>`;

    el.fileList.querySelectorAll("[data-nav]").forEach((row) => {
      row.addEventListener("click", () => browsePath(row.dataset.nav));
    });
    el.fileList.querySelectorAll("[data-path]").forEach((row) => {
      const checkbox = row.querySelector("input[type=checkbox]");
      if (!checkbox) return;
      const toggle = () => {
        const path = row.dataset.path;
        const entry = entries.find((e) => e.fullPath === path);
        if (selected.has(path)) selected.delete(path); else selected.set(path, entry);
        checkbox.checked = selected.has(path);
        updateSelectionUi();
      };
      row.addEventListener("click", (e) => { if (e.target !== checkbox) toggle(); });
      checkbox.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    });
  }

  el.pathGoBtn.addEventListener("click", () => browsePath(el.pathInput.value.trim() || "/sdcard"));
  el.pathInput.addEventListener("keydown", (e) => { if (e.key === "Enter") browsePath(el.pathInput.value.trim() || "/sdcard"); });

  function updateSelectionUi() {
    const count = selected.size;
    el.statSelected.textContent = String(count);
    const totalBytes = [...selected.values()].reduce((sum, e) => sum + (e.sizeBytes || 0), 0);
    el.statSize.textContent = count ? formatSize(totalBytes) : "—";
    el.installBtn.textContent = `Install selected (${count})`;
    el.installBtn.disabled = count === 0;

    const plainApkCount = [...selected.values()].filter((e) => e.format === "apk").length;
    el.splitBundleCard.hidden = plainApkCount < 2;
  }

  // ---------- container format resolution (unit-tested pure logic) ----------

  function resolveInstallSet(allApkPaths, manifest) {
    const universal = allApkPaths.find((p) => /\/universal\.apk$/i.test(p));
    if (universal) return { paths: [universal], reason: "universal.apk found" };
    if (manifest && Array.isArray(manifest.split_apks) && manifest.split_apks.length) {
      const byBasename = {};
      allApkPaths.forEach((p) => { byBasename[p.split("/").pop()] = p; });
      const resolved = manifest.split_apks
        .map((s) => (typeof s === "string" ? s : s.file))
        .map((name) => byBasename[name])
        .filter(Boolean);
      if (resolved.length) return { paths: resolved, reason: "manifest split_apks list" };
    }
    return { paths: allApkPaths, reason: "fallback: every .apk found" };
  }

  function extractSessionId(createStdout) {
    const m = (createStdout || "").match(/\[(\d+)\]/);
    return m ? m[1] : null;
  }

  function sanitizeSplitName(path, index) {
    return "split" + index + "_" + path.split("/").pop().replace(/[^A-Za-z0-9_]/g, "_");
  }

  function buildInstallCreateCmd(opts) {
    const flags = [];
    if (opts.replace) flags.push("-r");
    if (opts.grant) flags.push("-g");
    return `pm install-create ${flags.join(" ")}`.trim();
  }

  function buildInstallWriteCmd(path, session, splitName) {
    // Streams the file's bytes through stdin instead of handing pm a raw
    // /sdcard path — system_server can't always read FUSE-mounted sdcard
    // paths directly (SELinux: "no access to read file context
    // u:object_r:fuse:s0"), but it CAN read from a pipe the shell already
    // opened. -S <size> is required whenever the source is "-" (stdin).
    return `sz=$(stat -c%s ${shq(path)}) && cat ${shq(path)} | pm install-write -S "$sz" ${session} ${shq(splitName)} -`;
  }

  function resolveObbTarget(manifest) {
    const pkg = manifest && manifest.package_name;
    return pkg ? `/sdcard/Android/obb/${pkg}` : null;
  }

  // ---------- install orchestration ----------

  function progressLog(container, text, kind) {
    container.classList.remove("hidden");
    const line = document.createElement("div");
    line.className = "progress-line" + (kind ? ` ${kind}` : "");
    line.textContent = text;
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
  }

  // Session-based streaming install — used for every install (single file or
  // many), since a plain `pm install <path>` / `pm install-multiple <paths>`
  // both hit the same system_server FUSE-read restriction on /sdcard paths.
  async function streamingInstall(paths, opts, onFileProgress) {
    const createRes = await exec(buildInstallCreateCmd(opts));
    const session = extractSessionId(createRes.stdout);
    if (!createRes.ok || !session) {
      return { ok: false, stderr: "could not create install session: " + (createRes.stderr || createRes.stdout || "") };
    }
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const splitName = sanitizeSplitName(path, i);
      if (onFileProgress) onFileProgress(path);
      const writeRes = await exec(buildInstallWriteCmd(path, session, splitName));
      if (!writeRes.ok) {
        await exec(`pm install-abandon ${session}`);
        return { ok: false, stderr: `failed writing ${path.split("/").pop()}: ` + (writeRes.stderr || writeRes.stdout || "") };
      }
    }
    return exec(`pm install-commit ${session}`);
  }

  async function installPlainApk(path, opts) {
    return streamingInstall([path], opts);
  }

  async function installContainer(entry, opts) {
    if (!unzipAvailable) {
      return { ok: false, stderr: "unzip is not available on this device/ROM — extract on a PC instead and install the resulting APKs individually." };
    }
    const workDir = `${INSTALL_TMP}/${entry.name.replace(/[^A-Za-z0-9_.-]/g, "_")}-${Date.now()}`;
    await exec(`mkdir -p ${shq(workDir)}`);
    // No pipe here on purpose: piping through e.g. `| tail` would make the
    // reported exit code reflect tail's success, not unzip's, masking a
    // real extraction failure as "no .apk files found" further down.
    // -q keeps the per-file listing out of the log instead.
    const unzipRes = await exec(`unzip -o -q ${shq(entry.fullPath)} -d ${shq(workDir)} 2>&1`);
    if (!unzipRes.ok) {
      await exec(`rm -rf ${shq(workDir)}`);
      return { ok: false, stderr: "extraction failed: " + (unzipRes.stderr || unzipRes.stdout || "") };
    }

    const findRes = await exec(`find ${shq(workDir)} -iname "*.apk"`);
    const allApkPaths = (findRes.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (allApkPaths.length === 0) {
      await exec(`rm -rf ${shq(workDir)}`);
      return { ok: false, stderr: "no .apk files found inside this bundle" };
    }

    let manifest = null;
    if (entry.format === "xapk" || entry.format === "apkm") {
      const manifestName = entry.format === "xapk" ? "manifest.json" : "info.json";
      const manifestRes = await exec(`find ${shq(workDir)} -maxdepth 1 -iname ${shq(manifestName)} -exec cat {} \\;`);
      if (manifestRes.stdout && manifestRes.stdout.trim()) {
        try { manifest = JSON.parse(manifestRes.stdout.trim()); } catch (e) { /* proceed without it */ }
      }
    }

    const { paths, reason } = resolveInstallSet(allApkPaths, manifest);
    const installRes = await streamingInstall(paths, opts);

    if (installRes.ok) {
      const obbTarget = resolveObbTarget(manifest);
      const obbFindRes = await exec(`find ${shq(workDir)} -iname "*.obb"`);
      const obbFiles = (obbFindRes.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
      if (obbFiles.length && obbTarget) {
        await exec(`mkdir -p ${shq(obbTarget)}`);
        for (const obb of obbFiles) {
          await exec(`cp ${shq(obb)} ${shq(obbTarget + "/" + obb.split("/").pop())}`);
        }
        installRes.obbNote = `${obbFiles.length} OBB file(s) copied to ${obbTarget}`;
      } else if (obbFiles.length) {
        installRes.obbNote = `${obbFiles.length} OBB file(s) found but no package name known — not copied, check the console for their paths`;
      }
    }

    await exec(`rm -rf ${shq(workDir)}`);
    installRes._reason = reason;
    return installRes;
  }

  async function appendHistory(entryLog) {
    const res = await exec(`cat ${shq(HISTORY_FILE)} 2>/dev/null`);
    let history = [];
    if (res.stdout && res.stdout.trim()) {
      try { history = JSON.parse(res.stdout.trim()); } catch (e) { history = []; }
    }
    history.unshift(entryLog);
    history = history.slice(0, 200);
    await exec(`printf '%s' ${shq(JSON.stringify(history))} > ${shq(HISTORY_FILE)}`);
  }

  async function deleteAfterInstall(paths) {
    if (!el.optDeleteAfter.checked) return;
    for (const p of paths) {
      const res = await exec(`rm -f ${shq(p)}`);
      progressLog(el.installProgress, res.ok ? `  🗑 deleted ${p.split("/").pop()}` : `  ✗ could not delete ${p.split("/").pop()}`, res.ok ? "ok" : "err");
    }
  }

  el.installBtn.addEventListener("click", async () => {
    if (selected.size === 0) return;
    const opts = { replace: el.optReplace.checked, grant: el.optGrant.checked };
    const combineApks = el.splitBundleCheck.checked && !el.splitBundleCard.hidden;
    const items = [...selected.values()];

    const scanOk = await maybeScanBefore(items);
    if (!scanOk) return;

    const ok = await confirmAction(
      "Install " + selected.size + " item(s)?",
      combineApks
        ? "The selected plain APKs will be installed together as one split-package app."
        : "Each selected file will be installed. Container formats (APKS/XAPK/APKM) are extracted first."
    );
    if (!ok) return;

    el.installBtn.disabled = true;
    el.installProgress.innerHTML = "";
    el.installProgress.classList.remove("hidden");

    const plainApks = items.filter((e) => e.format === "apk");
    const containers = items.filter((e) => e.format !== "apk");

    if (combineApks && plainApks.length >= 2) {
      progressLog(el.installProgress, `→ Combined install: ${plainApks.map((e) => e.name).join(", ")}`);
      const res = await streamingInstall(plainApks.map((e) => e.fullPath), opts);
      progressLog(el.installProgress, res.ok ? "  ✓ installed as one package" : `  ✗ failed: ${(res.stderr || res.stdout || "").slice(0, 150)}`, res.ok ? "ok" : "err");
      if (res.ok) {
        for (const e of plainApks) await maybeScanAfter(e.fullPath, e.name);
        await deleteAfterInstall(plainApks.map((e) => e.fullPath));
      }
      await appendHistory({ timestamp: new Date().toISOString(), file: plainApks.map((e) => e.name).join(" + "), format: "apk (split bundle)", result: res.ok ? "success" : "failed" });
    } else {
      for (const e of plainApks) {
        progressLog(el.installProgress, `→ ${e.name}`);
        const res = await installPlainApk(e.fullPath, opts);
        progressLog(el.installProgress, res.ok ? "  ✓ installed" : `  ✗ failed: ${(res.stderr || res.stdout || "").slice(0, 150)}`, res.ok ? "ok" : "err");
        if (res.ok) {
          await maybeScanAfter(e.fullPath, e.name);
          await deleteAfterInstall([e.fullPath]);
        }
        await appendHistory({ timestamp: new Date().toISOString(), file: e.name, format: "apk", result: res.ok ? "success" : "failed" });
      }
    }

    for (const e of containers) {
      progressLog(el.installProgress, `→ ${e.name} (${e.format})`);
      const res = await installContainer(e, opts);
      progressLog(el.installProgress, res.ok ? `  ✓ installed (${res._reason || "resolved"})` : `  ✗ failed: ${(res.stderr || "").slice(0, 150)}`, res.ok ? "ok" : "err");
      if (res.obbNote) progressLog(el.installProgress, "  ℹ " + res.obbNote);
      if (res.ok) {
        await maybeScanAfter(e.fullPath, e.name);
        await deleteAfterInstall([e.fullPath]);
      }
      await appendHistory({ timestamp: new Date().toISOString(), file: e.name, format: e.format, result: res.ok ? "success" : "failed" });
    }

    progressLog(el.installProgress, "Done.", "ok");
    selected.clear();
    renderFileList();
    updateSelectionUi();
    el.installBtn.disabled = false;
  });

  // ---------- history ----------

  async function loadHistory() {
    el.historyList.innerHTML = `<div class="empty-state">Loading…</div>`;
    const res = await exec(`cat ${shq(HISTORY_FILE)} 2>/dev/null`);
    let history = [];
    if (res.stdout && res.stdout.trim()) {
      try { history = JSON.parse(res.stdout.trim()); } catch (e) { history = []; }
    }
    if (history.length === 0) {
      el.historyList.innerHTML = `<div class="empty-state">Nothing installed through PULSE//INSTALL yet.</div>`;
      return;
    }
    el.historyList.innerHTML = history.map((h) => `
      <div class="item-row">
        <div class="item-main">
          <span class="item-name">${escapeHtml(h.file)}</span>
          <span class="item-sub">${escapeHtml(h.format)} · ${new Date(h.timestamp).toLocaleString()}</span>
        </div>
        <span class="badge ${h.result === "success" ? "ok" : "crit"}">${escapeHtml(h.result)}</span>
      </div>
    `).join("");
  }

  el.historyClearBtn.addEventListener("click", async () => {
    const ok = await confirmAction("Clear install history?", "This only clears the log — it does not uninstall anything.");
    if (!ok) return;
    await exec(`rm -f ${shq(HISTORY_FILE)}`);
    loadHistory();
  });

  // ---------- VirusTotal (hash lookup only — see README for why not upload) ----------

  const VT_KEY_STORAGE = "pulse-vt-apikey";

  (function initVt() {
    try {
      const saved = localStorage.getItem(VT_KEY_STORAGE);
      if (saved) { el.vtApiKeyInput.value = saved; el.vtRememberKey.checked = true; }
    } catch (e) { /* storage unavailable */ }
  })();
  el.vtRememberKey.addEventListener("change", () => {
    if (!el.vtRememberKey.checked) { try { localStorage.removeItem(VT_KEY_STORAGE); } catch (e) {} }
    else { try { localStorage.setItem(VT_KEY_STORAGE, el.vtApiKeyInput.value); } catch (e) {} }
  });
  el.vtApiKeyInput.addEventListener("input", () => {
    if (el.vtRememberKey.checked) { try { localStorage.setItem(VT_KEY_STORAGE, el.vtApiKeyInput.value); } catch (e) {} }
  });
  el.vtKeyToggleBtn.addEventListener("click", () => {
    const showing = el.vtApiKeyInput.type === "text";
    el.vtApiKeyInput.type = showing ? "password" : "text";
    el.vtKeyToggleBtn.textContent = showing ? "show" : "hide";
  });

  function formatVtStats(stats) {
    const malicious = stats.malicious || 0;
    const suspicious = stats.suspicious || 0;
    const total = Object.values(stats).reduce((a, b) => a + (Number(b) || 0), 0);
    if (malicious > 0) return { label: `${malicious}/${total} engines flag this as MALICIOUS`, kind: "crit" };
    if (suspicious > 0) return { label: `${suspicious}/${total} engines flag this as suspicious`, kind: "warn" };
    return { label: `clean per ${total} engines`, kind: "ok" };
  }

  async function vtLookup(path) {
    const apiKey = el.vtApiKeyInput.value.trim();
    if (!apiKey) return { ok: false, error: "no VirusTotal API key set" };
    const hashRes = await exec(`sha256sum ${shq(path)} 2>/dev/null | cut -d' ' -f1`);
    const hash = (hashRes.stdout || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      return { ok: false, error: "could not compute SHA-256 (sha256sum may be missing on this device)" };
    }
    let res;
    try {
      res = await fetch("https://www.virustotal.com/api/v3/files/" + hash, { headers: { "x-apikey": apiKey } });
    } catch (e) {
      return { ok: false, error: "network error reaching VirusTotal: " + String(e), hash };
    }
    if (res.status === 404) return { ok: true, found: false, hash };
    if (res.status === 401) return { ok: false, error: "VirusTotal rejected the API key (401)", hash };
    if (res.status === 429) return { ok: false, error: "VirusTotal rate limit hit (429) — free keys allow 4 requests/minute", hash };
    if (!res.ok) return { ok: false, error: `VirusTotal HTTP ${res.status}`, hash };
    let data;
    try { data = await res.json(); } catch (e) { return { ok: false, error: "could not parse VirusTotal response", hash }; }
    const stats = data && data.data && data.data.attributes && data.data.attributes.last_analysis_stats;
    if (!stats) return { ok: false, error: "unexpected VirusTotal response shape", hash };
    return { ok: true, found: true, hash, stats, permalink: `https://www.virustotal.com/gui/file/${hash}` };
  }

  async function scanAndReport(path, name) {
    progressLog(el.vtProgress, `→ scanning ${name}…`);
    const result = await vtLookup(path);
    if (!result.ok) {
      progressLog(el.vtProgress, `  ✗ ${result.error}`, "err");
      return result;
    }
    if (!result.found) {
      progressLog(el.vtProgress, `  ? not in VirusTotal's database yet (${result.hash.slice(0, 12)}…) — upload manually at virustotal.com for a first scan`, "warn");
      return result;
    }
    const verdict = formatVtStats(result.stats);
    progressLog(el.vtProgress, `  ${verdict.kind === "ok" ? "✓" : "⚠"} ${verdict.label}`, verdict.kind === "crit" ? "err" : verdict.kind);
    progressLog(el.vtProgress, `  ${result.permalink}`);
    return { ...result, verdict };
  }

  async function maybeScanBefore(items) {
    if (!el.vtScanBefore.checked) return true;
    el.vtProgress.classList.remove("hidden");
    el.vtProgress.innerHTML = "";
    let anyMalicious = false;
    for (const item of items) {
      const r = await scanAndReport(item.fullPath, item.name);
      if (r.ok && r.found && r.verdict && r.verdict.kind === "crit") anyMalicious = true;
    }
    if (anyMalicious) {
      return confirmAction(
        "VirusTotal flagged malware",
        "One or more selected files are flagged as malicious by VirusTotal. Installing anyway is strongly discouraged. Continue?"
      );
    }
    return true;
  }

  async function maybeScanAfter(path, name) {
    if (!el.vtScanAfter.checked) return;
    el.vtProgress.classList.remove("hidden");
    await scanAndReport(path, name);
  }

  // ---------- auto-install folder ----------

  const AUTO_DIR = "/sdcard/pulse-install/auto";
  const AUTO_DONE_DIR = AUTO_DIR + "/installed";
  const AUTO_LOG = "/data/local/tmp/.pulse-install-auto.log";

  el.autoScanBtn.addEventListener("click", async () => {
    el.autoScanBtn.disabled = true;
    el.autoProgress.innerHTML = "";
    el.autoProgress.classList.remove("hidden");
    const opts = { replace: el.optReplace.checked, grant: el.optGrant.checked };

    await exec(`mkdir -p ${shq(AUTO_DIR)} ${shq(AUTO_DONE_DIR)}`);
    const listRes = await exec(`find ${shq(AUTO_DIR)} -maxdepth 1 -type f \\( -iname "*.apk" -o -iname "*.apks" -o -iname "*.xapk" -o -iname "*.apkm" \\)`);
    const files = (listRes.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);

    if (files.length === 0) {
      progressLog(el.autoProgress, "Nothing to install — the folder is empty or has no supported files.");
      el.autoScanBtn.disabled = false;
      return;
    }

    for (const path of files) {
      const name = path.split("/").pop();
      const format = detectFormat(name);
      progressLog(el.autoProgress, `→ ${name}`);
      const res = format === "apk"
        ? await installPlainApk(path, opts)
        : await installContainer({ fullPath: path, name, format }, opts);
      if (res.ok) {
        await exec(`mv ${shq(path)} ${shq(AUTO_DONE_DIR + "/" + name)}`);
        progressLog(el.autoProgress, "  ✓ installed", "ok");
      } else {
        progressLog(el.autoProgress, `  ✗ failed: ${(res.stderr || "").slice(0, 150)}`, "err");
      }
      await appendHistory({ timestamp: new Date().toISOString(), file: name, format: format || "unknown", result: res.ok ? "success" : "failed" });
    }
    progressLog(el.autoProgress, "Done.", "ok");
    el.autoScanBtn.disabled = false;
  });

  el.autoLogBtn.addEventListener("click", async () => {
    el.autoProgress.innerHTML = "";
    el.autoProgress.classList.remove("hidden");
    const res = await exec(`cat ${shq(AUTO_LOG)} 2>/dev/null`);
    const text = (res.stdout || "").trim();
    if (!text) {
      progressLog(el.autoProgress, "No boot-time auto-install activity logged yet.");
      return;
    }
    text.split("\n").forEach((line) => progressLog(el.autoProgress, line, /FAIL/.test(line) ? "err" : "ok"));
  });

  // ---------- bridge retry / init ----------

  if (el.bridgeRetryBtn) {
    el.bridgeRetryBtn.addEventListener("click", async () => {
      el.bridgeRetryBtn.disabled = true;
      el.bridgeRetryBtn.textContent = "Retrying…";
      const ok = await checkBridge();
      el.bridgeRetryBtn.disabled = false;
      el.bridgeRetryBtn.textContent = "Retry connection";
      if (ok) browsePath(currentPath);
    });
  }

  // ---------- extract an installed app ----------

  const EXTRACT_ROOT = "/sdcard/Download/pulse-extracted";
  let scannedExtractApps = []; // {pkg, versionName, versionCode}
  const extractSelected = new Set();

  function renderExtractAppList() {
    const filter = el.extractAppSearch.value.trim().toLowerCase();
    const rows = scannedExtractApps.filter((a) => !filter || a.pkg.toLowerCase().includes(filter));
    if (rows.length === 0) {
      el.extractAppList.innerHTML = `<div class="empty-state">${scannedExtractApps.length ? "No apps match your filter." : "Run a scan to list installed apps."}</div>`;
      return;
    }
    el.extractAppList.innerHTML = rows.map((a) => `
      <div class="item-row" data-pkg="${a.pkg}">
        <div class="item-main"><span class="item-name">${a.pkg}</span><span class="item-sub">v${a.versionName || "?"}</span></div>
        <input type="checkbox" ${extractSelected.has(a.pkg) ? "checked" : ""}>
      </div>
    `).join("");
    el.extractAppList.querySelectorAll(".item-row").forEach((row) => {
      const checkbox = row.querySelector("input[type=checkbox]");
      const toggle = () => {
        const pkg = row.dataset.pkg;
        if (extractSelected.has(pkg)) extractSelected.delete(pkg); else extractSelected.add(pkg);
        checkbox.checked = extractSelected.has(pkg);
        el.extractBtn.textContent = `Extract selected (${extractSelected.size})`;
        el.extractBtn.disabled = extractSelected.size === 0;
      };
      row.addEventListener("click", (e) => { if (e.target !== checkbox) toggle(); });
      checkbox.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
    });
  }
  el.extractAppSearch.addEventListener("input", renderExtractAppList);

  el.scanExtractAppsBtn.addEventListener("click", async () => {
    el.scanExtractAppsBtn.disabled = true;
    el.scanExtractAppsBtn.textContent = "Scanning…";
    el.extractAppList.innerHTML = `<div class="empty-state">Scanning…</div>`;
    const scopeFlag = el.extractScopeUser.checked ? "-3" : "";
    const cmd = [
      `for p in $(pm list packages ${scopeFlag} | sed 's/^package://'); do`,
      `  d=$(dumpsys package "$p" 2>/dev/null)`,
      `  v=$(echo "$d" | grep -m1 "versionName=" | sed 's/^ *versionName=//')`,
      `  c=$(echo "$d" | grep -m1 "versionCode=" | awk '{print $1}' | sed 's/versionCode=//')`,
      `  printf '%s|%s|%s\\n' "$p" "$v" "$c"`,
      `done`,
    ].join("\n");
    const res = await exec(cmd);
    scannedExtractApps = (res.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
      const [pkg, versionName, versionCode] = line.split("|");
      return { pkg, versionName, versionCode };
    }).sort((a, b) => a.pkg.localeCompare(b.pkg));
    el.scanExtractAppsBtn.disabled = false;
    el.scanExtractAppsBtn.textContent = "Scan installed apps";
    renderExtractAppList();
  });

  function buildXapkManifest(app, apkFiles) {
    return {
      xapk_version: 2,
      package_name: app.pkg,
      name: app.pkg,
      version_code: app.versionCode || "",
      version_name: app.versionName || "",
      split_apks: apkFiles.map((f) => ({ file: f, id: f.replace(/\.apk$/i, "") })),
    };
  }

  el.extractBtn.addEventListener("click", async () => {
    if (extractSelected.size === 0) return;
    const format = el.extractFormat.value;
    const ok = await confirmAction(
      "Extract " + extractSelected.size + " app(s)?",
      format === "xapk"
        ? "Pulls each app's APK (and splits) and bundles them into a .xapk you can install elsewhere or re-import here."
        : "Pulls each app's APK (and splits) out as loose files."
    );
    if (!ok) return;

    el.extractBtn.disabled = true;
    el.extractProgress.innerHTML = "";
    el.extractProgress.classList.remove("hidden");
    await exec(`mkdir -p ${shq(EXTRACT_ROOT)}`);

    let zipAvailable = null;
    if (format === "xapk") {
      const zipRes = await exec("command -v zip");
      zipAvailable = !!(zipRes.ok && zipRes.stdout && zipRes.stdout.trim());
    }

    for (const pkg of extractSelected) {
      const app = scannedExtractApps.find((a) => a.pkg === pkg) || { pkg };
      progressLog(el.extractProgress, `→ ${pkg}`);
      const label = `${pkg}_${app.versionName || app.versionCode || "unknown"}`;
      const destDir = `${EXTRACT_ROOT}/${label}`;
      await exec(`mkdir -p ${shq(destDir)}`);

      const pathRes = await exec(`pm path ${shq(pkg)}`);
      const apkPaths = (pathRes.stdout || "").split("\n").map((l) => l.trim()).filter((l) => l.indexOf("package:") === 0).map((l) => l.slice("package:".length));
      if (apkPaths.length === 0) {
        progressLog(el.extractProgress, `  ✗ pm path returned nothing for ${pkg}`, "err");
        continue;
      }
      const apkFiles = [];
      const copyCmds = apkPaths.map((p) => { const name = p.split("/").pop(); apkFiles.push(name); return `cp ${shq(p)} ${shq(destDir + "/" + name)}`; });
      const copyRes = await exec(copyCmds.join("\n"));
      if (!copyRes.ok) {
        progressLog(el.extractProgress, `  ✗ copy failed`, "err");
        continue;
      }
      progressLog(el.extractProgress, `  ✓ ${apkFiles.length} APK file(s) copied to ${destDir}`, "ok");

      if (format === "xapk") {
        const manifest = buildXapkManifest(app, apkFiles);
        await exec(`printf '%s' ${shq(JSON.stringify(manifest))} > ${shq(destDir + "/manifest.json")}`);
        if (zipAvailable) {
          const xapkPath = `${EXTRACT_ROOT}/${label}.xapk`;
          const zipRes = await exec(`cd ${shq(destDir)} && zip -q -j ${shq(xapkPath)} *`);
          if (zipRes.ok) {
            progressLog(el.extractProgress, `  ✓ bundled: ${xapkPath}`, "ok");
          } else {
            progressLog(el.extractProgress, `  ✗ zip failed — files left loose in ${destDir}`, "err");
          }
        } else {
          progressLog(el.extractProgress, `  ⚠ zip not available on this device — left as loose files + manifest.json in ${destDir}`, "warn");
        }
      }
    }
    progressLog(el.extractProgress, "Done.", "ok");
    el.extractBtn.disabled = false;
  });

  function init() {
    checkBridge().then((ok) => { if (ok) browsePath(currentPath); });
    updateSelectionUi();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
