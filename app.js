(() => {
  // ===== Config =====
  const DEFAULT_API_BASE = "https://mst26-cp1-proxy.work-d3c.workers.dev"; // あなたのWorkers
  const STORAGE_PREFIX = "mst26_cp1_v1_";
  const KEY = {
    apiBase: STORAGE_PREFIX + "api_base",
    deviceId: STORAGE_PREFIX + "device_id",
    operator: STORAGE_PREFIX + "operator",
    seq: STORAGE_PREFIX + "seq",
    queue: STORAGE_PREFIX + "queue",
    roster: STORAGE_PREFIX + "roster_cache",
    rosterAt: STORAGE_PREFIX + "roster_at",
  };

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);

  const elNet = $("netStatus");
  const elApi = $("apiBase");
  const elDev = $("deviceId");
  const elOp = $("operator");

  const elInput = $("qrInput");
  const elAddBtn = $("addBtn");
  const elAddResult = $("addResult");

  const elSyncBtn = $("syncBtn");
  const elClearBtn = $("clearBtn");
  const elSyncResult = $("syncResult");
  const elPendingCount = $("pendingCount");
  const elPendingList = $("pendingList");

  const elRosterBtn = $("rosterBtn");
  const elRosterResult = $("rosterResult");

  // ===== Helpers =====
  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function getApiBase() {
    const url = new URL(location.href);
    const fromQuery = url.searchParams.get("api");
    if (fromQuery) {
      localStorage.setItem(KEY.apiBase, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(KEY.apiBase) || DEFAULT_API_BASE;
  }

  function getOrCreateDeviceId() {
    const existing = localStorage.getItem(KEY.deviceId);
    if (existing) return existing;

    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("dev-" + Math.random().toString(16).slice(2));
    localStorage.setItem(KEY.deviceId, id);
    return id;
  }

  function getOperator() {
    const url = new URL(location.href);
    const fromQuery = url.searchParams.get("operator");
    if (fromQuery) {
      localStorage.setItem(KEY.operator, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(KEY.operator) || "CP1";
  }

  function getSeq() {
    const v = parseInt(localStorage.getItem(KEY.seq) || "0", 10);
    return Number.isFinite(v) ? v : 0;
  }
  function incSeq() {
    const next = getSeq() + 1;
    localStorage.setItem(KEY.seq, String(next));
    return next;
  }

  function formatISOWithOffset(d) {
    // 例: 2026-02-06T10:12:34+09:00（端末ローカルTZ）
    const pad = (n) => String(n).padStart(2, "0");
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    const tzMin = -d.getTimezoneOffset(); // JSTなら +540
    const sign = tzMin >= 0 ? "+" : "-";
    const tzh = pad(Math.floor(Math.abs(tzMin) / 60));
    const tzm = pad(Math.abs(tzMin) % 60);
    return `${y}-${m}-${day}T${hh}:${mm}:${ss}${sign}${tzh}:${tzm}`;
  }

  function parseBib(input) {
    const s = String(input || "").trim();
    if (!s) return null;

    // 仕様: "MST26:001" -> 1, "MST26:021" -> 21（先頭0許容） :contentReference[oaicite:3]{index=3}
    const m = s.match(/mst26\s*:\s*([0-9]{1,6})/i);
    const digits = m ? m[1] : (s.match(/^[0-9]{1,6}$/) ? s : null);
    if (!digits) return null;

    const bib = parseInt(digits, 10);
    if (!Number.isFinite(bib) || bib <= 0) return null;
    return bib;
  }

  function loadQueue() {
    return safeJsonParse(localStorage.getItem(KEY.queue) || "[]", []);
  }
  function saveQueue(q) {
    localStorage.setItem(KEY.queue, JSON.stringify(q));
  }

  function renderNet() {
    const online = navigator.onLine;
    elNet.textContent = `状態: ${online ? "オンライン" : "オフライン"}（${formatISOWithOffset(new Date())}）`;
  }

  function renderState() {
    const api = getApiBase();
    const devId = getOrCreateDeviceId();
    const op = getOperator();

    elApi.textContent = api;
    elDev.textContent = devId;
    elOp.textContent = op;

    const q = loadQueue();
    elPendingCount.textContent = String(q.length);

    // 最新20件だけ表示
    elPendingList.innerHTML = "";
    q.slice(-20).reverse().forEach((it) => {
      const li = document.createElement("li");
      li.className = "mono";
      li.textContent = `${it.bibNumber} / ${it.scanned_at} / ${it.event_id.slice(0, 8)}…`;
      elPendingList.appendChild(li);
    });
  }

  function addToQueueFromInput() {
    const bib = parseBib(elInput.value);
    if (!bib) {
      elAddResult.textContent = "入力が無効です（例: MST26:021 / 21）";
      return;
    }

    const api = getApiBase();
    const devId = getOrCreateDeviceId();
    const op = getOperator();

    const now = new Date();
    const scanned_at = formatISOWithOffset(now);
    const seq = incSeq();
    const event_id = `${devId}-${now.getTime()}-${seq}-${bib}`;

    const item = {
      event_id,
      station: "cp1",
      bibNumber: bib,
      scanned_at,
      device_id: devId,
      operator: op,
      _api: api,
    };

    const q = loadQueue();
    q.push(item);
    saveQueue(q);

    elAddResult.textContent = `追加しました: bib=${bib}（未送信 ${q.length}）`;
    elInput.value = "";
    renderState();
  }

  async function fetchJson(url, options, timeoutMs = 15000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
  
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      const text = await resp.text();
      const data = safeJsonParse(text, null);
      return { ok: resp.ok, status: resp.status, text, data };
    } catch (e) {
      const msg = (e && e.name === "AbortError") ? `Timeout(${timeoutMs}ms)` : String(e);
      return { ok: false, status: 0, text: msg, data: null };
    } finally {
      clearTimeout(t);
    }
  }

  async function syncBatch() {
    const api = getApiBase();
    const q0 = loadQueue();
    if (q0.length === 0) {
      elSyncResult.textContent = "未送信はありません。";
      return;
    }
    if (!navigator.onLine) {
      elSyncResult.textContent = "オフラインのため送信できません。";
      return;
    }
  
    elSyncResult.textContent = "送信中…";
  
    const BATCH_SIZE = 10;
    let totalAccepted = 0;
    let totalIgnored = 0;
  
    // 収束ガード（無限ループ防止）
    let guard = 0;
  
    while (true) {
      guard++;
      if (guard > 30) {
        elSyncResult.textContent = "異常: 収束しません（30回試行）。サーバー応答を確認してください。";
        return;
      }
  
      const q = loadQueue();
      if (q.length === 0) break;
  
      const batch = q.slice(0, BATCH_SIZE);
      const payload = {
        action: "scan_batch",
        scans: batch.map(({ event_id, station, bibNumber, scanned_at, device_id, operator }) => ({
          event_id,
          station,
          bibNumber,
          scanned_at,
          device_id,
          operator,
        })),
      };
  
      // Content-Typeはブラウザ側では付けない（プリフライト回避）
      const res = await fetchJson(`${api}/scan_batch`, {
        method: "POST",
        body: JSON.stringify(payload),
      }, 15000);
  
      // ここで失敗は必ず見える化
      if (!res.ok || !res.data) {
        elSyncResult.textContent = `送信失敗: HTTP ${res.status} / ${res.text.slice(0, 300)}`;
        return;
      }
  
      const accepted = Array.isArray(res.data.accepted_event_ids) ? res.data.accepted_event_ids : [];
      const ignored = Array.isArray(res.data.ignored_event_ids) ? res.data.ignored_event_ids : [];
  
      totalAccepted += accepted.length;
      totalIgnored += ignored.length;
  
      const beforeLen = q.length;
  
      // accepted + ignored をキューから除外（両方 “done”）
      const doneSet = new Set([...accepted, ...ignored]);
      const nextQueue = q.filter((it) => !doneSet.has(it.event_id));
      saveQueue(nextQueue);
  
      renderState();
  
      const removed = beforeLen - nextQueue.length;
  
      // ★ここが超重要：1件も減らないなら、応答がおかしいので止める
      if (removed === 0) {
        elSyncResult.textContent =
          "収束しません（0件も消えない）。" +
          " サーバーが event_id を返していない/scan_batchが無効の可能性。 " +
          `resp=${JSON.stringify(res.data).slice(0, 500)}`;
        return;
      }
    }
  
    elSyncResult.textContent =
      `同期完了: 受理=${totalAccepted}, 重複=${totalIgnored}, 残り=${loadQueue().length}`;
  }

  async function clearQueue() {
    const q = loadQueue();
    if (q.length === 0) {
      elSyncResult.textContent = "未送信はありません。";
      return;
    }
    const ok = confirm(`未送信キューを全消去します（${q.length}件）。よいですか？`);
    if (!ok) return;
    saveQueue([]);
    elSyncResult.textContent = "全消去しました。";
    renderState();
  }

  async function updateRoster() {
    const api = getApiBase();
    if (!navigator.onLine) {
      elRosterResult.textContent = "オフラインのため更新できません。";
      return;
    }

    elRosterResult.textContent = "更新中…";

    // 仕様: GET /roster :contentReference[oaicite:8]{index=8}
    const res = await fetchJson(`${api}/roster`, { method: "GET" });

    if (!res.ok || !res.data) {
      elRosterResult.textContent = `更新失敗: HTTP ${res.status} / ${res.text.slice(0, 200)}`;
      return;
    }

    const roster = Array.isArray(res.data.roster) ? res.data.roster : [];
    const generatedAt = res.data.generated_at || "(unknown)";

    localStorage.setItem(KEY.roster, JSON.stringify(res.data));
    localStorage.setItem(KEY.rosterAt, formatISOWithOffset(new Date()));

    elRosterResult.textContent = `更新OK: ${roster.length}件 / generated_at=${generatedAt}`;
  }

  // ===== Wire up =====
  function init() {
    renderNet();
    renderState();

    window.addEventListener("online", () => { renderNet(); });
    window.addEventListener("offline", () => { renderNet(); });

    elAddBtn.addEventListener("click", addToQueueFromInput);
    elInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addToQueueFromInput();
    });

    elSyncBtn.addEventListener("click", () => syncBatch().catch((e) => {
      elSyncResult.textContent = `送信エラー: ${String(e).slice(0, 200)}`;
    }));

    elClearBtn.addEventListener("click", clearQueue);

    elRosterBtn.addEventListener("click", () => updateRoster().catch((e) => {
      elRosterResult.textContent = `更新エラー: ${String(e).slice(0, 200)}`;
    }));

    // 初期表示
    elAddResult.textContent = "";
    elSyncResult.textContent = "";
    elRosterResult.textContent = "";
  }

  init();
})();

// ----- Camera UI + QR scan (CP1) -----
(() => {
  let camStream = null;
  let scanning = false;
  let rafId = null;

  let lastText = "";
  let lastAt = 0;
  const COOLDOWN_MS = 1200;

  function $(id) { return document.getElementById(id); }

  function beep_() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 90);
    } catch (_) {}
  }

  function findManualInputAndAddButton() {
    // 既存UI（手入力）をそのまま使うため、要素を「それっぽく」探す
    const input =
      document.querySelector('input[placeholder*="MST26"]') ||
      document.querySelector('input[type="text"]');

    // 「追加」ボタン（手入力カード内にあるはず）を優先して拾う
    let addBtn = null;
    if (input) {
      const card = input.closest(".card") || input.parentElement;
      if (card) {
        addBtn = Array.from(card.querySelectorAll("button"))
          .find(b => (b.textContent || "").includes("追加"));
      }
    }
    if (!addBtn) {
      addBtn = Array.from(document.querySelectorAll("button"))
        .find(b => (b.textContent || "").trim() === "追加");
    }
    return { input, addBtn };
  }

  function normalizeScanText(raw) {
    const t = String(raw || "").trim();

    // MST26:021 / MST26:21
    const m = t.match(/^MST26\s*:\s*(\d{1,4})$/i);
    if (m) return `MST26:${String(parseInt(m[1], 10))}`; // 先頭ゼロは落とす（既存手入力ロジックに任せる）

    // 021 / 21
    const d = t.match(/^\d{1,4}$/);
    if (d) return String(parseInt(t, 10));

    return null;
  }

  function pushToQueueViaExistingUI(rawText) {
    const normalized = normalizeScanText(rawText);
    const statusEl = $("camStatus");

    if (!normalized) {
      if (statusEl) statusEl.textContent = `QR形式が違います: ${String(rawText).slice(0, 40)}`;
      return false;
    }

    const { input, addBtn } = findManualInputAndAddButton();
    if (!input || !addBtn) {
      if (statusEl) statusEl.textContent = "手入力の入力欄/追加ボタンが見つかりません（HTML構造要確認）";
      return false;
    }

    input.value = normalized;
    // 既存の「追加」処理をそのまま使う（キューのキー/形式を壊さないため）
    addBtn.click();
    return true;
  }

  function stopScanLoop() {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function scanLoop() {
    if (!scanning) return;

    const video = $("camVideo");
    const canvas = $("camCanvas");
    const statusEl = $("camStatus");

    if (!video || !canvas) {
      rafId = requestAnimationFrame(scanLoop);
      return;
    }

    // video の準備待ち
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      rafId = requestAnimationFrame(scanLoop);
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);

    try {
      const img = ctx.getImageData(0, 0, w, h);
      const qr = (window.jsQR)
        ? window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })
        : null;

      if (qr && qr.data) {
        const text = String(qr.data).trim();
        const now = Date.now();

        // 同じQRを画面にかざしっぱなしでも多重追加しない
        if (text !== lastText || (now - lastAt) > COOLDOWN_MS) {
          lastText = text;
          lastAt = now;

          const ok = pushToQueueViaExistingUI(text);
          if (ok) beep_();
          if (statusEl) statusEl.textContent = ok ? `読取: ${text} → 追加` : `読取: ${text}（追加失敗）`;
        }
      }
    } catch (e) {
      // 読み取り失敗は握りつぶして次フレームへ（止まるのが一番困る）
    }

    rafId = requestAnimationFrame(scanLoop);
  }

  async function startCamera() {
    const startBtn = $("camStartBtn");
    const stopBtn  = $("camStopBtn");
    const statusEl = $("camStatus");
    const video    = $("camVideo");

    if (!statusEl || !video) return;

    statusEl.textContent = "カメラ起動中…（権限確認）";

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusEl.textContent = "このブラウザはカメラAPIに対応していません";
        return;
      }

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width:  { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      camStream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = camStream;
      await video.play();

      if (startBtn) startBtn.disabled = true;
      if (stopBtn)  stopBtn.disabled = false;

      statusEl.textContent = "カメラ起動OK（QR待ち）";

      // スキャン開始
      scanning = true;
      scanLoop();

    } catch (e) {
      const name = e && e.name ? e.name : "";
      const msg  = e && e.message ? e.message : String(e);

      if (name === "NotAllowedError") {
        statusEl.textContent = "許可されていません（Safariのサイト設定でカメラを許可）";
      } else if (name === "NotFoundError") {
        statusEl.textContent = "カメラが見つかりません（別アプリが使用中の可能性）";
      } else {
        statusEl.textContent = `カメラ起動失敗: ${name} ${msg}`.trim();
      }
    }
  }

  function stopCamera() {
    const startBtn = $("camStartBtn");
    const stopBtn  = $("camStopBtn");
    const statusEl = $("camStatus");
    const video    = $("camVideo");

    stopScanLoop();

    try {
      if (camStream) {
        camStream.getTracks().forEach(t => t.stop());
        camStream = null;
      }
      if (video) video.srcObject = null;
      if (statusEl) statusEl.textContent = "停止しました";
    } finally {
      if (startBtn) startBtn.disabled = false;
      if (stopBtn)  stopBtn.disabled = true;
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const startBtn = $("camStartBtn");
    const stopBtn  = $("camStopBtn");
    const statusEl = $("camStatus");

    if (!startBtn || !stopBtn || !statusEl) return;

    startBtn.addEventListener("click", startCamera);
    stopBtn.addEventListener("click", stopCamera);
    stopBtn.disabled = true;
    statusEl.textContent = "未開始";
  });
})();
