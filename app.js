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

// ----- Camera UI (CP1) -----
(() => {
  let camStream = null;

  function $(id) { return document.getElementById(id); }

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

      // iPhone Safari で失敗しにくい指定（environmentは ideal）
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

      // iOSは play() が必要
      await video.play();

      if (startBtn) startBtn.disabled = true;
      if (stopBtn)  stopBtn.disabled = false;

      statusEl.textContent = "カメラ起動OK（映像取得中）";
    } catch (e) {
      const name = e && e.name ? e.name : "";
      const msg  = e && e.message ? e.message : String(e);

      // よくある原因をメッセージ化
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
