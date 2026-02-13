(() => {
  // ===== Config =====
  const DEFAULT_API_BASE = "https://mst26-cp1-proxy.work-d3c.workers.dev"; // あなたのWorkers
  const STORAGE_PREFIX = "mst26_cp1_v1_";
  const BUILD_VERSION = "build: 2026-02-13T01:42:00Z"; // 表示用の版本タグ（キャッシュ切り分け用）
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

  // 名簿: bib(String) -> name(String) のMapを作る
  function getRosterNameMap_() {
    try {
      const raw = safeJsonParse(localStorage.getItem(KEY.roster) || "{}", {});
      const list = Array.isArray(raw?.roster) ? raw.roster : (Array.isArray(raw) ? raw : []);
      const map = new Map();
      for (const it of list) {
        if (!it || typeof it !== "object") continue;
        const bibCand = it.bibNumber ?? it.bib;
        const bibNum = parseInt(bibCand, 10);
        if (!Number.isFinite(bibNum) || bibNum <= 0) continue;
        const name = String(it.name ?? it.runnerName ?? it.fullName ?? "").trim();
        map.set(String(bibNum), name);
      }
      return map;
    } catch { return new Map(); }
  }

  function formatTimeHHMMSS_(isoLike) {
    try {
      const d = new Date(isoLike);
      return d.toLocaleTimeString("ja-JP", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return "--:--:--"; }
  }

  // 旧フォーマットも含め、アイテムから bib の数値文字列キーを抽出
  function extractBibKey(it) {
    const toNumStr = (v) => {
      const num = parseInt(v, 10);
      return Number.isFinite(num) && num > 0 ? String(num) : null;
    };
    if (it == null) return null;
    if (typeof it === "number" || typeof it === "bigint") return toNumStr(it);
    if (typeof it === "string") {
      const m = it.match(/(\d{1,6})/);
      return m ? toNumStr(m[1]) : null;
    }
    if (typeof it === "object") {
      if (it.bibNumber != null) return toNumStr(it.bibNumber);
      if (it.bib != null) return toNumStr(it.bib);
      const raw = it.input ?? it.normalized ?? it.text ?? it.rawText ?? "";
      const m = String(raw).match(/(\d{1,6})/);
      return m ? toNumStr(m[1]) : null;
    }
    return null;
  }

  // アイテムを（可能なら）現在の正規形式に整える。event_id 等が無い場合は生成する
  function canonicalizeItem(it) {
    const key = extractBibKey(it);
    if (!key) return null;

    // 既に正規形式ならそのまま返す
    if (it && typeof it === "object" && it.event_id && it.scanned_at && (it.bibNumber != null)) {
      return it;
    }

    const api = getApiBase();
    const devId = getOrCreateDeviceId();
    const op = getOperator();

    const now = new Date();
    const scanned_at = formatISOWithOffset(now);
    const seq = incSeq();
    const event_id = `${devId}-${now.getTime()}-${seq}-${key}`;

    return {
      event_id,
      station: "cp1",
      bibNumber: parseInt(key, 10),
      scanned_at,
      device_id: devId,
      operator: op,
      _api: api,
    };
  }

  // 配列を正規化＋重複除去（同一 bib は先勝ち）
  function normalizeAndDedupe(arr) {
    const out = [];
    const seen = new Set();
    for (const it of Array.isArray(arr) ? arr : []) {
      const key = extractBibKey(it);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const canon = canonicalizeItem(it);
      if (canon) out.push(canon);
    }
    return out;
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
    const raw = safeJsonParse(localStorage.getItem(KEY.queue) || "[]", []);
    const normalized = normalizeAndDedupe(raw);
    // 必要があればストレージへ反映（正規化を一度で固定化）
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      try { localStorage.setItem(KEY.queue, JSON.stringify(normalized)); } catch(_) {}
    }
    return normalized;
  }
  function saveQueue(q) {
    const normalized = normalizeAndDedupe(q);
    localStorage.setItem(KEY.queue, JSON.stringify(normalized));
  }

  // 手入力/スキャン共通のキュー投入ロジック（原子的 + 5秒ロック）
  const __enqueueLock__ = Object.create(null); // { [bibKey]: timestamp }
  const ENQUEUE_LOCK_MS = 5000;
  function enqueueBib(bib) {
    const n = parseInt(bib, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: "invalid" };
    }

    const key = String(n);

    // 原子的ロック：同一bibの短時間再入を即時拒否
    const nowTs = Date.now();
    const lastTs = __enqueueLock__[key] || 0;
    if (nowTs - lastTs < ENQUEUE_LOCK_MS) {
      const len = loadQueue().length;
      return { ok: false, reason: "locked", length: len };
    }
    __enqueueLock__[key] = nowTs;

    const q = loadQueue();
    // 既存重複も改めて確認（最後の砦は saveQueue でも実施）
    const dup = Array.isArray(q) && q.some((it) => extractBibKey(it) === key);
    if (dup) {
      return { ok: false, reason: "duplicate", length: q.length };
    }

    const api = getApiBase();
    const devId = getOrCreateDeviceId();
    const op = getOperator();

    const now = new Date();
    const scanned_at = formatISOWithOffset(now);
    const seq = incSeq();
    const event_id = `${devId}-${now.getTime()}-${seq}-${n}`;

    const item = {
      event_id,
      station: "cp1",
      bibNumber: n,
      scanned_at,
      device_id: devId,
      operator: op,
      _api: api,
    };

    q.push(item);
    saveQueue(q);
    return { ok: true, length: loadQueue().length, item };
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

    const nameMap = getRosterNameMap_();
    elPendingList.innerHTML = "";
    q.slice(-20).reverse().forEach((it) => {
      const t = formatTimeHHMMSS_(it.scanned_at);
      const bib = String(it.bibNumber);
      const nm = nameMap.get(bib) || "";
      const li = document.createElement("li");
      li.className = "mono";
      li.textContent = nm ? `${t}  ${bib}  ${nm}` : `${t}  ${bib}`;
      elPendingList.appendChild(li);
    });
  }

  // 未送信の件数/リストだけを更新（カメラDOM等は触らない）
  function renderPendingOnly_() {
    const q = loadQueue();
    elPendingCount.textContent = String(q.length);
    elPendingList.innerHTML = "";
    const nameMap = getRosterNameMap_();
    q.slice(-20).reverse().forEach((it) => {
      const t = formatTimeHHMMSS_(it.scanned_at);
      const bib = String(it.bibNumber);
      const nm = nameMap.get(bib) || "";
      const li = document.createElement("li");
      li.className = "mono";
      li.textContent = nm ? `${t}  ${bib}  ${nm}` : `${t}  ${bib}`;
      elPendingList.appendChild(li);
    });
  }

  // ---- 非ブロッキング confirm モーダル（1回だけ生成して再利用） ----
  let confirmModalEl_ = null;
  let confirmModalMsgEl_ = null;
  let confirmModalOkBtn_ = null;
  let confirmModalCancelBtn_ = null;
  let confirmModalInFlight_ = false;
  let confirmModalPromise_ = null;
  let confirmModalResolve_ = null;

  function ensureConfirmModal_() {
    if (confirmModalEl_) return;
    const overlay = document.createElement("div");
    overlay.id = "confirmModal";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const card = document.createElement("div");
    card.style.background = "#fff";
    card.style.borderRadius = "8px";
    card.style.boxShadow = "0 6px 24px rgba(0,0,0,0.2)";
    card.style.width = "min(90vw, 420px)";
    card.style.maxWidth = "92vw";
    card.style.padding = "16px";
    card.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif";

    const msg = document.createElement("div");
    msg.style.margin = "8px 0 16px";
    msg.style.fontSize = "16px";
    msg.style.lineHeight = "1.4";
    msg.className = "mono";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "12px";
    row.style.justifyContent = "flex-end";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "キャンセル";

    const btnOk = document.createElement("button");
    btnOk.type = "button";
    btnOk.textContent = "OK";
    btnOk.style.background = "#d32f2f";
    btnOk.style.color = "#fff";
    btnOk.style.border = "none";
    btnOk.style.padding = "8px 14px";
    btnOk.style.borderRadius = "6px";

    row.appendChild(btnCancel);
    row.appendChild(btnOk);
    card.appendChild(msg);
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const resolveOnce = (val) => {
      if (!confirmModalInFlight_) return;
      confirmModalInFlight_ = false;
      overlay.style.display = "none";
      try { if (confirmModalResolve_) confirmModalResolve_(val); } finally {
        confirmModalPromise_ = null;
        confirmModalResolve_ = null;
      }
    };

    btnCancel.addEventListener("click", () => resolveOnce(false));
    btnOk.addEventListener("click", () => resolveOnce(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) resolveOnce(false); });
    document.addEventListener("keydown", (e) => {
      if (!confirmModalInFlight_) return;
      if (e.key === "Escape") resolveOnce(false);
      if (e.key === "Enter") resolveOnce(true);
    });

    confirmModalEl_ = overlay;
    confirmModalMsgEl_ = msg;
    confirmModalOkBtn_ = btnOk;
    confirmModalCancelBtn_ = btnCancel;
  }

  function confirmModal(message) {
    ensureConfirmModal_();
    // 二重起動を避ける（メッセージは上書きして同一インスタンスを再利用）
    if (confirmModalInFlight_ && confirmModalPromise_) {
      confirmModalMsgEl_.textContent = String(message || "");
      return confirmModalPromise_;
    }
    confirmModalInFlight_ = true;
    confirmModalMsgEl_.textContent = String(message || "");
    confirmModalEl_.style.display = "flex";
    // iOSでのフォーカス問題回避：明示的にボタンへフォーカスしない
    confirmModalPromise_ = new Promise((resolve) => {
      confirmModalResolve_ = resolve;
    });
    return confirmModalPromise_;
  }

  function addToQueueFromInput() {
    const bib = parseBib(elInput.value);
    if (!bib) {
      elAddResult.textContent = "入力が無効です（例: MST26:021 / 21）";
      return;
    }

    const res = enqueueBib(bib);
    if (!res.ok && res.reason === "duplicate") {
      elAddResult.textContent = `重複のため追加しません: bib=${bib}（未送信 ${res.length}）`;
      elInput.value = "";
      renderPendingOnly_();
      return;
    }
    if (!res.ok) {
      elAddResult.textContent = `追加失敗: bib=${bib}`;
      return;
    }

    elAddResult.textContent = `追加しました: bib=${bib}（未送信 ${res.length}）`;
    elInput.value = "";
    renderPendingOnly_();
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

      renderPendingOnly_();
  
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
    const ok = await confirmModal(`未送信キューを全消去します（${q.length}件）。よいですか？`);
    if (!ok) { elSyncResult.textContent = "キャンセルしました。"; return; }
    try {
      saveQueue([]);
      elSyncResult.textContent = "全消去しました。";
      try { if (window.refreshPendingUI) window.refreshPendingUI(); } catch(_) {}
    } catch (e) {
      elSyncResult.textContent = `全消去でエラー: ${String(e).slice(0, 120)}`;
    } finally {
      try { renderPendingOnly_(); } catch(_) {}
    }
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
    try { renderPendingOnly_(); } catch(_) {}
  }

  // ===== Wire up =====
  function init() {
    renderNet();
    renderState();
    // BUILD版本をフッター的に表示
    try {
      const el = document.createElement("div");
      el.id = "buildInfo";
      el.className = "mono";
      el.style.fontSize = "12px";
      el.style.opacity = "0.7";
      el.style.marginTop = "8px";
      el.textContent = BUILD_VERSION;
      const container = document.body || document.documentElement;
      if (container) container.appendChild(el);
    } catch(_) {}

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
  // スキャン側からも利用できるよう公開
  window.enqueueBib = enqueueBib;
  // 未送信UIの再描画関数（カメラDOMには触らない）を公開
  window.refreshPendingUI = renderPendingOnly_;
})();

// ----- Camera UI + QR scan (CP1) -----
(() => {
  let camStream = null;
  let scanning = false;
  let rafId = null;

  let lastText = "";
  let lastAt = 0;
  const COOLDOWN_MS = 1200;

  // 同一QR保持時の過剰 enqueue を抑制するための保険ガード
  let lastSeenBib_ = "";
  let lastEnqueueAt_ = 0;
  const ENQUEUE_COOLDOWN_MS = 2000; // 同一bibに対する最短間隔

  function $(id) { return document.getElementById(id); }

  let audioCtx_ = null;
  let statusTimer_ = null;

  function warmupAudio_() {
    try {
      if (!audioCtx_) audioCtx_ = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx_.state === "suspended") audioCtx_.resume();
    } catch (_) {}
  }

  // QRテキストから bib のみを抽出（優先: コロン後の数字 -> 末尾の数字）
  function extractBibFromQRText_(raw) {
    const t = String(raw || "");
    // 優先: コロンの後ろの数字 MST26:7 / MST26:007
    let m = t.match(/:\s*([0-9]{1,6})/);
    if (m) return m[1];
    // 次善: 末尾側の連続数字  ... -> 7 / 007
    m = t.match(/([0-9]{1,6})\D*$/);
    if (m) return m[1];
    return null;
  }

  function beep_() {
    try {
      warmupAudio_();
      if (!audioCtx_) return;
  
      const o = audioCtx_.createOscillator();
      const g = audioCtx_.createGain();
  
      o.type = "sine";
      o.frequency.value = 1500; // ←「ピッ」寄り（好みで 1200〜2000 に調整OK）
  
      const now = audioCtx_.currentTime;
  
      // ポップ防止：0→上げる→下げる（短いエンベロープ）
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
  
      o.connect(g);
      g.connect(audioCtx_.destination);
  
      o.start(now);
      o.stop(now + 0.11);
    } catch (_) {}
  }

  function setStatusTemp_(msg, ms = 1000) {
    try {
      const statusEl = $("camStatus");
      if (statusEl) statusEl.textContent = msg;
      if (statusTimer_) clearTimeout(statusTimer_);
      statusTimer_ = setTimeout(() => {
        const el = $("camStatus");
        if (el) el.textContent = "待機中…";
      }, ms);
    } catch (_) {}
  }

  // UIクリック合成のための探索/正規化関数は不要になりました（スキャンは enqueueBib を直接呼びます）

  // 以前のUIクリック合成経路は撤去しました（スキャンは enqueueBib を直接呼びます）

  function stopScanLoop() {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function scheduleNext_() {
    rafId = requestAnimationFrame(scanLoop);
  }


  function scanLoop() {
    if (!scanning) return;

    const video = $("camVideo");
    const canvas = $("camCanvas");
    const statusEl = $("camStatus");

    try {
      if (!video || !canvas) return;

      // video の準備待ち
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

      const w = video.videoWidth;
      const h = video.videoHeight;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.min(vw, vh);
      const sx = Math.floor((vw - side) / 2);
      const sy = Math.floor((vh - side) / 2);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, camCanvas.width, camCanvas.height);

      const img = ctx.getImageData(0, 0, w, h);
      const qr = (window.jsQR)
        ? window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })
        : null;

      const now = Date.now();
      const hasQR = !!(qr && qr.data);

      if (hasQR) {
        const text = String(qr.data).trim();
        const bibRaw = extractBibFromQRText_(text);
        if (!bibRaw) {
          if (statusEl) statusEl.textContent = `無効: ${text}`;
          return;
        }
        const bibNum = parseInt(bibRaw, 10);
        const bibKey = String(bibNum);

        // 追加の保険：同一QR保持中に連打しない
        if (bibKey === lastSeenBib_ && (now - lastEnqueueAt_) < ENQUEUE_COOLDOWN_MS) {
          if (statusEl) statusEl.textContent = "待機中…";
          return;
        }

        // UIクリック合成は行わず、直接 enqueueBib を呼ぶ
        let res = { ok: false, reason: "unknown" };
        try {
          if (window.enqueueBib) {
            res = window.enqueueBib(bibNum);
          }
        } catch (_) { res = { ok: false, reason: "error" }; }

        if (res && res.ok) {
          beep_();
          lastSeenBib_ = bibKey;
          lastEnqueueAt_ = now;
          try { if (window.refreshPendingUI) window.refreshPendingUI(); } catch(_) {}
          // 読取成功: 名簿があれば名前も表示
          const nameMap = getRosterNameMap_();
          const nm = nameMap.get(bibKey) || "";
          setStatusTemp_(nm ? `読取: ${bibKey} ${nm}` : `読取: ${bibKey}`, 1000);
        } else {
          const reason = (res && res.reason) || "error";
          if (reason === "duplicate" || reason === "locked") {
            setStatusTemp_(`重複: ${bibKey}`, 1000);
          } else if (reason === "invalid") {
            setStatusTemp_("無効", 1000);
          } else {
            setStatusTemp_(`追加失敗: ${bibKey}`, 1000);
          }
        }
      }

      // ARMEDゲートを廃止したため、QR無し時の再ARM処理は不要
    } catch (e) {
      // 読み取り失敗は握りつぶして次フレームへ（止まるのが一番困る）
    } finally {
      scheduleNext_();
    }
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
      warmupAudio_();

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
