// ==UserScript==
// @name         Underworld Legacy Bot - Licensed Loader
// @namespace    https://underworldlegacy.com/
// @version      2.2.6
// @description  Licensed server-driven Underworld Legacy bot. Full automation suite with remote licence control and local-only credentials/restart data.
// @author       Aphotic
// @updateURL    https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js
// @downloadURL  https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js
// @match        https://underworldlegacy.com/*
// @match        https://www.underworldlegacy.com/*
// @match        http://localhost:3000/*
// @match        http://127.0.0.1:3000/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      ul-bot-license.ugarchive.workers.dev
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = 'Underworld Legacy Bot';
  const SCRIPT_VERSION = '2.2.6';
  const WORKER_URL = 'https://ul-bot-license.ugarchive.workers.dev';
  const LOADER_UPDATE_URL = 'https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js';
  const PLANNER_SOCKET_URL = WORKER_URL.replace(/^http/, 'ws') + '/api/v2/socket';
  const LICENCE_FEATURE = Object.freeze({
    FAST_JAIL_STREAM: 'fast-jail-stream',
  });
  const PLANNER_KEEPALIVE_MS = 30_000;
  const PLANNER_REQUEST_TIMEOUT_MS = 15_000;
  const PLANNER_RECONNECT_MAX_MS = 15_000;
  const SESSION_REFRESH_MARGIN_MS = 6 * 60_000;
  const LICENCE_RETRY_MAX_MS = 60_000;
  const CONTROLLER_LOCK = 'ul-cloud-bot-controller-v1';
  const CRIME_JAIL_POLL_MS = 5_000;
  const JAIL_BUST_MIN_INTERVAL_MS = 205;
  const JAIL_RELEASE_POLL_MS = 3_000;
  const JAIL_RELEASE_CONFIRM_DELAY_MS = 3_000;
  const JAIL_STREAM_FALLBACK_POLL_MS = 2_000;
  const JAIL_POLL_FALLBACK_MS = 1_000;
  const ONLINE_DISCOVERY_MS = 2 * 60_000;
  const GANG_DISCOVERY_MS = 10 * 60_000;
  const PRESTIGE_CHECK_MS = 3 * 60_000;
  const SEARCH_MIN_RENEW_LEAD_SECONDS = 30 * 60;
  const SHOOT_WINDOW_MS = 10_000;
  const SHOOT_WINDOW_LIMIT = 49;
  // Match the standalone bot's production-safe headroom below the game's
  // 15 req/s global flood bucket and 60-request burst.
  const REQUEST_REFILL_PER_SECOND = 13;
  const REQUEST_BURST_CAPACITY = 48;
  const REQUEST_PRIORITY = Object.freeze({ ACTION: 0, RAPID: 1, NORMAL: 2, BACKGROUND: 3 });
  const ACTION_RATE_LIMITS = Object.freeze({
    shoot: { limit: 49, windowMs: 10_000 },
    prepare: { limit: 98, windowMs: 10_000 },
    search: { limit: 98, windowMs: 10_000 },
    crime: { limit: 98, windowMs: 10_000 },
    gta: { limit: 98, windowMs: 10_000 },
    jailBust: { limit: 5, windowMs: 1_000 },
    quicktrade: { limit: 98, windowMs: 10_000 },
    retrieve: { limit: 19, windowMs: 30_000 },
    jailRead: { limit: 110, windowMs: 10_000, minIntervalMs: 92 },
  });

  const KEYS = Object.freeze({
    licence: 'ul_cloud_licence_v1',
    deviceId: 'ul_cloud_device_id_v1',
    deviceLabel: 'ul_cloud_device_label_v1',
    settings: 'ul_cloud_full_settings_v1',
    uiTab: 'ul_cloud_full_ui_tab_v1',
    playerList: 'ul_cloud_full_player_list_v1',
    playerActions: 'ul_cloud_full_player_actions_v1',
    quicktrade: 'ul_cloud_full_quicktrade_v1',
    restart: 'ul_cloud_full_restart_v1',
    restartProgress: 'ul_cloud_full_restart_progress_v1',
    deathStop: 'ul_cloud_full_death_stop_v1',
    login: 'ul_cloud_full_login_v1',
    collapsed: 'ul_cloud_full_collapsed_v1',
    botTab: 'ul_cloud_full_bot_tab_v1',
  });

  const AUTO_GUNS = Object.freeze([
    { id: 1, name: 'Glock 17', price: 1_000_000 },
    { id: 2, name: 'SIG P226', price: 2_500_000 },
    { id: 3, name: 'Uzi', price: 5_000_000 },
    { id: 4, name: 'Benelli M4', price: 7_500_000 },
    { id: 5, name: 'MP5', price: 10_000_000 },
    { id: 6, name: 'G36C', price: 12_500_000 },
    { id: 7, name: 'M4A1', price: 15_000_000 },
    { id: 8, name: 'SCAR-L', price: 20_000_000 },
    { id: 9, name: 'AK-47', price: 30_000_000 },
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    crimes: true,
    gta: true,
    jailBust: false,
    melt: false,
    meltCommon: true,
    meltRare: false,
    meltTuners: false,
    repairBeforeMelt: false,
    drugs: false,
    drugRepairDamage: 60,
    autoRank: false,
    autoPrestige: false,
    discoverPlayers: false,
    searchPlayers: false,
    beamTravelMode: 'auto',
    autoBuyGun: false,
    autoGunId: 9,
  });

  if (globalThis.__UL_CLOUD_FULL_UI_SHELL_STARTED__) return;
  globalThis.__UL_CLOUD_FULL_UI_SHELL_STARTED__ = true;

  let token = '';
  let tokenExpiresAt = 0;
  let authorisePromise = null;
  let licenceRetryTimer = null;
  let licenceRetryDelayMs = 2_000;
  let plannerSocket = null;
  let plannerSocketReady = false;
  let plannerSocketOpening = null;
  let plannerSocketOpeningReject = null;
  let plannerSocketExpectedClose = false;
  let plannerSocketReconnectTimer = null;
  let plannerSocketPingTimer = null;
  let plannerSocketLeaseTimer = null;
  let plannerSocketStableTimer = null;
  let plannerSocketReconnectDelayMs = 1_000;
  let plannerNextRequestId = 1;
  const plannerPending = new Map();
  let schedulerWatchdogTimer = null;
  let automationTimer = null;
  let controllerRequested = false;
  let controllerRetryTimer = null;
  let releaseController = null;
  let jailEventSource = null;
  let jailReconnectTimer = null;
  let jailStreamReady = false;
  let jailStreamReconnectDelayMs = 1_000;
  let jailLatestStreamInmates = [];
  let jailStreamBustTimer = null;
  let restartTimer = null;
  let loginRunning = false;
  let state = {
    settings: loadSettings(),
    uiTab: validTab(GM_getValue(KEYS.uiTab, 'actions')),
    players: loadPlayers(),
    playerActions: loadPlayerActions(),
    qt: loadQuicktrade(),
    restart: loadRestart(),
    login: loadLogin(),
    collapsed: GM_getValue(KEYS.collapsed, false) === true,
    botTab: GM_getValue(KEYS.botTab, false) === true,
    licenceStatus: 'Checking licence…',
    licenceError: false,
    licenceCode: '',
    updateStatus: `Loader v${SCRIPT_VERSION} · press Check for updates`,
    updateChecking: false,
    updateAvailable: false,
    updateRequired: false,
    updateLatestVersion: '',
    updateMinVersion: '',
    updateUrl: LOADER_UPDATE_URL,
    updateLastCheckedAt: 0,
    licenceFeatures: new Set(),
    controller: false,
    currentAction: 'Stopped',
    crimesRunning: false,
    crimesDueAt: 0,
    gtaRunning: false,
    gtaDueAt: 0,
    jailBustRunning: false,
    jailReadRunning: false,
    jailBustDueAt: 0,
    lastJailBustAt: 0,
    meltRunning: false,
    meltDueAt: 0,
    meltStatus: 'Melt ready · start the bot to run it',
    drugsRunning: false,
    drugsDueAt: 0,
    drugStatus: 'Drugs ready · start the bot to run them',
    inJail: false,
    jailMarkedAt: 0,
    jailViewerUsername: '',
    jailViewerBustToken: '',
    crimeStatus: 'Crimes ready · start the bot to run them',
    gtaStatus: 'GTA ready · start the bot to run it',
    jailStatus: 'Jailbust ready · start the bot to run it',

    authRequired: false,
    loginStatus: '',
    loginProbeDueAt: 0,
    loginAutoAttempted: false,
    stoppedForDeath: GM_getValue(KEYS.deathStop, false) === true,

    autoRankRunning: false,
    autoRankDueAt: 0,
    autoRankActive: false,
    autoRankEndsAt: 0,
    autoRankControls: { crimes: false, gta: false, melt: false, drugs: false },
    autoRankStatus: 'Auto Rank ready · start the bot to check it',

    prestigeRunning: false,
    prestigeCommitting: false,
    prestigeDueAt: 0,
    prestigeComplete: false,
    prestigeStatus: 'Auto-prestige ready · start the bot to check it',

    autoGunRunning: false,
    autoGunDueAt: 0,
    autoGunStatus: 'Auto-buy gun ready · start the bot to check it',

    playerDiscoveryRunning: false,
    playerDiscoveryDueAt: 0,
    gangDiscoveryRunning: false,
    gangDiscoveryDueAt: 0,
    playerDiscoveryStatus: 'Player discovery ready · start the bot to run it',
    viewerUsername: '',

    playerSearchRunning: false,
    playerSearchDueAt: 0,
    playerSearchStatus: 'Player searching ready · start the bot to run it',
    playerSearchBackoff: new Map(),
    searchesInFlight: new Map(),
    searchData: null,
    searchDataLoadedAt: 0,
    killData: null,
    killDataLoadedAt: 0,
    killDataRevision: 0,

    combatRunning: false,
    combatDueAt: 0,
    combatStatus: 'Kill and Beam idle',
    activeBodyguard: null,
    shotTimes: [],
    deathProtected: false,
    deathProtectionCheckedAt: 0,
    deathProtectionSecondsRemaining: 0,

    qtRunning: false,
    qtDueAt: 0,
    qtStatus: 'Quicktrade ready · start the bot to watch it',
    qtLastKind: '',
    qtCatalog: [],
    qtOfferRetryAt: new Map(),

    restartProgress: loadRestartProgress(),
    restartRunning: false,
    globalRateLimitedUntil: 0,
    actionTails: new Map(),
    automationEpoch: 0,
    featureEpochs: Object.create(null),

    logs: [],
  };

  const requestLimiter = {
    tokens: REQUEST_BURST_CAPACITY,
    lastRefillAt: Date.now(),
    sequence: 0,
    queue: [],
    timer: null,
    buckets: new Map(),
  };

  class ActionCancelledError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ActionCancelledError';
      this.cancelled = true;
    }
  }

  ensureDeviceIdentity();
  createPanel();
  startRestartWatcher();
  startSchedulerWatchdog();
  void boot();

  async function boot() {
    const licence = String(GM_getValue(KEYS.licence, '') || '').trim();
    if (!licence) {
      state.licenceStatus = 'Licence required — open Login tab';
      state.licenceError = true;
      render();
      return;
    }
    await authorise();
  }

  function licenceFailureIsPermanent(error) {
    return ['disabled', 'device_removed', 'invalid_licence', 'device_limit', 'update_required'].includes(String(error?.code || ''));
  }

  function clearLicenceRetry() {
    if (licenceRetryTimer) clearTimeout(licenceRetryTimer);
    licenceRetryTimer = null;
  }

  function scheduleLicenceRetry() {
    if (licenceRetryTimer || licenceFailureIsPermanent({ code: state.licenceCode })) return;
    const wait = licenceRetryDelayMs;
    licenceRetryDelayMs = Math.min(LICENCE_RETRY_MAX_MS, Math.max(2_000, licenceRetryDelayMs * 2));
    licenceRetryTimer = setTimeout(() => {
      licenceRetryTimer = null;
      void authorise();
    }, wait);
  }

  function revokeLicenceLocally(error) {
    token = '';
    tokenExpiresAt = 0;
    state.licenceFeatures.clear();
    state.licenceCode = String(error?.code || 'disabled');
    state.licenceStatus = friendly(error);
    state.licenceError = true;
    if (state.settings.enabled) {
      state.settings.enabled = false;
      saveSettings();
    }
    stopAutomation();
    stopJailStream();
    closePlannerSocket('licence rejected', true);
    log(`Licence disabled: ${state.licenceStatus}`, 'error');
    render();
  }

  async function authorise() {
    if (authorisePromise) return authorisePromise;
    const licence = String(GM_getValue(KEYS.licence, '') || '').trim();
    if (!licence) {
      token = '';
      tokenExpiresAt = 0;
      state.licenceCode = 'missing_licence';
      state.licenceStatus = 'Licence required — open Login tab';
      state.licenceError = true;
      render();
      return null;
    }

    authorisePromise = (async () => {
      state.licenceStatus = 'Checking licence…';
      state.licenceError = false;
      render();
      try {
        const data = await requestJson('/api/v1/session', {
          method: 'POST',
          body: {
            licence,
            deviceId: GM_getValue(KEYS.deviceId, ''),
            deviceLabel: GM_getValue(KEYS.deviceLabel, 'Browser'),
            loaderVersion: SCRIPT_VERSION,
          },
        });
        token = String(data.token || '');
        tokenExpiresAt = Number(data.expiresAt) || 0;
        applyVersionInfo(data);
        state.licenceCode = '';
        state.licenceStatus = `Licence active · ${GM_getValue(KEYS.deviceLabel, 'Browser')}`;
        state.licenceError = false;
        licenceRetryDelayMs = 2_000;
        clearLicenceRetry();
        log('Licence authorised', 'ok');
        if (state.botTab) startControllerElection();
        syncPlannerSocket();
        wakeAutomation();
        syncJailStream();
        render();
        return data;
      } catch (error) {
        token = '';
        tokenExpiresAt = 0;
        if (error?.body && typeof error.body === 'object') applyVersionInfo(error.body);
        closePlannerSocket('licence authorisation failed', true);
        state.licenceCode = String(error?.code || '');
        if (licenceFailureIsPermanent(error)) {
          revokeLicenceLocally(error);
        } else {
          state.licenceStatus = `Licence service unavailable · retrying (${friendly(error)})`;
          state.licenceError = true;
          scheduleLicenceRetry();
          render();
        }
        throw error;
      }
    })().finally(() => { authorisePromise = null; });

    try { return await authorisePromise; }
    catch { return null; }
  }

  class PlannerConnectionReset extends ActionCancelledError {
    constructor(message = 'Planner connection changed; refreshing live state') {
      super(message);
      this.name = 'PlannerConnectionReset';
    }
  }

  function plannerError(payload) {
    const error = new Error(payload?.message || 'Planner error');
    error.status = Number(payload?.status) || 0;
    error.code = String(payload?.code || '');
    return error;
  }

  function rejectPlannerPending(message = 'Planner connection changed; refreshing live state') {
    for (const [, pending] of plannerPending) {
      clearTimeout(pending.timer);
      pending.reject(new PlannerConnectionReset(message));
    }
    plannerPending.clear();
  }

  function clearPlannerTimers() {
    if (plannerSocketPingTimer) clearInterval(plannerSocketPingTimer);
    if (plannerSocketLeaseTimer) clearTimeout(plannerSocketLeaseTimer);
    if (plannerSocketStableTimer) clearTimeout(plannerSocketStableTimer);
    plannerSocketPingTimer = null;
    plannerSocketLeaseTimer = null;
    plannerSocketStableTimer = null;
  }

  function closePlannerSocket(reason = 'closed', expected = true) {
    plannerSocketExpectedClose = expected;
    clearPlannerTimers();
    if (plannerSocketReconnectTimer) clearTimeout(plannerSocketReconnectTimer);
    plannerSocketReconnectTimer = null;
    rejectPlannerPending(reason);
    const socket = plannerSocket;
    plannerSocket = null;
    plannerSocketReady = false;
    if (plannerSocketOpeningReject) {
      try { plannerSocketOpeningReject(new PlannerConnectionReset(reason)); } catch {}
    }
    plannerSocketOpeningReject = null;
    plannerSocketOpening = null;
    if (socket && socket.readyState <= WebSocket.OPEN) {
      try { socket.close(1000, String(reason).slice(0, 120)); } catch {}
    }
  }

  function schedulePlannerReconnect() {
    if (!plannerSocketNeeded() || plannerSocketReconnectTimer || plannerSocketOpening || plannerSocketReady) return;
    const wait = plannerSocketReconnectDelayMs;
    plannerSocketReconnectDelayMs = Math.min(PLANNER_RECONNECT_MAX_MS, Math.max(1_000, plannerSocketReconnectDelayMs * 2));
    plannerSocketReconnectTimer = setTimeout(() => {
      plannerSocketReconnectTimer = null;
      if (plannerSocketNeeded()) void ensurePlannerSocket().catch(() => {});
    }, wait);
  }

  async function handlePlannerAuthError(message) {
    applyVersionInfo(message);
    const error = plannerError(message);
    closePlannerSocket('planner authentication rejected', true);
    if (licenceFailureIsPermanent(error)) {
      revokeLicenceLocally(error);
      return;
    }
    if (['expired_session', 'missing_session'].includes(error.code)) {
      token = '';
      tokenExpiresAt = 0;
      await authorise();
      if (plannerSocketNeeded()) schedulePlannerReconnect();
      return;
    }
    state.licenceStatus = `Planner connection rejected · retrying (${friendly(error)})`;
    state.licenceError = true;
    schedulePlannerReconnect();
    renderStatusOnly();
  }

  function plannerSocketNeeded() {
    return Boolean(
      token &&
      state.botTab &&
      state.controller &&
      (state.settings.enabled || state.restartProgress.active)
    );
  }

  function syncPlannerSocket() {
    if (!plannerSocketNeeded()) {
      if (plannerSocket || plannerSocketOpening) closePlannerSocket('automation inactive', true);
      return;
    }
    if (!plannerSocketReady && !plannerSocketOpening) void ensurePlannerSocket().catch(() => {});
  }

  async function rotatePlannerSocket() {
    if (!plannerSocketNeeded()) return;
    closePlannerSocket('licence lease rotation', true);
    await ensurePlannerSocket().catch(() => {});
  }

  async function ensurePlannerSocket() {
    if (!plannerSocketNeeded()) throw new PlannerConnectionReset('Licensed controller is not active');
    if (plannerSocketReady && plannerSocket && plannerSocket.readyState === WebSocket.OPEN) return plannerSocket;
    if (plannerSocketOpening) return plannerSocketOpening;

    if (!token || !Number.isFinite(tokenExpiresAt) || tokenExpiresAt - Date.now() < SESSION_REFRESH_MARGIN_MS) {
      await authorise();
      if (!token) throw new PlannerConnectionReset('Licence session is unavailable');
      if (plannerSocketReady && plannerSocket && plannerSocket.readyState === WebSocket.OPEN) return plannerSocket;
      if (plannerSocketOpening) return plannerSocketOpening;
    }

    plannerSocketOpening = new Promise((resolve, reject) => {
      let settled = false;
      let authTimer = null;
      plannerSocketOpeningReject = reject;
      const socket = new WebSocket(PLANNER_SOCKET_URL);
      plannerSocket = socket;
      plannerSocketReady = false;
      plannerSocketExpectedClose = false;
      const failOpening = (error) => {
        if (settled) return;
        settled = true;
        if (authTimer) clearTimeout(authTimer);
        authTimer = null;
        plannerSocketOpeningReject = null;
        plannerSocketOpening = null;
        reject(error);
      };

      socket.onopen = () => {
        authTimer = setTimeout(() => {
          if (socket !== plannerSocket || plannerSocketReady) return;
          failOpening(new PlannerConnectionReset('Planner authentication timed out'));
          try { socket.close(4000, 'authentication timeout'); } catch {}
        }, PLANNER_REQUEST_TIMEOUT_MS);
        try {
          socket.send(JSON.stringify({ type: 'auth', token, loaderVersion: SCRIPT_VERSION }));
        } catch (error) {
          failOpening(error);
        }
      };

      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(String(event.data || '{}')); }
        catch { return; }

        if (message.type === 'ready') {
          if (socket !== plannerSocket) return;
          applyVersionInfo(message);
          plannerSocketReady = true;
          if (authTimer) clearTimeout(authTimer);
          authTimer = null;
          state.licenceStatus = `Licence active · ${GM_getValue(KEYS.deviceLabel, 'Browser')} · planner connected`;
          state.licenceError = false;
          clearPlannerTimers();
          plannerSocketStableTimer = setTimeout(() => {
            if (plannerSocket === socket && plannerSocketReady && socket.readyState === WebSocket.OPEN) {
              plannerSocketReconnectDelayMs = 1_000;
            }
          }, 60_000);
          plannerSocketPingTimer = setInterval(() => {
            if (plannerSocket === socket && plannerSocketReady && socket.readyState === WebSocket.OPEN) {
              try { socket.send(JSON.stringify({ type: 'ping', at: Date.now() })); } catch {}
            }
          }, PLANNER_KEEPALIVE_MS);
          const leaseMs = Math.max(20_000, Number(message.leaseMs) || 5 * 60_000);
          plannerSocketLeaseTimer = setTimeout(() => { void rotatePlannerSocket(); }, Math.max(5_000, leaseMs - 1_000));
          if (!settled) {
            settled = true;
            plannerSocketOpeningReject = null;
            plannerSocketOpening = null;
            resolve(socket);
          }
          wakeAutomation();
          restartTick();
          renderStatusOnly();
          return;
        }

        if (message.type === 'auth-error') {
          void handlePlannerAuthError(message);
          failOpening(plannerError(message));
          return;
        }

        if (message.type === 'lease-expired') {
          plannerSocketExpectedClose = true;
          return;
        }

        if (message.type === 'plan-result') {
          const key = String(message.id ?? '');
          const pending = plannerPending.get(key);
          if (!pending) return;
          plannerPending.delete(key);
          clearTimeout(pending.timer);
          if (Number(message.generation) !== pending.generation || pending.generation !== state.automationEpoch) {
            pending.reject(new ActionCancelledError('Stale planner answer ignored'));
            return;
          }
          if (message.error) pending.reject(plannerError(message.error));
          else pending.resolve(message.result && typeof message.result === 'object' ? message.result : {});
          return;
        }
      };

      socket.onerror = () => {
        if (!settled) failOpening(new PlannerConnectionReset('Planner connection failed'));
        if (socket === plannerSocket) {
          plannerSocketExpectedClose = true;
          try { socket.close(); } catch {}
        }
      };

      socket.onclose = (event) => {
        if (authTimer) clearTimeout(authTimer);
        authTimer = null;
        if (socket !== plannerSocket) return;
        const expected = plannerSocketExpectedClose || event.code === 4001 || event.code === 1000;
        plannerSocket = null;
        plannerSocketReady = false;
        clearPlannerTimers();
        rejectPlannerPending('Planner connection changed; refreshing live state');
        if (!settled) failOpening(new PlannerConnectionReset(`Planner socket closed (${event.code || 0})`));
        plannerSocketOpeningReject = null;
        plannerSocketOpening = null;
        plannerSocketExpectedClose = false;
        if (plannerSocketNeeded()) {
          if (!expected) {
            state.licenceStatus = 'Planner connection interrupted · reconnecting';
            state.licenceError = true;
            renderStatusOnly();
          }
          schedulePlannerReconnect();
        }
      };
    });

    return plannerSocketOpening;
  }

  async function plannerRequest(route, options = {}) {
    if (!automationAllowed()) throw new ActionCancelledError('Automation stopped');
    const generation = state.automationEpoch;
    const body = options && typeof options === 'object' && options.body !== undefined ? options.body : {};
    const socket = await ensurePlannerSocket();
    if (generation !== state.automationEpoch || !automationAllowed()) throw new ActionCancelledError('Automation state changed');
    if (!plannerSocketReady || socket !== plannerSocket || socket.readyState !== WebSocket.OPEN) {
      throw new PlannerConnectionReset();
    }

    const id = String(plannerNextRequestId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        plannerPending.delete(id);
        reject(new PlannerConnectionReset('Planner response timed out; refreshing live state'));
        if (plannerSocket === socket) void rotatePlannerSocket();
      }, PLANNER_REQUEST_TIMEOUT_MS);
      plannerPending.set(id, { generation, resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ type: 'plan', id, generation, route, body }));
      } catch {
        clearTimeout(timer);
        plannerPending.delete(id);
        reject(new PlannerConnectionReset());
        if (plannerSocket === socket) void rotatePlannerSocket();
      }
    });
  }

  function createPanel() {
    document.querySelector('#ul-simple-bot')?.remove();
    const host = document.createElement('section');
    host.id = 'ul-simple-bot';
    host.innerHTML = `
      <div class="ul-simple-header">
        <strong>${SCRIPT_NAME} v${SCRIPT_VERSION}</strong>
        <span class="ul-simple-header-actions">
          <button type="button" id="ul-simple-update-header" title="Install the latest loader" hidden>Update</button>
          <button type="button" id="ul-simple-tab-mode" title="Choose whether automation may run in this tab">Use as bot tab</button>
          <button type="button" id="ul-simple-collapse" title="Collapse">−</button>
        </span>
      </div>
      <div id="ul-simple-body">
        <div class="ul-simple-runtime-row">
          <div><div id="ul-simple-status">Loading…</div><div id="ul-cloud-licence-status" class="ul-simple-licence-status"></div></div>
          <button type="button" id="ul-simple-toggle" title="Start or stop licensed automation">Start</button>
        </div>
        <nav class="ul-simple-tabs" role="tablist" aria-label="Bot sections">
          <div class="ul-simple-tab-group" role="group" aria-label="Automation">
            <span class="ul-simple-tab-group-label">Automation</span>
            <div class="ul-simple-tab-group-buttons">
              <button type="button" class="ul-simple-tab" data-tab="actions" role="tab">Actions</button>
              <button type="button" class="ul-simple-tab" data-tab="cars" role="tab">Cars</button>
              <button type="button" class="ul-simple-tab" data-tab="players" role="tab">Players</button>
            </div>
          </div>
          <div class="ul-simple-tab-group" role="group" aria-label="Account and tools">
            <span class="ul-simple-tab-group-label">Account &amp; tools</span>
            <div class="ul-simple-tab-group-buttons ul-simple-tab-group-buttons--tools">
              <button type="button" class="ul-simple-tab" data-tab="quicktrade" role="tab">Trade</button>
              <button type="button" class="ul-simple-tab" data-tab="restart" role="tab">Restart</button>
              <button type="button" class="ul-simple-tab" data-tab="login" role="tab">Login</button>
              <button type="button" class="ul-simple-tab" data-tab="logs" role="tab">Logs</button>
            </div>
          </div>
        </nav>

        <section class="ul-simple-tab-panel" data-tab-panel="actions" role="tabpanel">
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Everyday actions</div>
            <div class="ul-simple-option-grid">
              <label><input type="checkbox" id="ul-simple-crimes"> Crimes</label>
              <label><input type="checkbox" id="ul-simple-gta"> GTA</label>
              <label title="Failed attempts can send your character to jail"><input type="checkbox" id="ul-simple-jailbust"> Jailbust</label>
            </div>
            <div id="ul-simple-crime-status" class="ul-simple-note">Crimes ready · start the bot to run them</div>
            <div id="ul-simple-gta-status" class="ul-simple-note">GTA ready · start the bot to run it</div>
            <div id="ul-simple-jail-status" class="ul-simple-note">Jailbust ready · start the bot to run it</div>
          </div>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Progression</div>
            <div class="ul-simple-option-grid">
              <label><input type="checkbox" id="ul-simple-auto-rank"> Auto-renew rank</label>
              <label><input type="checkbox" id="ul-simple-auto-prestige"> Auto-prestige</label>
            </div>
            <div id="ul-simple-auto-rank-status">Ready · start the bot to run it</div>
            <div id="ul-simple-prestige-status">Ready · start the bot to run it</div>
          </div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="cars" role="tabpanel" hidden>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Melting</div>
            <div class="ul-simple-option-row"><label><input type="checkbox" id="ul-simple-melt"> Enable melt</label></div>
            <div class="ul-simple-melt-filter">
              <span>Filter:</span>
              <label><input type="checkbox" id="ul-simple-melt-common"> Common</label>
              <label><input type="checkbox" id="ul-simple-melt-rare"> Rare</label>
              <label><input type="checkbox" id="ul-simple-melt-tuners"> Tuners</label>
              <label><input type="checkbox" id="ul-simple-repair-before-melt"> Repair first</label>
            </div>
            <div class="ul-simple-protected">Always protected: RS Tuner, Mythic, Hyper, Black or Orange. Standard Tuners require the toggle.</div>
            <div id="ul-simple-melt-status" class="ul-simple-note">Melt ready · start the bot to run it</div>
          </div>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Drug run</div>
            <div class="ul-simple-option-row"><label><input type="checkbox" id="ul-simple-drugs"> Enable drugs</label></div>
            <div class="ul-simple-drug-settings">Repair favourite car at <input type="number" id="ul-simple-drug-repair-damage" min="1" max="99" step="1"> % damage</div>
            <div class="ul-simple-note">Follows the game's live rotating recommended route and refreshes after market changes.</div>
            <div id="ul-simple-drug-status">Drugs ready · start the bot to run them</div>
          </div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="players" role="tabpanel" hidden>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Discovery</div>
            <div class="ul-simple-player-controls">
              <label><input type="checkbox" id="ul-simple-discover-players"> Discover players</label>
              <label><input type="checkbox" id="ul-simple-search-players"> Search players</label>
            </div>
            <div id="ul-simple-player-status">Ready · start the bot to run it</div>
            <div id="ul-simple-player-search-status">Ready · start the bot to run it</div>
          </div>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Combat setup</div>
            <div class="ul-simple-beam-settings">Beam travel
              <select id="ul-simple-beam-travel"><option value="auto">Auto</option><option value="car">Favourite car</option><option value="airport">Airport</option></select>
            </div>
            <div class="ul-simple-option-row"><label><input type="checkbox" id="ul-simple-auto-gun"> Auto-buy gun when unarmed</label></div>
            <select id="ul-simple-auto-gun-choice" class="ul-simple-wide-select">${AUTO_GUNS.map((g) => `<option value="${g.id}">${g.name} — $${g.price.toLocaleString('en-GB')}</option>`).join('')}</select>
            <div id="ul-simple-auto-gun-status">Ready · start the bot to run it</div>
            <div class="ul-simple-search-warning">Bodyguards uses 1-bullet probes on the owner and lethal shots on found guards. Full kill also kills the owner when affordable. Kill stays in your country; Beam follows.</div>
            <div id="ul-simple-combat-status">Ready · start the bot to run it</div>
          </div>
          <div class="ul-simple-card">
            <div class="ul-simple-section-title">Saved players</div>
            <div class="ul-simple-player-list-wrap">
              <textarea id="ul-simple-player-list" rows="6" spellcheck="false" placeholder="Player names, one per line"></textarea>
              <div class="ul-simple-player-list-actions"><button type="button" id="ul-simple-save-player-list">Save player list</button></div>
              <div class="ul-simple-search-warning">Kill-page searches remove death protection. Automatic searches and combat pause while death protection is active.</div>
            </div>
            <div class="ul-simple-player-actions-head"><span>Player / search</span><span>Kill</span><span>Beam</span><span>Mode</span></div>
            <div id="ul-simple-player-actions"></div>
          </div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="quicktrade" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Buy points</div>
          <label><input type="checkbox" id="ul-simple-qt-points"> Enable points purchasing</label>
          <label class="ul-simple-qt-label">Maximum cash per point<input id="ul-simple-qt-point-price" type="text" inputmode="numeric" placeholder="e.g. 1,000,000"></label>
          <label class="ul-simple-qt-label">Points still to buy<input id="ul-simple-qt-point-quantity" type="text" inputmode="numeric" placeholder="e.g. 1,000"></label>
          <button type="button" id="ul-simple-qt-save-points">Save points limits</button>
          <div id="ul-simple-qt-point-summary" class="ul-simple-qt-note"></div>
          <div class="ul-simple-qt-note">Supports partial point fills and automatic Swiss shortfall withdrawal.</div>
          <div class="ul-simple-section-title">Buy perks</div>
          <label><input type="checkbox" id="ul-simple-qt-perks"> Enable perk purchasing</label>
          <button type="button" id="ul-simple-qt-refresh">Load perk names</button>
          <label class="ul-simple-qt-label">Exact perk name<input id="ul-simple-qt-perk-name" list="ul-simple-qt-catalog" type="text" maxlength="250" placeholder="Select or type a full perk name"></label>
          <datalist id="ul-simple-qt-catalog"></datalist>
          <label class="ul-simple-qt-label">Pay with<select id="ul-simple-qt-currency"><option value="money">Cash</option><option value="points">Points</option></select></label>
          <label class="ul-simple-qt-label">Maximum price for one whole perk listing<input id="ul-simple-qt-perk-price" type="text" inputmode="numeric" placeholder="Whole listing price"></label>
          <label class="ul-simple-qt-label">Number of listings still to buy<input id="ul-simple-qt-perk-quantity" type="text" inputmode="numeric" value="1"></label>
          <button type="button" id="ul-simple-qt-save-rule">Save perk rule</button>
          <div id="ul-simple-qt-rules"></div>
          <div id="ul-simple-qt-status" role="status">Quicktrade ready · start the bot to watch it</div>
          <button type="button" id="ul-simple-qt-clear-pending" hidden>I've checked the transaction — resume Quicktrade</button>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="restart" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Restart after death</div>
          <label class="ul-simple-restart-option"><input type="checkbox" id="ul-simple-restart-enabled"> Automatically create my next character</label>
          <label class="ul-simple-restart-option"><input type="checkbox" id="ul-simple-restart-retrieve"> Retrieve archived Swiss, points and eligible cars</label>
          <div class="ul-simple-restart-note">This remains a local preference. Saved login details and restart usernames are never sent to Cloudflare.</div>
          <label class="ul-simple-restart-option">Username queue — one name per line</label>
          <textarea id="ul-simple-restart-names" rows="7" spellcheck="false" placeholder="YourNextName&#10;AnotherName"></textarea>
          <div class="ul-simple-restart-buttons"><button type="button" id="ul-simple-restart-generate">Generate 100 usernames</button><button type="button" id="ul-simple-restart-save">Save username list</button></div>
          <div class="ul-simple-restart-note">Names need 2–20 letters, numbers, spaces, underscores or hyphens.</div>
          <div id="ul-simple-restart-status">Restart ready · waiting for death</div>
          <button type="button" id="ul-simple-restart-retry" disabled>Retry after checking</button>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="login" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Licence</div>
          <div class="ul-simple-login-note">Your licence is stored only in this Tampermonkey userscript on this browser profile.</div>
          <label class="ul-simple-login-label">Licence key</label>
          <input id="ul-cloud-auth-licence" class="ul-simple-login-input" autocomplete="off" spellcheck="false">
          <label class="ul-simple-login-label">Device name</label>
          <input id="ul-cloud-auth-device" class="ul-simple-login-input" maxlength="80">
          <div class="ul-simple-login-settings-actions"><button type="button" id="ul-cloud-auth-save">Save & activate licence</button><button type="button" id="ul-cloud-auth-clear">Clear licence</button></div>
          <div class="ul-simple-section-title">Loader updates</div>
          <div class="ul-simple-login-note" id="ul-simple-update-status">Loader v${SCRIPT_VERSION} · press Check for updates</div>
          <div class="ul-simple-login-settings-actions"><button type="button" id="ul-simple-update-action">Check for updates</button></div>
          <div class="ul-simple-section-title">Automatic login</div>
          <div class="ul-simple-login-note">Saved only in this userscript's Tampermonkey storage on this browser profile. Login credentials are never sent to Cloudflare.</div>
          <label class="ul-simple-login-label">Email</label>
          <input id="ul-simple-login-email" class="ul-simple-login-input" type="email" autocomplete="off" spellcheck="false" placeholder="you@example.com">
          <label class="ul-simple-login-label">Password</label>
          <input id="ul-simple-login-password" class="ul-simple-login-input" type="password" autocomplete="off" placeholder="Enter password to save/change">
          <label class="ul-simple-login-auto"><input type="checkbox" id="ul-simple-login-auto"> Auto-login when the session expires</label>
          <div class="ul-simple-login-settings-actions"><button type="button" id="ul-simple-login-save">Save locally</button><button type="button" id="ul-simple-login-clear">Clear saved login</button><button type="button" id="ul-simple-login-retry" disabled>Retry now</button></div>
          <div id="ul-simple-login-status">No login saved</div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="logs" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Migration status</div>
          <div class="ul-simple-pacing">Full licensed build active. Credentials and restart usernames stay local; gameplay planning is requested from your Cloudflare Worker. No downloaded code or eval is used.</div>
          <div class="ul-simple-section-title">Recent activity</div>
          <div id="ul-simple-last">None yet</div>
          <div id="ul-simple-logs"></div>
        </section>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      #ul-simple-bot{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(380px,calc(100vw - 24px));height:min(600px,calc(100vh - 24px));height:min(600px,calc(100dvh - 24px));display:flex;flex-direction:column;overflow:hidden;color:#e8edf2;background:#101316;border:1px solid #3b434b;border-radius:10px;box-shadow:0 14px 40px #0009,0 2px 8px #0008;font:12px/1.4 Arial,sans-serif}
      #ul-simple-bot.collapsed{height:38px!important;min-height:38px!important;max-height:38px!important}#ul-simple-bot *{box-sizing:border-box}
      #ul-simple-bot .ul-simple-header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px;padding:7px 8px 7px 10px;background:linear-gradient(180deg,#252b31,#1b2025);border-bottom:1px solid #343b42;color:#a9d8ff}
      #ul-simple-bot .ul-simple-header strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ul-simple-header-actions{display:flex;gap:5px;align-items:center}
      #ul-simple-bot button{color:#e9eef3;background:#2b3238;border:1px solid #4a545e;border-radius:5px;padding:4px 8px;cursor:pointer}#ul-simple-bot button:hover:not(:disabled){background:#37414a;border-color:#65727e}#ul-simple-bot button:disabled{opacity:.5;cursor:not-allowed}
      #ul-simple-bot input:focus-visible,#ul-simple-bot textarea:focus-visible,#ul-simple-bot select:focus-visible,#ul-simple-bot button:focus-visible{outline:2px solid #5ca6d8;outline-offset:1px}
      #ul-simple-bot #ul-simple-collapse{width:26px;height:24px;padding:0;font-size:14px}#ul-simple-bot #ul-simple-tab-mode{padding:3px 7px;font-size:10px;white-space:nowrap}#ul-simple-bot #ul-simple-tab-mode.active{color:#b6f2b6;border-color:#4f8158;background:#213126}
      #ul-simple-bot #ul-simple-body[hidden]{display:none!important}#ul-simple-bot #ul-simple-body{min-height:0;flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;background:#111519}
      #ul-simple-bot .ul-simple-runtime-row{flex:0 0 auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;min-height:48px;padding:6px 8px;background:#14191e}#ul-simple-bot #ul-simple-status{color:#ffd36b;overflow-wrap:anywhere}.ul-simple-licence-status{margin-top:2px;color:#9ee7aa;font-size:10px}.ul-simple-licence-status.err{color:#ff9f9f}
      #ul-simple-bot .ul-simple-tabs{flex:0 0 auto;display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.15fr);gap:6px;padding:6px;border-top:1px solid #2d343a;border-bottom:1px solid #2d343a;background:#0d1114}.ul-simple-tab-group{min-width:0}.ul-simple-tab-group-label{display:block;margin:0 2px 4px;color:#75818c;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}.ul-simple-tab-group-buttons{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px}.ul-simple-tab-group-buttons--tools{grid-template-columns:repeat(4,minmax(0,1fr))}
      #ul-simple-bot .ul-simple-tab{min-width:0;padding:6px 2px;border:1px solid transparent;border-radius:5px;background:transparent;color:#aab3bc;font-size:10px;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ul-simple-tab.active{color:#b9e2ff!important;background:#22313d!important;border-color:#37566d!important;box-shadow:inset 0 -2px #6eb7e7}
      #ul-simple-bot .ul-simple-tab-panel{min-height:0;flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:9px 10px 12px;background:#111519}.ul-simple-tab-panel[hidden]{display:none!important}.ul-simple-card{margin:0 0 9px;padding:9px;border:1px solid #2d363e;border-radius:7px;background:#0e1215}.ul-simple-card:last-child{margin-bottom:0}
      .ul-simple-section-title{margin:2px 0 8px;padding:0 0 5px;border-bottom:1px solid #303840;color:#a9d8ff;font-size:11px;font-weight:700;letter-spacing:.15px;text-transform:uppercase}.ul-simple-card .ul-simple-section-title{margin-top:0}.ul-simple-note{margin:6px 0 8px;color:#98a4ae;font-size:10.5px;line-height:1.4}.ul-simple-option-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px;margin-bottom:12px}.ul-simple-option-grid label,.ul-simple-option-row label{display:flex;gap:5px;align-items:center}.ul-simple-option-row{margin-bottom:9px}
      .ul-simple-player-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:8px;padding:6px;border:1px solid #36506a;background:#111b24}.ul-simple-player-controls label{display:flex;gap:4px;align-items:center}.ul-simple-beam-settings{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#bbb}.ul-simple-beam-settings select,.ul-simple-player-mode,.ul-simple-wide-select{color:#eee;background:#1b1b1b;border:1px solid #555;border-radius:4px;padding:4px}.ul-simple-wide-select{width:100%;margin-bottom:6px}
      .ul-simple-melt-filter{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:5px;color:#ccc}.ul-simple-melt-filter label{display:flex;gap:4px;align-items:center}.ul-simple-protected{margin-bottom:8px;padding:5px 6px;border:1px solid #5b4b2c;background:#211c12;color:#ffd36b}.ul-simple-drug-settings{display:flex;gap:4px;align-items:center;color:#bbb;margin-bottom:5px}.ul-simple-drug-settings input{width:48px;padding:3px;color:#eee;background:#1b1b1b;border:1px solid #555}.ul-simple-search-warning{margin-top:5px;color:#ffcb70}
      .ul-simple-player-list-wrap{padding:0}.ul-simple-player-list-wrap textarea{display:block;width:100%;min-height:86px;max-height:180px;resize:vertical;padding:6px;color:#eee;background:#0a0d0f;border:1px solid #46515b;border-radius:5px;font:11px/1.35 monospace}.ul-simple-player-list-actions{display:flex;gap:7px;align-items:center;margin-top:5px}.ul-simple-player-actions-head,.ul-simple-player-action-row{display:grid;grid-template-columns:minmax(0,1fr) 30px 34px 54px;gap:3px;align-items:center}.ul-simple-player-actions-head{padding:3px;color:#999;font-size:10px;text-align:center}.ul-simple-player-actions-head span:first-child{text-align:left}#ul-simple-player-actions{max-height:150px;overflow:auto;border:1px solid #333;border-radius:5px}.ul-simple-player-action-row{padding:4px;border-bottom:1px solid #292929}.ul-simple-player-action-row:last-child{border-bottom:0}.ul-simple-player-action-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ul-simple-player-mode{width:54px;font-size:10px}
      .ul-simple-login-note{margin-bottom:8px;padding:6px;border:1px solid #3a4c5d;background:#111a22;color:#b9cedd}.ul-simple-login-label{display:block;margin:6px 0 3px;color:#bbb}.ul-simple-login-input{display:block;width:100%;padding:6px;color:#eee;background:#0a0d0f;border:1px solid #46515b;border-radius:5px}.ul-simple-login-auto{display:flex;gap:5px;align-items:center;margin:8px 0;color:#ddd}.ul-simple-login-settings-actions{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}.ul-simple-restart-option{display:block;margin:7px 0}.ul-simple-restart-note{color:#bbb;font-size:11px;line-height:1.4;margin:7px 0}#ul-simple-restart-names{width:100%;color:#eee;background:#181818;border:1px solid #555;border-radius:5px;resize:vertical}.ul-simple-restart-buttons{display:flex;flex-wrap:wrap;gap:5px}
      .ul-simple-qt-label{display:block;margin:6px 0;color:#bbb}.ul-simple-qt-label input,.ul-simple-qt-label select{display:block;width:100%;padding:6px;color:#eee;background:#0a0d0f;border:1px solid #46515b;border-radius:5px}.ul-simple-qt-note{color:#aaa;font-size:11px;margin:7px 0}.ul-simple-qt-rule{padding:7px 0;border-bottom:1px solid #444;overflow-wrap:anywhere}.ul-simple-qt-rule small{display:block;margin:4px 0}.ul-simple-qt-rule button{margin-right:5px}#ul-simple-qt-status{color:#ffd36b;margin:8px 0;overflow-wrap:anywhere}.ul-simple-pacing{color:#bbb;margin-bottom:12px}#ul-simple-last{padding:7px;background:#0f1316;border:1px solid #303840;border-radius:6px;color:#ddd}#ul-simple-logs{max-height:280px;overflow:auto;margin-top:6px;padding-right:2px;color:#aaa}.ul-simple-log{padding:2px 0;border-bottom:1px dotted #333}.ul-simple-log.ok{color:#91df91}.ul-simple-log.warn{color:#ffd36b}.ul-simple-log.error{color:#ff9090}
    `;
    document.head.appendChild(style);
    document.body.appendChild(host);
    bindPanel(host);
    render();
  }

  function bindPanel(host) {
    for (const tab of host.querySelectorAll('.ul-simple-tab')) {
      tab.addEventListener('click', () => {
        state.uiTab = validTab(tab.dataset.tab);
        GM_setValue(KEYS.uiTab, state.uiTab);
        render();
      });
    }

    host.querySelector('#ul-simple-collapse').addEventListener('click', () => {
      state.collapsed = !state.collapsed;
      GM_setValue(KEYS.collapsed, state.collapsed);
      render();
    });
    host.querySelector('#ul-simple-tab-mode').addEventListener('click', () => setBotTab(!state.botTab));
    host.querySelector('#ul-simple-update-header').addEventListener('click', () => {
      if (state.updateAvailable || state.updateRequired) openLoaderUpdate();
      else void checkForUpdates(true);
    });

    host.querySelector('#ul-simple-toggle').addEventListener('click', () => {
      if (!token) return openTab('login');
      if (state.restartProgress.active) {
        cancelRestart();
        state.currentAction = 'Automatic restart stopped';
        log('Automatic restart stopped', 'info');
        render();
        return;
      }
      if (state.stoppedForDeath) {
        void manualDeathRecheck();
        return;
      }
      state.settings.enabled = !state.settings.enabled;
      if (state.settings.enabled) resetAllDue();
      saveSettings();
      log(state.settings.enabled ? 'Bot started' : 'Bot stopped', state.settings.enabled ? 'ok' : 'info');
      if (!state.settings.enabled) stopAutomation();
      syncJailStream();
      wakeAutomation();
      render();
    });

    const map = {
      'ul-simple-crimes':'crimes',
      'ul-simple-gta':'gta',
      'ul-simple-jailbust':'jailBust',
      'ul-simple-auto-rank':'autoRank',
      'ul-simple-auto-prestige':'autoPrestige',
      'ul-simple-melt':'melt',
      'ul-simple-melt-common':'meltCommon',
      'ul-simple-melt-rare':'meltRare',
      'ul-simple-melt-tuners':'meltTuners',
      'ul-simple-repair-before-melt':'repairBeforeMelt',
      'ul-simple-drugs':'drugs',
      'ul-simple-discover-players':'discoverPlayers',
      'ul-simple-search-players':'searchPlayers',
      'ul-simple-auto-gun':'autoBuyGun',
    };
    for (const [id,key] of Object.entries(map)) {
      host.querySelector(`#${id}`).addEventListener('change', (event) => {
        state.settings[key] = event.target.checked;
        if (key === 'crimes') state.crimesDueAt = 0;
        if (key === 'gta') state.gtaDueAt = 0;
        if (key === 'jailBust') { state.jailBustDueAt = 0; syncJailStream(); }
        if (['melt','meltCommon','meltRare','meltTuners','repairBeforeMelt'].includes(key)) state.meltDueAt = 0;
        if (key === 'drugs') state.drugsDueAt = 0;
        if (key === 'autoRank') state.autoRankDueAt = 0;
        if (key === 'autoPrestige') { state.prestigeDueAt = 0; state.prestigeComplete = false; }
        if (key === 'autoBuyGun') state.autoGunDueAt = 0;
        if (key === 'discoverPlayers') { state.playerDiscoveryDueAt = 0; state.gangDiscoveryDueAt = 0; }
        if (key === 'searchPlayers') state.playerSearchDueAt = 0;
        saveSettings();
        wakeAutomation();
        render();
      });
    }

    host.querySelector('#ul-simple-drug-repair-damage').addEventListener('change', (event) => {
      state.settings.drugRepairDamage = clampInt(event.target.value, 1, 99, 60);
      state.drugsDueAt = 0;
      state.combatDueAt = 0;
      saveSettings();
      wakeAutomation();
      render();
    });
    host.querySelector('#ul-simple-beam-travel').addEventListener('change', (event) => {
      state.settings.beamTravelMode = ['auto','car','airport'].includes(event.target.value) ? event.target.value : 'auto';
      state.combatDueAt = 0;
      saveSettings();
      wakeAutomation();
    });
    host.querySelector('#ul-simple-auto-gun-choice').addEventListener('change', (event) => {
      state.settings.autoGunId = clampInt(event.target.value, 1, 9, 9);
      state.autoGunDueAt = 0;
      saveSettings();
      wakeAutomation();
    });

    host.querySelector('#ul-simple-save-player-list').addEventListener('click', () => {
      state.players = sanitisePlayers(host.querySelector('#ul-simple-player-list').value.split(/\r?\n|,/));
      GM_setValue(KEYS.playerList, state.players);
      state.playerSearchDueAt = 0;
      state.combatDueAt = 0;
      renderPlayerActions();
      log(`Saved ${state.players.length} player${state.players.length===1?'':'s'}`, 'ok');
      wakeAutomation();
    });

    host.querySelector('#ul-simple-qt-points').addEventListener('change', (event) => {
      state.qt.pointsEnabled = event.target.checked;
      state.qtDueAt = 0;
      saveQt();
      wakeAutomation();
    });
    host.querySelector('#ul-simple-qt-perks').addEventListener('change', (event) => {
      state.qt.perksEnabled = event.target.checked;
      state.qtDueAt = 0;
      saveQt();
      wakeAutomation();
    });
    host.querySelector('#ul-simple-qt-save-points').addEventListener('click', () => {
      state.qt.pointsMaxPrice = integerText(host.querySelector('#ul-simple-qt-point-price').value);
      state.qt.pointsRemaining = integerText(host.querySelector('#ul-simple-qt-point-quantity').value);
      if (state.qt.pending?.kind === 'points') state.qt.pending = { ...state.qt.pending, quantityEdited:true };
      state.qtDueAt = 0;
      saveQt();
      renderQuicktrade();
      log('Saved Quicktrade point limits', 'ok');
      wakeAutomation();
    });
    host.querySelector('#ul-simple-qt-save-rule').addEventListener('click', () => {
      const name = String(host.querySelector('#ul-simple-qt-perk-name').value || '').trim();
      if (!name) return;
      const label = name.slice(0,250);
      const currency = host.querySelector('#ul-simple-qt-currency').value==='points'?'points':'money';
      const maxPrice = integerText(host.querySelector('#ul-simple-qt-perk-price').value);
      const remaining = integerText(host.querySelector('#ul-simple-qt-perk-quantity').value);
      if (maxPrice === '0' || remaining === '0') {
        state.qtStatus = 'Enter a positive whole listing price and positive quantity.';
        renderQuicktrade();
        return;
      }
      const existing = state.qt.rules.find((row) => row.label === label && row.currency === currency);
      if (!existing && state.qt.rules.length >= 100) {
        state.qtStatus = 'Remove an old rule before adding more (100 maximum).';
        renderQuicktrade();
        return;
      }
      if (state.qt.pending?.kind === 'perks' && existing?.id === state.qt.pending.ruleId) {
        state.qt.pending = { ...state.qt.pending, quantityEdited:true };
      }
      const rule = {
        id: existing?.id || `r_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        label, currency, maxPrice, remaining, enabled:true,
      };
      state.qt.rules = existing
        ? state.qt.rules.map((row) => row.id === existing.id ? rule : row)
        : [...state.qt.rules, rule];
      state.qtDueAt = 0;
      saveQt();
      renderQuicktrade();
      log(`Saved Quicktrade rule: ${name}`, 'ok');
      wakeAutomation();
    });
    host.querySelector('#ul-simple-qt-refresh').addEventListener('click', () => void refreshQuicktradeCatalog());
    host.querySelector('#ul-simple-qt-clear-pending').addEventListener('click', () => {
      if (state.qtRunning || !state.qt.pending) return;
      state.qtStatus = state.qt.pending.kind === 'swiss'
        ? 'Quicktrade resumed. Cash/Swiss balances will be read again; no purchase quantity was deducted.'
        : 'Quicktrade resumed. Reserved quantity remains deducted; adjust it if the purchase failed.';
      state.qt.pending = null;
      state.qtDueAt = 0;
      saveQt();
      renderQuicktrade();
      wakeAutomation();
    });

    host.querySelector('#ul-simple-restart-enabled').addEventListener('change', (event) => {
      state.restart.enabled = event.target.checked;
      if (!state.restart.enabled) cancelRestart();
      saveRestart();
      renderRestart();
    });
    host.querySelector('#ul-simple-restart-retrieve').addEventListener('change', (event) => {
      state.restart.retrieveAssets = event.target.checked;
      saveRestart();
    });
    host.querySelector('#ul-simple-restart-save').addEventListener('click', () => {
      state.restart.usernames = sanitiseRestartNames(host.querySelector('#ul-simple-restart-names').value.split(/\r?\n/));
      saveRestart();
      renderRestart();
      log(`Saved ${state.restart.usernames.length} restart username${state.restart.usernames.length===1?'':'s'}`, 'ok');
    });
    host.querySelector('#ul-simple-restart-generate').addEventListener('click', () => {
      state.restart.usernames = sanitiseRestartNames([...state.restart.usernames, ...generateRestartNames(state.restart.usernames, 100)]);
      saveRestart();
      renderRestart();
      log('Generated restart usernames', 'ok');
    });
    host.querySelector('#ul-simple-restart-retry').addEventListener('click', () => retryRestart());

    host.querySelector('#ul-simple-login-save').addEventListener('click', () => {
      const email = String(host.querySelector('#ul-simple-login-email').value || '').trim();
      const entered = String(host.querySelector('#ul-simple-login-password').value || '');
      const old = state.login;
      const password = entered || (old.email.toLowerCase() === email.toLowerCase() ? old.password : '');
      if (!email || !password) {
        state.loginStatus = 'Enter an email and password.';
        renderLogin();
        return;
      }
      state.login = { email, password, autoLogin: host.querySelector('#ul-simple-login-auto').checked };
      GM_setValue(KEYS.login, state.login);
      host.querySelector('#ul-simple-login-password').value = '';
      state.loginStatus = 'Saved locally in Tampermonkey';
      renderLogin();
      log('Saved login locally in Tampermonkey', 'ok');
      if (state.authRequired && state.login.autoLogin) void attemptAutoLogin();
    });
    host.querySelector('#ul-simple-login-clear').addEventListener('click', () => {
      state.login = { email:'', password:'', autoLogin:true };
      GM_setValue(KEYS.login, state.login);
      state.loginStatus = 'No login saved';
      renderLogin();
      log('Cleared saved login', 'info');
    });
    host.querySelector('#ul-simple-login-retry').addEventListener('click', () => void attemptAutoLogin(true));
    host.querySelector('#ul-simple-update-action').addEventListener('click', () => {
      if (state.updateAvailable || state.updateRequired) openLoaderUpdate();
      else void checkForUpdates(true);
    });

    host.querySelector('#ul-cloud-auth-save').addEventListener('click', () => {
      const licence = String(host.querySelector('#ul-cloud-auth-licence').value || '').trim();
      const device = String(host.querySelector('#ul-cloud-auth-device').value || '').trim() || 'Browser';
      if (!licence) {
        state.licenceStatus = 'Enter a licence key.';
        state.licenceError = true;
        render();
        return;
      }
      GM_setValue(KEYS.licence, licence);
      GM_setValue(KEYS.deviceLabel, device.slice(0,80));
      void authorise();
    });
    host.querySelector('#ul-cloud-auth-clear').addEventListener('click', () => {
      GM_setValue(KEYS.licence,'');
      token='';
      tokenExpiresAt=0;
      state.licenceCode='missing_licence';
      clearLicenceRetry();
      closePlannerSocket('licence cleared', true);
      state.settings.enabled=false;
      saveSettings();
      stopAutomation();
      stopJailStream();
      state.licenceStatus='Licence cleared';
      state.licenceError=true;
      render();
    });
  }

  function render() {
    const host = document.querySelector('#ul-simple-bot');
    if (!host) return;

    host.classList.toggle('collapsed', state.collapsed);
    host.querySelector('#ul-simple-body').hidden = state.collapsed;
    host.querySelector('#ul-simple-collapse').textContent = state.collapsed ? '+' : '−';
    host.querySelector('#ul-simple-tab-mode').classList.toggle('active', state.botTab);
    host.querySelector('#ul-simple-tab-mode').textContent = state.botTab ? 'Bot tab' : 'Use as bot tab';
    const headerUpdate = host.querySelector('#ul-simple-update-header');
    if (headerUpdate) {
      headerUpdate.hidden = !(state.updateAvailable || state.updateRequired);
      headerUpdate.textContent = state.updateRequired ? 'Update required' : 'Update';
      headerUpdate.title = state.updateRequired
        ? `Loader v${state.updateMinVersion || state.updateLatestVersion} or newer is required`
        : `Update to loader v${state.updateLatestVersion}`;
    }

    const mainStatus = !state.settings.enabled && !state.restartProgress.active
      ? (state.stoppedForDeath ? 'Character dead — stopped' : 'Stopped')
      : !state.botTab
        ? 'Play tab — automation inactive'
        : !state.controller
          ? 'Waiting for controller'
          : state.currentAction;
    host.querySelector('#ul-simple-status').textContent = mainStatus;

    const lic = host.querySelector('#ul-cloud-licence-status');
    lic.textContent = state.licenceStatus;
    lic.classList.toggle('err', state.licenceError);

    const toggle = host.querySelector('#ul-simple-toggle');
    toggle.textContent = state.restartProgress.active ? 'Stop' : state.stoppedForDeath ? 'Restart bot' : state.settings.enabled ? 'Stop' : 'Start';
    toggle.classList.toggle('running', state.settings.enabled && !state.stoppedForDeath);
    toggle.disabled = !token;

    for (const tab of host.querySelectorAll('.ul-simple-tab')) {
      const active = tab.dataset.tab === state.uiTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    for (const panel of host.querySelectorAll('.ul-simple-tab-panel')) {
      panel.hidden = panel.dataset.tabPanel !== state.uiTab;
    }

    const checks = {
      'ul-simple-crimes':'crimes',
      'ul-simple-gta':'gta',
      'ul-simple-jailbust':'jailBust',
      'ul-simple-auto-rank':'autoRank',
      'ul-simple-auto-prestige':'autoPrestige',
      'ul-simple-melt':'melt',
      'ul-simple-melt-common':'meltCommon',
      'ul-simple-melt-rare':'meltRare',
      'ul-simple-melt-tuners':'meltTuners',
      'ul-simple-repair-before-melt':'repairBeforeMelt',
      'ul-simple-drugs':'drugs',
      'ul-simple-discover-players':'discoverPlayers',
      'ul-simple-search-players':'searchPlayers',
      'ul-simple-auto-gun':'autoBuyGun',
    };
    for (const [id,key] of Object.entries(checks)) host.querySelector(`#${id}`).checked = state.settings[key] === true;

    host.querySelector('#ul-simple-drug-repair-damage').value = String(state.settings.drugRepairDamage);
    host.querySelector('#ul-simple-beam-travel').value = state.settings.beamTravelMode;
    host.querySelector('#ul-simple-auto-gun-choice').value = String(state.settings.autoGunId);

    host.querySelector('#ul-simple-crime-status').textContent = state.settings.crimes ? state.crimeStatus : 'Crimes disabled locally';
    host.querySelector('#ul-simple-gta-status').textContent = state.settings.gta ? state.gtaStatus : 'GTA disabled locally';
    host.querySelector('#ul-simple-jail-status').textContent = state.settings.jailBust ? state.jailStatus : 'Jailbust disabled locally';
    host.querySelector('#ul-simple-melt-status').textContent = state.settings.melt ? state.meltStatus : 'Melt disabled locally';
    host.querySelector('#ul-simple-drug-status').textContent = state.settings.drugs ? state.drugStatus : 'Drugs disabled locally';
    host.querySelector('#ul-simple-auto-rank-status').textContent = state.settings.autoRank ? state.autoRankStatus : 'Auto-renew disabled';
    host.querySelector('#ul-simple-prestige-status').textContent = state.settings.autoPrestige ? state.prestigeStatus : 'Auto-prestige disabled';
    host.querySelector('#ul-simple-player-status').textContent = state.settings.discoverPlayers ? state.playerDiscoveryStatus : 'Player discovery disabled';
    host.querySelector('#ul-simple-player-search-status').textContent = state.settings.searchPlayers || hasCombatSelections()
      ? state.playerSearchStatus
      : 'Player searching disabled';
    host.querySelector('#ul-simple-auto-gun-status').textContent = state.settings.autoBuyGun ? state.autoGunStatus : 'Auto-buy gun disabled';
    host.querySelector('#ul-simple-combat-status').textContent = state.combatStatus;

    if (document.activeElement !== host.querySelector('#ul-simple-player-list')) {
      host.querySelector('#ul-simple-player-list').value = state.players.join('\n');
    }

    renderPlayerActions();
    renderQuicktrade();
    renderRestart();
    renderLogin();
    renderLogs();
  }

  function scheduleControllerRetry() {
    if (!state.botTab || state.controller || controllerRetryTimer) return;
    controllerRetryTimer = setTimeout(() => {
      controllerRetryTimer = null;
      startControllerElection();
    }, 2_000);
  }

  function setBotTab(enabled) {
    state.botTab = enabled === true;
    GM_setValue(KEYS.botTab, state.botTab);
    if (state.botTab) {
      startControllerElection();
      syncJailStream();
    } else {
      if (controllerRetryTimer) clearTimeout(controllerRetryTimer);
      controllerRetryTimer = null;
      if (releaseController) releaseController();
      releaseController = null;
      state.controller = false;
      // Changing away from Bot Tab must invalidate any gameplay operation that
      // was already awaiting a read/Cloudflare plan. Otherwise a very fast
      // Bot Tab off -> on could let the old operation dispatch under the new
      // controller session.
      stopAutomation();
      syncPlannerSocket();
      state.currentAction = 'Play tab — automation inactive';
    }
    render();
  }

  function startControllerElection() {
    if (!state.botTab || state.controller || controllerRequested) return;
    controllerRequested = true;
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      void navigator.locks.request(CONTROLLER_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) {
          state.controller = false;
          state.currentAction = 'Standby — another bot tab is active';
          render();
          scheduleControllerRetry();
          return;
        }
        if (controllerRetryTimer) clearTimeout(controllerRetryTimer);
        controllerRetryTimer = null;
        state.controller = true;
        state.currentAction = state.settings.enabled ? 'Controller active' : 'Stopped';
        syncJailStream();
        wakeAutomation();
        render();
        await new Promise((resolve) => { releaseController = resolve; });
        releaseController = null;
        state.controller = false;
        // Invalidate work owned by the controller we just released before a
        // later lock acquisition can start a new generation.
        stopAutomation();
        state.currentAction = state.botTab ? 'Standby — controller released' : 'Play tab — automation inactive';
        render();
        scheduleControllerRetry();
      }).catch((error) => log(`Controller lock: ${friendly(error)}`, 'error')).finally(() => {
        controllerRequested = false;
        scheduleControllerRetry();
      });
      return;
    }
    state.controller = true;
    controllerRequested = false;
    state.currentAction = state.settings.enabled ? 'Controller active' : 'Stopped';
    syncJailStream();
    wakeAutomation();
    render();
  }

  function automationAllowed() {
    return Boolean(
      token &&
      state.botTab &&
      state.controller &&
      state.settings.enabled &&
      !state.stoppedForDeath &&
      !state.restartProgress.active &&
      !state.authRequired
    );
  }

  function stopAutomationTimer() {
    if (automationTimer) clearTimeout(automationTimer);
    automationTimer = null;
  }

  function stopAutomation() {
    stopAutomationTimer();
    stopJailStream();
    closePlannerSocket('automation stopped', true);
    // Invalidate every already-running gameplay task. Do not force its running
    // flag false here: its own finally block clears that flag, preventing a
    // rapid Stop -> Start from launching a second copy while the old copy is
    // still unwinding.
    state.automationEpoch += 1;
    if (!state.restartProgress.active) state.currentAction = 'Stopped';
  }

  function markFeatureEpoch(feature) {
    state.featureEpochs[feature] = state.automationEpoch;
  }

  function featureEpochCurrent(feature) {
    return state.featureEpochs[feature] === state.automationEpoch;
  }

  function resetAllDue() {
    state.crimesDueAt = 0;
    state.gtaDueAt = 0;
    state.jailBustDueAt = 0;
    state.meltDueAt = 0;
    state.drugsDueAt = 0;
    state.autoRankDueAt = 0;
    state.prestigeDueAt = 0;
    state.autoGunDueAt = 0;
    state.playerDiscoveryDueAt = 0;
    state.gangDiscoveryDueAt = 0;
    state.playerSearchDueAt = 0;
    state.combatDueAt = 0;
    state.qtDueAt = 0;
  }

  function hasCombatSelections() {
    return state.players.some((name) => {
      const action = state.playerActions[String(name).toLocaleLowerCase()];
      return action && (action.kill === true || action.beam === true);
    });
  }

  function activeBeamName() {
    const row = state.players.find((name) => state.playerActions[normalizePlayerName(name)]?.beam === true);
    return row || '';
  }

  function quicktradeReady() {
    const points = state.qt.pointsEnabled === true && bigintSafe(state.qt.pointsMaxPrice) > 0n && bigintSafe(state.qt.pointsRemaining) > 0n;
    const perks = state.qt.perksEnabled === true && state.qt.rules.some((rule) =>
      rule && rule.enabled !== false && bigintSafe(rule.maxPrice) > 0n && bigintSafe(rule.remaining) > 0n
    );
    return !state.qt.pending && (points || perks);
  }

  function autoRankIsActiveNow() {
    if (!state.autoRankActive) return false;
    if (state.autoRankEndsAt > Date.now()) return true;
    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
    return false;
  }

  function startSchedulerWatchdog() {
    if (schedulerWatchdogTimer) return;
    schedulerWatchdogTimer = setInterval(() => {
      if (automationAllowed()) wakeAutomation();
      else syncPlannerSocket();
    }, 1_000);
  }

  function schedulerFlags(now = Date.now()) {
    const combat = hasCombatSelections();
    const beam = Boolean(activeBeamName());
    const serverRanking = autoRankIsActiveNow();
    const rankBusy = state.crimesRunning || state.gtaRunning || state.meltRunning;
    const rankTransition = state.prestigeCommitting || state.autoRankRunning ||
      (state.settings.autoRank && state.autoRankDueAt <= now);
    const canRank = !state.inJail && !rankTransition;
    return { combat, beam, serverRanking, rankBusy, rankTransition, canRank };
  }

  function scheduledLanes(now = Date.now()) {
    const f = schedulerFlags(now);
    return [
      ['Crimes', f.canRank && state.settings.crimes && !(f.serverRanking && state.autoRankControls.crimes) && !state.crimesRunning ? state.crimesDueAt : Infinity, runCrimes],
      ['GTA', f.canRank && state.settings.gta && !(f.serverRanking && state.autoRankControls.gta) && !state.gtaRunning ? state.gtaDueAt : Infinity, runGta],
      ['Jail monitor', (state.settings.jailBust || state.inJail) && !state.jailBustRunning && !state.jailReadRunning ? state.jailBustDueAt : Infinity, runJailBust],
      ['Melt', f.canRank && state.settings.melt && !(f.serverRanking && state.autoRankControls.melt) && !state.meltRunning ? state.meltDueAt : Infinity, runMelt],
      ['Drugs', !state.inJail && state.settings.drugs && !(f.serverRanking && state.autoRankControls.drugs) && !f.beam && !state.combatRunning && !state.drugsRunning ? state.drugsDueAt : Infinity, runDrugs],
      ['Auto Rank', state.settings.autoRank && !f.rankBusy && !state.prestigeCommitting && !state.autoRankRunning ? state.autoRankDueAt : Infinity, runAutoRank],
      ['Prestige', !state.inJail && state.settings.autoPrestige && !state.prestigeRunning && !state.prestigeComplete ? state.prestigeDueAt : Infinity, runPrestige],
      ['Auto gun', !state.inJail && state.settings.autoBuyGun && !state.autoGunRunning ? state.autoGunDueAt : Infinity, runAutoGun],
      ['Player discovery', state.settings.discoverPlayers && !state.playerDiscoveryRunning ? state.playerDiscoveryDueAt : Infinity, runPlayerDiscovery],
      ['Gang discovery', state.settings.discoverPlayers && !state.gangDiscoveryRunning ? state.gangDiscoveryDueAt : Infinity, runGangDiscovery],
      ['Player search', !state.inJail && (state.settings.searchPlayers || f.combat) && !state.playerSearchRunning ? state.playerSearchDueAt : Infinity, runPlayerSearch],
      ['Combat', !state.inJail && f.combat && !state.drugsRunning && !state.autoGunRunning && !state.combatRunning ? state.combatDueAt : Infinity, runCombat],
      ['Quicktrade', !state.inJail && quicktradeReady() && !state.qtRunning ? state.qtDueAt : Infinity, runQuicktrade],
    ];
  }

  function wakeAutomation() {
    stopAutomationTimer();
    syncJailStream();
    syncPlannerSocket();
    if (!automationAllowed()) { render(); return; }

    const lanes = scheduledLanes();
    let nextName = '';
    let due = Infinity;
    for (const [name, at] of lanes) {
      if (Number.isFinite(at) && at < due) { due = at; nextName = name; }
    }

    if (!Number.isFinite(due)) {
      state.currentAction = autoRankIsActiveNow()
        ? 'Auto Rank active — server-controlled actions paused locally'
        : state.inJail
          ? 'Paused while in jail'
          : 'Waiting — no enabled automation is due';
      render();
      return;
    }

    const wait = Math.max(1, due - Date.now());
    automationTimer = setTimeout(() => void automationTick(), wait);
    const anyRunning = state.crimesRunning || state.gtaRunning || state.jailBustRunning || state.jailReadRunning || state.meltRunning ||
      state.drugsRunning || state.autoRankRunning || state.prestigeRunning || state.autoGunRunning ||
      state.playerDiscoveryRunning || state.gangDiscoveryRunning || state.playerSearchRunning ||
      state.combatRunning || state.qtRunning;
    if (!anyRunning) {
      state.currentAction = wait <= 50 ? `${nextName} due` : `Waiting for next ${nextName}`;
      render();
    }
  }

  function launchAutomationTask(run) {
    Promise.resolve()
      .then(run)
      .catch((error) => {
        if (!(error instanceof ActionCancelledError)) log(`Automation: ${friendly(error)}`, 'error');
      })
      .finally(wakeAutomation);
  }

  function markJailed() {
    const newlyJailed = !state.inJail;
    if (newlyJailed || !Number.isFinite(state.jailMarkedAt) || state.jailMarkedAt <= 0) {
      state.jailMarkedAt = Date.now();
    }
    state.inJail = true;
    if (newlyJailed || !Number.isFinite(state.jailBustDueAt)) state.jailBustDueAt = 0;
  }

  async function confirmJailRelease() {
    // /api/jail and /api/player/stats are both cached for up to ~2s in the
    // current game. Measure the safety window when the stats request starts,
    // not when it returns, so a slow pre-jail snapshot can never release us.
    const statsRequestStartedAt = Date.now();
    const stats = await gameJson('/api/player/stats', { priority: REQUEST_PRIORITY.RAPID });
    if (stats?.inJail === true) {
      markJailed();
      return false;
    }
    if (state.jailMarkedAt > 0 && statsRequestStartedAt - state.jailMarkedAt < JAIL_RELEASE_CONFIRM_DELAY_MS) return false;
    state.inJail = false;
    state.jailMarkedAt = 0;
    return true;
  }

  function automationTick() {
    automationTimer = null;
    if (!automationAllowed()) { render(); return; }
    const now = Date.now();
    for (const [, dueAt, run] of scheduledLanes(now)) {
      if (Number.isFinite(dueAt) && dueAt <= now) launchAutomationTask(run);
    }
    wakeAutomation();
  }

  async function runCrimes() {
    if (!automationAllowed() || !state.settings.crimes || state.crimesRunning) return;
    state.crimesRunning = true;
    markFeatureEpoch('crimes');
    state.currentAction = state.inJail ? 'Checking jail status' : 'Checking crimes';
    state.crimeStatus = state.currentAction;
    render();
    try {
      if (state.inJail) {
        state.crimesDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.crimeStatus = 'Paused while in jail · waiting for jail monitor';
        return;
      }

      const page = await gameJson('/api/crimes');
      if (!automationAllowed() || !state.settings.crimes) return;
      const crimes = Array.isArray(page.crimes) ? page.crimes : [];
      const plan = await plannerRequest('/api/v1/crimes/plan', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.crimes === true,
          autoRankCommittingCrimes: page.autoRank?.committingCrimes === true,
          crimes: crimes.map((crime) => ({
            id: Number(crime?.id),
            locked: crime?.locked === true,
            available: crime?.available === true,
            secondsRemaining: Number(crime?.secondsRemaining),
          })),
        },
      });

      if (plan.serverAutoRank === true) {
        state.crimesDueAt = Date.now() + safeWaitMs(plan.waitMs, 10_000);
        state.currentAction = 'Server Auto Rank controls crimes';
        state.crimeStatus = 'Server Auto Rank is committing crimes · local Crimes standing down';
        return;
      }

      const commits = Array.isArray(plan.commits) ? plan.commits : [];
      if (!commits.length) {
        const waitMs = safeWaitMs(plan.waitMs, 10_000);
        state.crimesDueAt = Date.now() + waitMs;
        state.currentAction = 'Waiting for next crime';
        state.crimeStatus = `No crime due · checking again in ${formatWait(waitMs)}`;
        return;
      }

      const byId = new Map(crimes.map((crime) => [Number(crime?.id), crime]));
      const results = [];
      for (const command of commits) {
        if (!automationAllowed() || !state.settings.crimes) break;
        const crimeId = Number(command?.crimeId);
        if (!Number.isSafeInteger(crimeId) || crimeId <= 0) continue;
        const crime = byId.get(crimeId);
        if (!crime || crime.locked === true || crime.available !== true) continue;
        const crimeName = typeof crime.name === 'string' && crime.name ? crime.name : `crime ${crimeId}`;
        state.currentAction = `Committing ${crimeName}`;
        state.crimeStatus = state.currentAction;
        render();
        try {
          const result = await gameJson(`/api/crimes/${encodeURIComponent(crimeId)}/commit`, { method: 'POST' });
          const message = cleanGameMessage(result.html) || `Committed ${crimeName}`;
          log(message, result.success === false ? 'warn' : 'ok');
          discoverStealVictim(crime, result);
          const inJail = result?.playerStatsPatch?.inJail === true || result.success === false;
          if (inJail) markJailed();
          results.push({
            crimeId,
            ok: true,
            gameStatus: 200,
            success: result.success !== false,
            cooldownSeconds: Number(result.cooldownSeconds),
            rankedUp: result.rankedUp === true,
            inJail,
          });
          if (inJail) break;
        } catch (error) {
          if (error instanceof ActionCancelledError) break;
          log(`Crimes: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
          results.push({
            crimeId,
            ok: false,
            gameStatus: Number(error?.status) || 0,
            retryAfterSeconds: Number(error?.retryAfter) || 0,
            rankedUp: false,
            inJail: false,
          });
          if (error?.status === 401) {
            state.currentAction = 'Game login required';
            state.crimeStatus = 'Game session expired · automatic login recovery active';
          }
          break;
        }
      }

      const settled = await plannerRequest('/api/v1/crimes/settle', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.crimes === true,
          existingWaitMs: Number(plan.existingWaitMs) || 0,
          results,
        },
      });
      const waitMs = safeWaitMs(settled.waitMs, 10_000);
      state.crimesDueAt = Date.now() + waitMs;
      if (settled.inJail === true || state.inJail) {
        markJailed();
        state.currentAction = 'Paused while in jail';
        state.crimeStatus = 'Crime failed · paused while in jail';
      } else if (settled.rankedUp === true) {
        state.currentAction = 'Rank changed · refreshing crimes';
        state.crimeStatus = 'Rank-up detected · refreshing crimes';
      } else {
        state.currentAction = 'Waiting for next crime';
        state.crimeStatus = `Crimes checked · next check in ${formatWait(waitMs)}`;
      }
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.crimesDueAt = Date.now() + 250;
      } else {
        const waitMs = error?.status === 429 && Number(error.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 5_000;
        state.crimesDueAt = Date.now() + waitMs;
        state.currentAction = 'Crime check failed · waiting to retry';
        state.crimeStatus = `Crime check failed: ${friendlyGameError(error)}`;
        log(`Crimes: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
        if (error?.status === 401) state.currentAction = 'Game login required';
      }
    } finally {
      state.crimesRunning = false;
      render();
    }
  }

  async function runGta() {
    if (!automationAllowed() || !state.settings.gta || state.gtaRunning) return;
    state.gtaRunning = true;
    markFeatureEpoch('gta');
    state.currentAction = state.inJail ? 'Checking jail status' : 'Checking GTA';
    state.gtaStatus = state.currentAction;
    render();
    try {
      if (state.inJail) {
        state.gtaDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.gtaStatus = 'Paused while in jail · waiting for jail monitor';
        return;
      }

      const page = await gameJson('/api/gta');
      if (!automationAllowed() || !state.settings.gta) return;
      const plan = await plannerRequest('/api/v1/gta/plan', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.gta === true,
          autoRankCommittingGta: page.autoRank?.committingGta === true,
          locked: page.locked === true,
          available: page.available === true,
          secondsRemaining: Number(page.secondsRemaining),
        },
      });

      if (plan.serverAutoRank === true) {
        state.gtaDueAt = Date.now() + safeWaitMs(plan.waitMs, 10_000);
        state.currentAction = 'Server Auto Rank controls GTA';
        state.gtaStatus = 'Server Auto Rank is committing GTA · local GTA standing down';
        return;
      }

      if (plan.action !== 'steal') {
        const waitMs = safeWaitMs(plan.waitMs, plan.locked === true ? 30_000 : 5_000);
        state.gtaDueAt = Date.now() + waitMs;
        state.currentAction = plan.locked === true ? 'GTA locked' : 'Waiting for GTA';
        state.gtaStatus = plan.locked === true
          ? 'GTA locked · checking again later'
          : `GTA not ready · checking again in ${formatWait(waitMs)}`;
        return;
      }

      state.currentAction = 'Committing GTA';
      state.gtaStatus = state.currentAction;
      render();

      let resultBody = null;
      let resultError = null;
      try {
        resultBody = await gameJson('/api/gta/steal', { method: 'POST' });
        const message = cleanGameMessage(resultBody.html) || (resultBody.success === false ? 'GTA failed' : 'GTA committed');
        log(message, resultBody.success === false ? 'warn' : 'ok');
        const inJail = resultBody?.playerStatsPatch?.inJail === true || resultBody.inJail === true || resultBody.success === false;
        if (inJail) markJailed();
        if (resultBody?.success === true && state.settings.melt) state.meltDueAt = 0;
      } catch (error) {
        if (error instanceof ActionCancelledError) {
          state.gtaDueAt = Date.now() + 250;
          return;
        }
        resultError = error;
        log(`GTA: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
      }

      const settled = await plannerRequest('/api/v1/gta/settle', {
        method: 'POST', token,
        body: resultError ? {
          localEnabled: state.settings.gta === true,
          ok: false,
          gameStatus: Number(resultError?.status) || 0,
          retryAfterSeconds: Number(resultError?.retryAfter) || 0,
          inJail: false,
          rankedUp: false,
        } : {
          localEnabled: state.settings.gta === true,
          ok: true,
          gameStatus: 200,
          cooldownSeconds: Number(resultBody?.cooldownSeconds),
          rankedUp: resultBody?.rankedUp === true,
          inJail: state.inJail === true,
        },
      });

      const waitMs = safeWaitMs(settled.waitMs, 5_000);
      state.gtaDueAt = Date.now() + waitMs;
      if (settled.inJail === true || state.inJail) {
        markJailed();
        state.currentAction = 'Paused while in jail';
        state.gtaStatus = 'GTA failed · paused while in jail';
      } else if (settled.rankedUp === true) {
        state.currentAction = 'Rank changed · refreshing GTA';
        state.gtaStatus = 'Rank-up detected · refreshing GTA';
        state.crimesDueAt = 0;
      } else if (resultError) {
        state.currentAction = 'GTA failed · waiting to retry';
        state.gtaStatus = `GTA failed · retrying in ${formatWait(waitMs)}`;
        if (resultError?.status === 401) {
          state.currentAction = 'Game login required';
          state.gtaStatus = 'Game session expired · automatic login recovery active';
        }
      } else {
        state.currentAction = 'Waiting for GTA';
        state.gtaStatus = `GTA checked · next check in ${formatWait(waitMs)}`;
      }
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.gtaDueAt = Date.now() + 250;
      } else {
        const waitMs = error?.status === 429 && Number(error.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 5_000;
        state.gtaDueAt = Date.now() + waitMs;
        state.currentAction = 'GTA check failed · waiting to retry';
        state.gtaStatus = `GTA check failed: ${friendlyGameError(error)}`;
        log(`GTA: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
        if (error?.status === 401) state.currentAction = 'Game login required';
      }
    } finally {
      state.gtaRunning = false;
      render();
    }
  }


  function hasFeature(name) {
    return state.licenceFeatures.has(String(name || ''));
  }

  function jailStreamShouldRun() {
    // Fast live-inmate SSE is a licence capability. Standard licences never
    // open /api/jail/stream and use the normal /api/jail polling lane instead.
    return Boolean(automationAllowed() && state.settings.jailBust && hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM));
  }

  function stopJailStream() {
    if (jailReconnectTimer) clearTimeout(jailReconnectTimer);
    jailReconnectTimer = null;
    if (jailStreamBustTimer) clearTimeout(jailStreamBustTimer);
    jailStreamBustTimer = null;
    if (jailEventSource) {
      try { jailEventSource.close(); } catch {}
      jailEventSource = null;
    }
    jailStreamReady = false;
    jailLatestStreamInmates = [];
  }

  function syncJailStream() {
    if (!jailStreamShouldRun()) {
      stopJailStream();
      return;
    }
    if (jailEventSource || jailReconnectTimer) return;
    connectJailStream();
  }

  function scheduleJailStreamReconnect() {
    if (!jailStreamShouldRun() || jailReconnectTimer) return;
    const delay = jailStreamReconnectDelayMs;
    jailStreamReconnectDelayMs = Math.min(15_000, jailStreamReconnectDelayMs * 2);
    jailReconnectTimer = setTimeout(() => {
      jailReconnectTimer = null;
      if (jailStreamShouldRun()) connectJailStream();
    }, delay);
  }

  function connectJailStream() {
    if (!jailStreamShouldRun() || jailEventSource) return;
    let source;
    try {
      source = new EventSource(new URL('/api/jail/stream', location.origin).href);
    } catch (error) {
      state.jailStatus = `Live jail stream unavailable: ${friendly(error)}`;
      render();
      scheduleJailStreamReconnect();
      return;
    }
    jailEventSource = source;
    source.addEventListener('ready', () => {
      if (jailEventSource !== source) return;
      jailStreamReady = true;
      jailStreamReconnectDelayMs = 1_000;
      state.jailStatus = state.inJail ? 'Live jail stream connected · waiting for release' : 'Live jail stream connected · watching inmates';
      render();
    });
    source.addEventListener('inmates', (event) => {
      if (jailEventSource !== source || !jailStreamShouldRun()) return;
      try {
        const payload = JSON.parse(String(event.data || '{}'));
        if (!Array.isArray(payload.inmates)) return;
        jailLatestStreamInmates = payload.inmates;
        if (state.settings.discoverPlayers) {
          addDiscoveredPlayers(
            payload.inmates.filter((row) => row && row.isBot !== true && row.usernameHidden !== true).map((row) => row.username),
            'Jail'
          );
        }
        void processLiveJailSnapshot();
      } catch {}
    });
    source.addEventListener('superseded', () => {
      if (jailEventSource !== source) return;
      source.close();
      jailEventSource = null;
      jailStreamReady = false;
      scheduleJailStreamReconnect();
    });
    source.onerror = () => {
      if (jailEventSource !== source) return;
      try { source.close(); } catch {}
      jailEventSource = null;
      jailStreamReady = false;
      scheduleJailStreamReconnect();
    };
  }

  function liveJailCandidate(inmates) {
    const viewerName = String(state.jailViewerUsername || '').trim().toLocaleLowerCase();
    const viewerToken = String(state.jailViewerBustToken || '').trim();
    const candidates = [];
    for (const inmate of Array.isArray(inmates) ? inmates : []) {
      if (!inmate || inmate.isBot === true) continue;
      const username = String(inmate.username || '').trim();
      const bustToken = String(inmate.bustToken || '').trim();
      const target = bustToken || username;
      if (!target || target.length > 64) continue;
      if (viewerToken && bustToken && viewerToken === bustToken) continue;
      if (!inmate.usernameHidden && viewerName && username.toLocaleLowerCase() === viewerName) continue;
      let reward = 0n;
      try { if (/^\d{1,36}$/.test(String(inmate.bustReward ?? ''))) reward = BigInt(String(inmate.bustReward)); } catch {}
      const seconds = Number.isFinite(Number(inmate.secondsRemaining)) ? Math.max(0, Number(inmate.secondsRemaining)) : 86_400;
      candidates.push({ inmate, target, reward, seconds });
    }
    candidates.sort((a, b) => a.reward !== b.reward ? (a.reward > b.reward ? -1 : 1) : a.seconds - b.seconds);
    return candidates[0] || null;
  }

  async function processLiveJailSnapshot() {
    if (!jailStreamShouldRun() || state.inJail || state.jailBustRunning) return;
    const candidate = liveJailCandidate(jailLatestStreamInmates);
    if (!candidate) return;
    const rateWait = Math.max(0, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS - Date.now());
    if (rateWait > 0) {
      if (!jailStreamBustTimer) {
        jailStreamBustTimer = setTimeout(() => {
          jailStreamBustTimer = null;
          void processLiveJailSnapshot();
        }, rateWait);
      }
      return;
    }

    state.jailBustRunning = true;
    markFeatureEpoch('jail');
    const inmate = candidate.inmate;
    const displayName = inmate?.usernameHidden ? 'Unknown' : String(inmate?.username || 'player');
    state.currentAction = `Busting ${displayName}`;
    state.jailStatus = `Live stream · ${state.currentAction}`;
    render();
    state.lastJailBustAt = Date.now();
    try {
      const result = await gameJson(`/api/jail/bust/${encodeURIComponent(candidate.target)}`, { method: 'POST' });
      log(cleanGameMessage(result?.html) || `Busted ${displayName}`, result?.success === false ? 'warn' : 'ok');
      jailLatestStreamInmates = jailLatestStreamInmates.filter((row) => String(row?.bustToken || row?.username || '').trim() !== candidate.target);
      state.jailBustDueAt = Math.max(state.jailBustDueAt, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS);
    } catch (error) {
      if (error instanceof ActionCancelledError) return;
      const message = friendlyGameError(error);
      const gotCaught = error?.body?.success === false || /got caught trying to bust|cannot bust players while you are in jail/i.test(message);
      const stale = error?.status === 404 || (error?.status === 400 && /not in jail|no longer in jail|dead|not found/i.test(message));
      if (gotCaught) {
        markJailed();
        state.crimesDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.gtaDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.jailBustDueAt = Date.now() + 3_000;
        state.jailStatus = 'Jailbust failed · waiting for release';
        log(`Jailbust: ${message}`, 'warn');
      } else if (error?.status === 401) {
        state.currentAction = 'Game login required';
        state.jailStatus = 'Game session expired · automatic login recovery active';
      } else if (error?.status === 429) {
        const wait = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 250;
        state.jailBustDueAt = Date.now() + wait;
        state.jailStatus = `Jailbust rate pacing · ${formatWait(wait)}`;
      } else if (stale) {
        jailLatestStreamInmates = jailLatestStreamInmates.filter((row) => String(row?.bustToken || row?.username || '').trim() !== candidate.target);
      } else if (!stale) {
        state.jailStatus = `Live jailbust failed: ${message}`;
        log(`Jailbust: ${message}`, 'error');
      }
    } finally {
      state.jailBustRunning = false;
      render();
      wakeAutomation();
      if (!state.inJail && jailLatestStreamInmates.length) {
        const wait = Math.max(0, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS - Date.now());
        if (jailStreamBustTimer) clearTimeout(jailStreamBustTimer);
        jailStreamBustTimer = setTimeout(() => {
          jailStreamBustTimer = null;
          void processLiveJailSnapshot();
        }, Math.max(1, wait));
      }
    }
  }


  async function runJailBust() {
    if (!automationAllowed() || (!state.settings.jailBust && !state.inJail) || state.jailBustRunning || state.jailReadRunning) return;
    // Keep the ordinary /api/jail read separate from the actual bust lock. The
    // owner live stream can then dispatch a real-player bust immediately even
    // if the fallback jail read is still in flight.
    state.jailReadRunning = true;
    if (state.settings.jailBust) markFeatureEpoch('jail');
    state.currentAction = state.inJail ? 'Checking jail sentence' : 'Checking jail for busts';
    state.jailStatus = state.currentAction;
    render();
    try {
      const page = await gameJson('/api/jail', { priority: REQUEST_PRIORITY.RAPID });
      if (!automationAllowed()) return;

      const wasInJail = state.inJail;
      if (page?.inJail === true) {
        markJailed();
      } else if (wasInJail) {
        const released = await confirmJailRelease();
        if (released) {
          log('Released from jail — resuming actions', 'ok');
          state.crimesDueAt = 0;
          state.gtaDueAt = 0;
          state.meltDueAt = 0;
          state.drugsDueAt = 0;
          state.autoRankDueAt = 0;
          state.prestigeDueAt = 0;
          state.autoGunDueAt = 0;
          state.playerSearchDueAt = 0;
          state.combatDueAt = 0;
          state.qtDueAt = 0;
          if (state.settings.jailBust && jailLatestStreamInmates.length) void processLiveJailSnapshot();
        }
      }

      if (state.inJail) {
        state.jailBustDueAt = Date.now() + JAIL_RELEASE_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.jailStatus = `In jail · checking release in ${formatWait(JAIL_RELEASE_POLL_MS)}`;
        return;
      }

      // If Jailbust is disabled, this lane exists only to confirm release.
      if (!state.settings.jailBust) {
        state.jailBustDueAt = Infinity;
        state.jailStatus = 'Jailbust disabled';
        return;
      }

      const viewerUsername = String(page?.viewerUsername || '').trim();
      const viewerBustToken = String(page?.viewerBustToken || '').trim();
      state.jailViewerUsername = viewerUsername;
      state.jailViewerBustToken = viewerBustToken;
      const inmates = (Array.isArray(page?.inmates) ? page.inmates : []).slice(0, 100);
      if (state.settings.discoverPlayers) {
        addDiscoveredPlayers(
          inmates.filter((row) => row && row.isBot !== true && row.usernameHidden !== true).map((row) => row.username),
          'Jail'
        );
      }

      // The jail target rule is intentionally local for speed and to avoid a
      // high-frequency Cloudflare planner message. Fast-jail licences handle
      // real inmates from SSE while connected; standard licences handle all
      // inmates from this normal /api/jail polling snapshot.
      const candidates = [];
      for (const inmate of inmates) {
        if (!inmate || typeof inmate !== 'object') continue;
        const username = String(inmate.username || '').trim();
        const bustToken = String(inmate.bustToken || '').trim();
        const isBot = inmate.isBot === true;
        const isSelf = !isBot && (
          (bustToken && viewerBustToken && bustToken === viewerBustToken)
          || (!inmate.usernameHidden && username && viewerUsername && normalizePlayerName(username) === normalizePlayerName(viewerUsername))
        );
        const target = bustToken || username;
        const botGeneration = Number(inmate.botGeneration);
        const validBot = !isBot || (Number.isSafeInteger(botGeneration) && botGeneration >= 1);
        if (isSelf || !target || target.length > 64 || !validBot) continue;
        if (jailStreamReady && !isBot) continue;
        let reward = 0n;
        try { if (/^\d{1,36}$/.test(String(inmate.bustReward ?? ''))) reward = BigInt(String(inmate.bustReward)); } catch {}
        const seconds = Number.isFinite(Number(inmate.secondsRemaining)) ? Math.max(0, Number(inmate.secondsRemaining)) : 86_400;
        candidates.push({ inmate, target, reward, seconds });
      }
      candidates.sort((a, b) => a.reward !== b.reward ? (a.reward > b.reward ? -1 : 1) : a.seconds - b.seconds);
      const candidate = candidates[0] || null;

      if (!candidate) {
        const waitMs = jailStreamReady ? JAIL_STREAM_FALLBACK_POLL_MS : JAIL_POLL_FALLBACK_MS;
        state.jailBustDueAt = Date.now() + waitMs;
        state.currentAction = 'Watching jail';
        state.jailStatus = `No bust target · checking again in ${formatWait(waitMs)}`;
        return;
      }

      const rateWait = Math.max(0, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS - Date.now());
      if (rateWait > 0) {
        state.jailBustDueAt = Date.now() + rateWait;
        state.jailStatus = `Jailbust rate pacing · ${formatWait(rateWait)}`;
        return;
      }

      const inmate = candidate.inmate;
      const displayName = inmate?.usernameHidden ? 'Unknown' : String(inmate?.username || 'player');
      state.currentAction = `Busting ${displayName}`;
      state.jailStatus = state.currentAction;
      render();

      // A live SSE event may have started a real-player bust while this GET
      // was in flight. Never race a second bust; retry the polling lane shortly.
      if (state.jailBustRunning) {
        state.jailBustDueAt = Date.now() + 25;
        state.jailStatus = 'Live jailbust in progress';
        return;
      }

      state.jailBustRunning = true;
      state.lastJailBustAt = Date.now();
      let result = null;
      let error = null;
      try {
        result = await gameJson(`/api/jail/bust/${encodeURIComponent(candidate.target)}`, inmate?.isBot === true
          ? { method: 'POST', body: { generation: Number(inmate.botGeneration) } }
          : { method: 'POST' });
        log(cleanGameMessage(result?.html) || `Busted ${displayName}`, result?.success === false ? 'warn' : 'ok');
      } catch (caught) {
        if (caught instanceof ActionCancelledError) {
          state.jailBustDueAt = Date.now() + 250;
          return;
        }
        error = caught;
        const message = friendlyGameError(caught);
        const gotCaught = caught?.body?.success === false || /got caught trying to bust|cannot bust players while you are in jail/i.test(message);
        const stale = caught?.status === 404 || (caught?.status === 400 && /not in jail|no longer in jail|dead|not found/i.test(message));
        if (gotCaught) {
          markJailed();
          log(`Jailbust: ${message}`, 'warn');
        } else if (!stale) {
          log(`Jailbust: ${message}`, caught?.status === 429 ? 'warn' : 'error');
        }
      } finally {
        state.jailBustRunning = false;
      }

      const message = error ? friendlyGameError(error) : '';
      const bustFailed = !!(error && (error?.body?.success === false || /got caught trying to bust|cannot bust players while you are in jail/i.test(message)));
      const targetStale = !!(error && (error?.status === 404 || (error?.status === 400 && /not in jail|no longer in jail|dead|not found/i.test(message))));

      if (error?.status === 401) {
        state.currentAction = 'Game login required';
        state.jailStatus = 'Game session expired · automatic login recovery active';
        return;
      }

      if (bustFailed || state.inJail) {
        markJailed();
        state.crimesDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.gtaDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.jailBustDueAt = Date.now() + JAIL_RELEASE_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.jailStatus = 'Jailbust failed · waiting for release';
      } else {
        const retryAfterMs = error?.status === 429
          ? (Number(error?.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 250)
          : 0;
        const serverWait = targetStale || (!error && result?.success !== false) ? 100 : (error ? 1_000 : 100);
        const localWait = Math.max(0, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS - Date.now());
        const waitMs = Math.max(retryAfterMs, serverWait, localWait);
        state.jailBustDueAt = Date.now() + waitMs;
        state.currentAction = targetStale ? 'Refreshing jail' : 'Watching jail';
        state.jailStatus = targetStale
          ? 'Target left jail · refreshing'
          : error
            ? `Jailbust check · retrying in ${formatWait(waitMs)}`
            : `Jailbust complete · checking again in ${formatWait(waitMs)}`;
      }
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.jailBustDueAt = Date.now() + 250;
        return;
      }
      const waitMs = error?.status === 429 && Number(error?.retryAfter) > 0
        ? Number(error.retryAfter) * 1000 + 50
        : (state.inJail ? JAIL_RELEASE_POLL_MS : 1_000);
      state.jailBustDueAt = Date.now() + waitMs;
      state.currentAction = 'Jail check failed · waiting to retry';
      state.jailStatus = `Jail check failed: ${friendlyGameError(error)}`;
      log(`Jailbust: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
      if (error?.status === 401) state.currentAction = 'Game login required';
    } finally {
      state.jailReadRunning = false;
      render();
      if (jailStreamShouldRun() && !state.inJail && jailLatestStreamInmates.length) {
        queueMicrotask(() => void processLiveJailSnapshot());
      }
    }
  }


  function localMeltCarAllowed(car, favouritePublicId = null) {
    if (!car || typeof car.name !== 'string' || car.protectedFromMelt === true) return false;
    const publicId = Number(car.publicId);
    if (state.settings.drugs && favouritePublicId !== null && publicId === favouritePublicId) return false;
    if (car.name === 'Tuner') return state.settings.meltTuners === true;
    if (['RS Tuner','Mythic Car','Hyper Car','Black Car','Orange Car'].includes(car.name) || car.rarity === 'veryRare') return false;
    if (car.rarity === 'normal') return state.settings.meltCommon === true;
    if (car.rarity === 'rare') return state.settings.meltRare === true;
    return false;
  }

  async function runMelt() {
    if (!automationAllowed() || !state.settings.melt || state.meltRunning) return;
    state.meltRunning = true;
    markFeatureEpoch('melt');
    state.currentAction = state.inJail ? 'Waiting to melt while jailed' : 'Checking cars to melt';
    state.meltStatus = state.currentAction;
    render();

    let gameStatus = 0;
    let retryAfterSeconds = 0;
    try {
      if (state.inJail) {
        state.meltDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.meltStatus = 'Paused while in jail · waiting for jail monitor';
        return;
      }

      const overview = await gameJson('/api/melt?page=1');
      if (!automationAllowed() || !state.settings.melt) return;

      const plan = await plannerRequest('/api/v1/melt/plan', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.melt === true,
          meltCommon: state.settings.meltCommon === true,
          meltRare: state.settings.meltRare === true,
          meltTuners: state.settings.meltTuners === true,
          repairBeforeMelt: state.settings.repairBeforeMelt === true,
          available: overview.available === true,
          secondsRemaining: Number(overview.secondsRemaining),
          maxCars: Number(overview?.multiMelt?.maxCars),
          autoRankCommittingMelt: overview?.autoRank?.committingMelt === true,
          groups: (Array.isArray(overview.groups) ? overview.groups : []).map((group) => ({
            name: typeof group?.name === 'string' ? group.name : '',
            count: Number(group?.count),
            rarity: typeof group?.rarity === 'string' ? group.rarity : '',
          })),
        },
      });

      if (plan.serverAutoRank === true) {
        const waitMs = safeWaitMs(plan.waitMs, 5_000);
        state.meltDueAt = Date.now() + waitMs;
        state.currentAction = 'Server Auto Rank controls Melt';
        state.meltStatus = 'Server Auto Rank is melting cars · local Melt standing down';
        return;
      }
      if (plan.action !== 'fetch_candidates' || !Array.isArray(plan.filters) || !plan.filters.length) {
        const waitMs = safeWaitMs(plan.waitMs, 30_000);
        state.meltDueAt = Date.now() + waitMs;
        state.currentAction = overview.available === true ? 'No eligible cars to melt' : 'Waiting for Melt cooldown';
        state.meltStatus = overview.available === true
          ? `No safely eligible car · checking again in ${formatWait(waitMs)}`
          : `Melt cooldown · checking again in ${formatWait(waitMs)}`;
        return;
      }

      // Favourite drug-run car protection stays local. Only a boolean flag for
      // each candidate is sent to Cloudflare; the favourite car ID never leaves
      // the browser.
      let favouritePublicId = null;
      if (state.settings.drugs) {
        try {
          const drugPage = await gameJson('/api/drugs?page=1');
          const id = Number(drugPage?.favouriteCar?.publicId);
          if (Number.isSafeInteger(id) && id > 0) favouritePublicId = id;
        } catch (error) {
          // Do not risk melting without the favourite-car guard when Drugs is
          // enabled but its context cannot be read.
          state.meltDueAt = Date.now() + 5_000;
          state.meltStatus = `Waiting for drug-car protection: ${friendlyGameError(error)}`;
          return;
        }
      }

      const localPages = [];
      const serverPages = [];
      for (const filter of plan.filters.slice(0, 50)) {
        if (!automationAllowed() || !state.settings.melt) return;
        const page = await gameJson(`/api/melt?page=1&filter=${encodeURIComponent(String(filter))}`);
        if (page.available !== true) {
          const waitMs = Math.max(100, (Number(page.secondsRemaining) || 0) * 1000 + 50);
          state.meltDueAt = Date.now() + waitMs;
          state.meltStatus = `Melt cooldown changed · checking again in ${formatWait(waitMs)}`;
          return;
        }
        const cars = Array.isArray(page.cars) ? page.cars : [];
        localPages.push({ filter: String(filter), cars });
        serverPages.push({
          filter: String(filter),
          cars: cars.slice(0, 50).map((car) => ({
            name: typeof car?.name === 'string' ? car.name : '',
            rarity: typeof car?.rarity === 'string' ? car.rarity : '',
            damage: Number(car?.damage),
            protectedFromMelt: car?.protectedFromMelt === true,
            isDrugFavourite: favouritePublicId !== null && Number(car?.publicId) === favouritePublicId,
          })),
        });
        const enoughSafeCars = localPages.reduce((count, loaded) => count + loaded.cars.reduce((inner, car) => (
          inner + (localMeltCarAllowed(car, favouritePublicId) ? 1 : 0)
        ), 0), 0) >= Math.max(1, Number(plan.maxCars) || 1);
        if (enoughSafeCars) break;
      }

      const selection = await plannerRequest('/api/v1/melt/select', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.melt === true,
          meltCommon: state.settings.meltCommon === true,
          meltRare: state.settings.meltRare === true,
          meltTuners: state.settings.meltTuners === true,
          repairBeforeMelt: state.settings.repairBeforeMelt === true,
          maxCars: Number(plan.maxCars),
          pages: serverPages,
        },
      });

      const selected = [];
      const selectedIds = new Set();
      const maxSelectedCars = clampInt(overview?.multiMelt?.maxCars, 1, 3, 1);
      for (const ref of Array.isArray(selection.selected) ? selection.selected : []) {
        if (selected.length >= maxSelectedCars) break;
        const pageIndex = Number(ref?.pageIndex);
        const carIndex = Number(ref?.carIndex);
        if (!Number.isInteger(pageIndex) || !Number.isInteger(carIndex)) continue;
        const car = localPages[pageIndex]?.cars?.[carIndex];
        if (!car) continue;
        const publicId = Number(car.publicId);
        if (!Number.isSafeInteger(publicId) || publicId <= 0 || selectedIds.has(publicId)) continue;
        // Revalidate local safety before any mutation. Cloudflare selects only
        // indexes; usable game car IDs never leave this browser.
        if (!localMeltCarAllowed(car, favouritePublicId)) continue;
        selectedIds.add(publicId);
        selected.push({ car, publicId, repair: ref?.repair === true });
      }

      if (!selected.length) {
        const waitMs = safeWaitMs(selection.waitMs, 30_000);
        state.meltDueAt = Date.now() + waitMs;
        state.meltStatus = `No safely eligible car returned · checking again in ${formatWait(waitMs)}`;
        return;
      }

      if (state.settings.repairBeforeMelt) {
        for (const item of selected) {
          if (!automationAllowed() || !featureEpochCurrent('melt') || !state.settings.melt || !state.settings.repairBeforeMelt) return;
          if (!localMeltCarAllowed(item.car, favouritePublicId)) throw new ActionCancelledError('Melt selection changed');
          if (!item.repair || Number(item.car?.damage) <= 0) continue;
          state.currentAction = `Repairing ${item.car.displayName || item.car.name || 'car'} before melting`;
          state.meltStatus = state.currentAction;
          render();
          const repaired = await gameJson(`/api/melt/cars/${encodeURIComponent(String(item.publicId))}/repair`, {
            method: 'POST',
            validate: () => {
              if (!featureEpochCurrent('melt') || !state.settings.melt || !state.settings.repairBeforeMelt ||
                  !localMeltCarAllowed(item.car, favouritePublicId)) {
                throw new ActionCancelledError('Melt selection changed');
              }
            },
          });
          const repairMessage = cleanGameMessage(repaired.html);
          if (repairMessage) log(repairMessage, 'ok');
        }
      }

      if (!automationAllowed() || !featureEpochCurrent('melt') || !state.settings.melt) return;
      if (selected.some((item) => !localMeltCarAllowed(item.car, favouritePublicId))) {
        throw new ActionCancelledError('Melt selection changed');
      }
      state.currentAction = `Melting ${selected.length} car${selected.length === 1 ? '' : 's'}`;
      state.meltStatus = state.currentAction;
      render();
      const result = await gameJson('/api/melt/cars/melt', {
        method: 'POST',
        body: { ids: selected.map((item) => item.publicId) },
        validate: () => {
          if (!featureEpochCurrent('melt') || !state.settings.melt ||
              selected.some((item) => !localMeltCarAllowed(item.car, favouritePublicId))) {
            throw new ActionCancelledError('Melt selection changed');
          }
        },
      });
      gameStatus = 200;
      const message = cleanGameMessage(result.html) || `Melted ${selected.length} car${selected.length === 1 ? '' : 's'}`;
      log(message, 'ok');

      const settled = await plannerRequest('/api/v1/melt/settle', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.melt === true,
          ok: true,
          gameStatus: 200,
          cooldownSeconds: Number(result.cooldownSeconds),
        },
      });
      const waitMs = safeWaitMs(settled.waitMs, 5_000);
      state.meltDueAt = Date.now() + waitMs;
      state.currentAction = 'Waiting for next Melt';
      state.meltStatus = `${message} · next Melt in ${formatWait(waitMs)}`;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.meltDueAt = Date.now() + 250;
        return;
      }
      gameStatus = Number(error?.status) || 0;
      retryAfterSeconds = Number(error?.retryAfter) || 0;
      if (error?.body?.inJail === true || /while you are in jail|sent to jail/i.test(friendlyGameError(error))) {
        markJailed();
        state.meltDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.meltStatus = 'Paused while in jail · checking again shortly';
      } else {
        let waitMs = error?.status === 429 && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 + 50 : 5_000;
        try {
          const settled = await plannerRequest('/api/v1/melt/settle', {
            method: 'POST', token,
            body: {
              localEnabled: state.settings.melt === true,
              ok: false,
              gameStatus,
              retryAfterSeconds,
            },
          });
          waitMs = safeWaitMs(settled.waitMs, waitMs);
        } catch {}
        state.meltDueAt = Date.now() + waitMs;
        state.meltStatus = `Melt failed: ${friendlyGameError(error)} · retrying in ${formatWait(waitMs)}`;
        log(`Melt: ${friendlyGameError(error)}`, 'error');
      }
    } finally {
      state.meltRunning = false;
      render();
    }
  }

  function normaliseDrugLabel(value) {
    const label = String(value || '').trim().toLocaleLowerCase();
    if (label === 'united states' || label === 'united states of america') return 'usa';
    return label;
  }

  function normaliseDrugId(value) {
    const id = normaliseDrugLabel(value);
    return id === 'marijuana' ? 'cannabis' : id;
  }

  function drugMarketVersion(data) {
    const version = Number(data?.marketOverview?.version);
    return Number.isSafeInteger(version) && version >= 0 ? version : null;
  }

  function drugRouteSummary(data) {
    const legs = Array.isArray(data?.marketOverview?.bestRoute?.legs) ? data.marketOverview.bestRoute.legs : [];
    if (!legs.length) return '';
    const places = [String(legs[0]?.from || '')];
    for (const leg of legs) places.push(String(leg?.to || ''));
    return places.filter(Boolean).join(' → ');
  }

  function drugWaitReason(reason) {
    const labels = {
      local_disabled: 'disabled locally',
      beam_active: 'Beam currently owns travel',
      auto_rank_drugs: 'Auto Rank is running drugs server-side',
      no_live_recommendation: 'live route recommendation unavailable',
      sell_inventory_refresh: 'waiting for inventory refresh',
      no_favourite_car: 'favourite a car to continue',
      capacity_full: 'drug capacity is full',
      insufficient_cash: 'insufficient cash to buy the recommended load',
      drive_cooldown: 'waiting for driving cooldown',
      awaiting_next_leg: 'waiting for next live recommendation',
      destination_unavailable: 'recommended destination unavailable',
    };
    return labels[String(reason || '')] || String(reason || '').replace(/_/g, ' ') || 'waiting';
  }

  function drugMarketChanged(error) {
    const code = String(error?.body?.code || '').toLocaleLowerCase();
    const message = String(error?.message || '').toLocaleLowerCase();
    if (error?.body?.marketChanged === true) return true;
    if (code.includes('market') && (code.includes('stale') || code.includes('change') || code.includes('version'))) return true;
    return /(?:market|price).*(?:changed|updated|stale|expired|version|rotated|rotation)/i.test(message);
  }

  async function settleDrugAction(payload, fallbackWaitMs = 5_000) {
    try {
      const settled = await plannerRequest('/api/v1/drugs/settle', {
        method: 'POST', token,
        body: { localEnabled: state.settings.drugs === true, ...payload },
      });
      return safeWaitMs(settled.waitMs, fallbackWaitMs);
    } catch {
      return fallbackWaitMs;
    }
  }

  async function runDrugs() {
    if (!automationAllowed() || !state.settings.drugs || state.drugsRunning) return;
    state.drugsRunning = true;
    markFeatureEpoch('drugs');
    state.currentAction = state.inJail ? 'Checking jail status' : 'Checking live drug route';
    state.drugStatus = state.currentAction;
    render();

    let plannedAction = 'wait';
    try {
      if (state.inJail) {
        state.drugsDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.drugStatus = 'Paused while in jail · waiting for jail monitor';
        return;
      }

      const data = await gameJson('/api/drugs?page=1');
      if (!automationAllowed() || !state.settings.drugs) return;

      const displayLocation = String(data?.location || 'Unknown');
      const capacity = Math.max(0, Number(data?.capacity ?? data?.rankCapacity) || 0);
      const unitsHeld = Math.max(0, Number(data?.unitsHeld) || 0);
      const inventory = (Array.isArray(data?.inventory) ? data.inventory : []).filter((lot) => lot && lot.id);
      const market = Array.isArray(data?.market) ? data.market : [];
      const locations = Array.isArray(data?.locations) ? data.locations : [];
      const favouriteCar = data?.favouriteCar && typeof data.favouriteCar === 'object' ? data.favouriteCar : null;
      const marketVersion = drugMarketVersion(data);
      const routeSummary = drugRouteSummary(data);
      const move = data?.recommendedMove && typeof data.recommendedMove === 'object' ? data.recommendedMove : null;

      const context = `${displayLocation}: ${unitsHeld.toLocaleString('en-GB')}/${capacity.toLocaleString('en-GB')} drug units${
        favouriteCar ? ` · ${String(favouriteCar.name || 'favourite car')} ${Number(favouriteCar.damage || 0)}% damage` : ' · no favourite car'
      }${routeSummary ? ` · best route ${routeSummary}` : ''}`;
      state.drugStatus = context;

      const serverInventory = inventory.slice(0, 500).map((lot, index) => ({
        index,
        drugId: String(lot?.drugId || lot?.name || ''),
        units: Math.max(0, Number(lot?.units ?? lot?.amount ?? lot?.quantity) || 0),
      }));
      const serverMarket = market.slice(0, 20).map((drug) => ({
        drugId: String(drug?.id || drug?.name || ''),
        price: String(drug?.price ?? '0'),
      }));
      const serverLocations = locations.slice(0, 20).map((entry, index) => ({
        index,
        name: String(entry?.name || ''),
      }));

      const plan = await plannerRequest('/api/v1/drugs/plan', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.drugs === true,
          beamActive: Boolean(activeBeamName()),
          autoRankRunningDrugs: data?.autoRank?.runningDrugs === true,
          location: String(data?.location || ''),
          capacity,
          unitsHeld,
          money: String(data?.money ?? '0'),
          favouriteCar: favouriteCar ? { exists: true, damage: Number(favouriteCar.damage || 0) } : { exists: false, damage: 0 },
          repairThreshold: state.settings.drugRepairDamage,
          recommendedMove: move ? {
            buy: typeof move.buy === 'string' ? move.buy : '',
            sell: typeof move.sell === 'string' ? move.sell : '',
            next: typeof move.next === 'string' ? move.next : '',
          } : null,
          marketVersion,
          inventory: serverInventory,
          market: serverMarket,
          driveAvailable: data?.driveAvailable === true,
          driveSecondsRemaining: Number(data?.driveSecondsRemaining),
          locations: serverLocations,
        },
      });

      plannedAction = String(plan?.action || 'wait');
      if (plannedAction === 'wait') {
        const waitMs = safeWaitMs(plan?.waitMs, 10_000);
        state.drugsDueAt = Date.now() + waitMs;
        state.currentAction = `Drug Run: ${drugWaitReason(plan?.reason)}`;
        state.drugStatus = `${context} · ${drugWaitReason(plan?.reason)}`;
        return;
      }

      if (!automationAllowed() || !state.settings.drugs) return;
      let result;
      let fallbackMessage = '';

      if (plannedAction === 'repair_favourite') {
        const publicId = Number(favouriteCar?.publicId);
        if (!Number.isSafeInteger(publicId) || publicId <= 0) {
          state.drugsDueAt = Date.now() + 10_000;
          state.drugStatus = `${context} · favourite car ID unavailable`;
          return;
        }
        state.currentAction = `Repairing drug car ${String(favouriteCar?.name || '').trim()}`.trim();
        state.drugStatus = state.currentAction;
        render();
        result = await gameJson(`/api/gta/cars/${encodeURIComponent(String(publicId))}/repair`, { method: 'POST' });
        fallbackMessage = `Repaired ${String(favouriteCar?.name || 'favourite drug car')}`;
      } else if (plannedAction === 'sell') {
        const ids = [];
        for (const raw of Array.isArray(plan?.lotIndexes) ? plan.lotIndexes : []) {
          const index = Number(raw);
          const lot = Number.isInteger(index) ? inventory[index] : null;
          if (!lot?.id) continue;
          ids.push(String(lot.id));
        }
        if (!ids.length) {
          state.drugsDueAt = Date.now() + 1_000;
          state.drugStatus = `${context} · waiting for inventory refresh`;
          return;
        }
        state.currentAction = `Selling ${normaliseDrugId(plan?.drugId) || 'drugs'} in ${displayLocation}`;
        state.drugStatus = state.currentAction;
        render();
        result = await gameJson('/api/drugs/sell', {
          method: 'POST',
          body: { ids, ...(marketVersion !== null ? { marketVersion } : {}) },
        });
        fallbackMessage = `Sold ${ids.length} drug lot${ids.length === 1 ? '' : 's'} in ${displayLocation}`;
      } else if (plannedAction === 'buy') {
        const wanted = normaliseDrugId(plan?.drugId);
        const item = market.find((drug) => normaliseDrugId(drug?.id || drug?.name) === wanted);
        const amount = Math.max(0, Math.floor(Number(plan?.amount) || 0));
        if (!item || !item.id || amount <= 0) {
          state.drugsDueAt = Date.now() + 1_000;
          state.drugStatus = `${context} · live market changed before purchase`;
          return;
        }
        state.currentAction = `Buying ${amount.toLocaleString('en-GB')} ${String(item.name || wanted)}`;
        state.drugStatus = state.currentAction;
        render();
        result = await gameJson('/api/drugs/buy', {
          method: 'POST',
          body: { drug: String(item.id), amount, ...(marketVersion !== null ? { marketVersion } : {}) },
        });
        fallbackMessage = `Bought ${amount.toLocaleString('en-GB')} ${String(item.name || wanted)}`;
      } else if (plannedAction === 'drive') {
        const index = Number(plan?.locationIndex);
        const destination = Number.isInteger(index) ? locations[index] : null;
        const locationId = Number(destination?.id);
        if (!destination || !Number.isSafeInteger(locationId) || locationId <= 0) {
          state.drugsDueAt = Date.now() + 1_000;
          state.drugStatus = `${context} · recommended destination changed`;
          return;
        }
        state.currentAction = `Driving to ${String(destination.name || 'recommended destination')} for live drug route`;
        state.drugStatus = state.currentAction;
        render();
        result = await gameJson('/api/drugs/drive', { method: 'POST', body: { location: locationId } });
        fallbackMessage = `Driving to ${String(destination.name || 'recommended destination')}`;
      } else {
        state.drugsDueAt = Date.now() + 5_000;
        state.drugStatus = `${context} · unsupported server action`;
        return;
      }

      const message = cleanGameMessage(result?.html || result?.message) || fallbackMessage;
      if (message) log(message, 'ok');
      const driveSecondsRemaining = Number(result?.driveSecondsRemaining ?? result?.secondsRemaining ?? result?.cooldownSeconds);
      const waitMs = await settleDrugAction({
        ok: true,
        gameStatus: 200,
        action: plannedAction,
        driveSecondsRemaining,
        marketChanged: false,
      }, plannedAction === 'drive' ? 500 : 100);
      state.drugsDueAt = Date.now() + waitMs;
      state.currentAction = 'Waiting for next Drug Run action';
      state.drugStatus = `${message || context} · next check in ${formatWait(waitMs)}`;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.drugsDueAt = Date.now() + 250;
        return;
      }
      const message = friendlyGameError(error);
      if (error?.body?.inJail === true || /while you are in jail|sent to jail/i.test(message)) {
        markJailed();
        state.drugsDueAt = Date.now() + CRIME_JAIL_POLL_MS;
        state.currentAction = 'Paused while in jail';
        state.drugStatus = 'Paused while in jail · checking again shortly';
      } else {
        const changed = drugMarketChanged(error);
        const fallback = changed ? 100 : (error?.status === 429 && Number(error?.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 5_000);
        const waitMs = await settleDrugAction({
          ok: false,
          gameStatus: Number(error?.status) || 0,
          retryAfterSeconds: Number(error?.retryAfter) || 0,
          action: plannedAction,
          marketChanged: changed,
        }, fallback);
        state.drugsDueAt = Date.now() + waitMs;
        state.drugStatus = changed
          ? `Drug market rotated · refreshing live recommendation in ${formatWait(waitMs)}`
          : `Drug Run failed: ${message} · retrying in ${formatWait(waitMs)}`;
        if (!changed) log(`Drugs: ${message}`, 'error');
      }
    } finally {
      state.drugsRunning = false;
      render();
    }
  }


  function bigintSafe(value) {
    try {
      const text = String(value ?? '0').replace(/[\s,]/g, '').trim();
      return /^\d{1,36}$/.test(text) ? BigInt(text) : 0n;
    } catch {
      return 0n;
    }
  }

  function compactDuration(seconds) {
    const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${remainder}s`;
    return `${remainder}s`;
  }

  function normalizePlayerName(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function actionRows() {
    return state.players.map((username) => {
      const action = state.playerActions[normalizePlayerName(username)] || {};
      return {
        username,
        kill: action.kill === true,
        beam: action.beam === true,
        mode: action.mode === 'bgs' ? 'bgs' : 'full',
      };
    });
  }

  function savePlayerActions() {
    GM_setValue(KEYS.playerActions, state.playerActions);
    state.playerSearchDueAt = 0;
    state.combatDueAt = 0;
    wakeAutomation();
    render();
  }

  async function runAutoRank() {
    if (!automationAllowed() || !state.settings.autoRank || state.autoRankRunning) return;
    state.autoRankRunning = true;
    markFeatureEpoch('autoRank');
    state.currentAction = 'Checking Auto Rank activity';
    state.autoRankStatus = 'Checking Auto Rank activity';
    render();
    try {
      const status = await gameJson('/api/auto-rank');
      const plan = await plannerRequest('/api/v1/auto-rank/plan', {
        method: 'POST', token,
        body: {
          localEnabled: state.settings.autoRank === true,
          tier: Number(status?.tier),
          sessionActive: status?.sessionActive === true,
          sessionPaused: status?.sessionPaused === true,
          sessionSecondsRemaining: Number(status?.sessionSecondsRemaining),
          sessionEndsAt: status?.sessionEndsAt || '',
          sessionPausedEndsAt: status?.sessionPausedEndsAt || '',
          settings: status?.settings && typeof status.settings === 'object' ? {
            autoCrime: status.settings.autoCrime === true,
            autoGta: status.settings.autoGta === true,
            autoMelt: status.settings.autoMelt === true,
            autoDrugRun: status.settings.autoDrugRun === true,
            autoMeltCarNames: Array.isArray(status.settings.autoMeltCarNames) ? status.settings.autoMeltCarNames : [],
          } : {},
        },
      });

      state.autoRankControls = plan?.controls && typeof plan.controls === 'object'
        ? {
            crimes: plan.controls.crimes === true,
            gta: plan.controls.gta === true,
            melt: plan.controls.melt === true,
            drugs: plan.controls.drugs === true,
          }
        : { crimes:false, gta:false, melt:false, drugs:false };

      if (plan.action === 'disable') {
        state.settings.autoRank = false;
        saveSettings();
        state.autoRankActive = false;
        state.autoRankStatus = plan.status || 'Auto Rank Tier 1 is not unlocked';
        state.autoRankDueAt = Date.now() + safeWaitMs(plan.waitMs, 60_000);
        log('Auto-renew rank switched off — Auto Rank Tier 1 is not unlocked', 'warn');
        return;
      }

      if (plan.action === 'wait') {
        const waitMs = safeWaitMs(plan.waitMs, 10_000);
        state.autoRankActive = plan.sessionActive === true;
        state.autoRankEndsAt = state.autoRankActive ? Date.now() + waitMs : 0;
        if (plan.status === 'active') {
          const controlled = Object.entries(state.autoRankControls).filter(([,value]) => value).map(([key]) => key === 'gta' ? 'GTA' : key);
          state.autoRankStatus = `Active · ${formatWait(waitMs)} remaining${controlled.length ? ` · server: ${controlled.join(', ')}` : ''}`;
        } else if (plan.status === 'paused') {
          state.autoRankStatus = `Paused · ${formatWait(waitMs)} remaining`;
        } else {
          state.autoRankStatus = String(plan.status || 'Waiting');
        }
        state.autoRankDueAt = Date.now() + waitMs;
        return;
      }

      if (plan.action === 'start') {
        state.autoRankStatus = 'Activity expired · starting ranking';
        const started = await gameJson('/api/auto-rank/session/start', { method:'POST' });
        state.autoRankDueAt = Date.now() + 250;
        state.crimesDueAt = 0;
        state.gtaDueAt = 0;
        state.meltDueAt = 0;
        state.drugsDueAt = 0;
        if (started?.sessionActive === true) log('Auto Rank session started', 'ok');
        return;
      }

      state.autoRankDueAt = Date.now() + 10_000;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.autoRankDueAt = Date.now() + 500;
      } else {
        const message = friendlyGameError(error);
        if (error?.status === 400 && /already active/i.test(message)) state.autoRankDueAt = Date.now() + 500;
        else {
          state.autoRankStatus = `Auto Rank check failed: ${message}`;
          state.autoRankDueAt = Date.now() + errorWait(error, 5_000);
          log(`Auto Rank: ${message}`, error?.status === 429 ? 'warn' : 'error');
        }
      }
    } finally {
      state.autoRankRunning = false;
      render();
    }
  }

  async function runPrestige() {
    if (!automationAllowed() || !state.settings.autoPrestige || state.prestigeRunning || state.prestigeComplete) return;
    if (state.inJail) {
      state.prestigeDueAt = Date.now() + 5_000;
      state.prestigeStatus = 'Paused while in jail';
      return;
    }
    state.prestigeRunning = true;
    markFeatureEpoch('prestige');
    state.currentAction = 'Checking prestige eligibility';
    state.prestigeStatus = 'Checking prestige eligibility';
    let dispatched = false;
    render();
    try {
      let data = await gameJson('/api/prestige', { priority:REQUEST_PRIORITY.BACKGROUND });
      let plan = await plannerRequest('/api/v1/prestige/plan', {
        method:'POST', token,
        body: {
          localEnabled: state.settings.autoPrestige === true,
          inJail: state.inJail === true,
          prestigeLevel: data?.prestigeLevel,
          maxPrestigeLevel: data?.maxPrestigeLevel,
          canPrestige: data?.canPrestige === true,
          nextPrestigeLevel: data?.nextPrestigeLevel ?? null,
          nextPrestigeLabel: data?.nextPrestigeLabel || '',
          maxRankName: data?.maxRankName || '',
        },
      });

      if (plan.action === 'complete') {
        state.prestigeComplete = true;
        state.prestigeDueAt = Infinity;
        state.prestigeStatus = plan.status || 'Final prestige entered';
        return;
      }
      if (plan.action !== 'start') {
        state.prestigeStatus = plan.status || 'Waiting for prestige eligibility';
        state.prestigeDueAt = Date.now() + safeWaitMs(plan.waitMs, PRESTIGE_CHECK_MS);
        return;
      }

      // Freeze new rank-writing lanes first, then let any already-dispatched
      // Crime/GTA/Auto-Rank mutation settle before the irreversible prestige.
      state.prestigeCommitting = true;
      state.currentAction = 'Preparing prestige transition';
      state.prestigeStatus = 'Eligible · waiting for ranking actions to finish';
      render();
      await Promise.all(['crime','gta','auto-rank'].map((lane) => state.actionTails.get(lane)));
      if (!automationAllowed() || !state.settings.autoPrestige || state.inJail) {
        throw new ActionCancelledError('Auto-prestige stopped');
      }

      // Re-read after waiting so eligibility is fresh at the actual POST.
      data = await gameJson('/api/prestige', { priority:REQUEST_PRIORITY.ACTION });
      plan = await plannerRequest('/api/v1/prestige/plan', {
        method:'POST', token,
        body: {
          localEnabled: state.settings.autoPrestige === true,
          inJail: state.inJail === true,
          prestigeLevel: data?.prestigeLevel,
          maxPrestigeLevel: data?.maxPrestigeLevel,
          canPrestige: data?.canPrestige === true,
          nextPrestigeLevel: data?.nextPrestigeLevel ?? null,
          nextPrestigeLabel: data?.nextPrestigeLabel || '',
          maxRankName: data?.maxRankName || '',
        },
      });
      if (plan.action !== 'start') {
        state.prestigeStatus = plan.status || 'Prestige eligibility changed';
        state.prestigeDueAt = Date.now() + safeWaitMs(plan.waitMs, PRESTIGE_CHECK_MS);
        return;
      }

      const fromLevel = Number(data.prestigeLevel);
      state.currentAction = 'Starting next prestige';
      state.prestigeStatus = `Starting ${plan.status || `prestige ${fromLevel + 1}`}`;
      render();
      dispatched = true;
      const result = await gameJson('/api/prestige/start', { method:'POST', timeoutMs:30_000, priority:REQUEST_PRIORITY.ACTION });
      if (Number(result?.prestigeLevel) !== fromLevel + 1 || result?.canPrestige === true) {
        throw new Error('Prestige result could not be verified');
      }
      log(`${result?.prestigeLabel || `Prestige ${result.prestigeLevel}`} started`, 'ok');
      state.prestigeComplete = Number(result?.prestigeLevel) === Number(result?.maxPrestigeLevel);
      state.prestigeStatus = state.prestigeComplete
        ? 'Final prestige entered — no further prestige checks'
        : `${result?.prestigeLabel || `Prestige ${result?.prestigeLevel}`} started · ranking continues`;
      state.prestigeDueAt = state.prestigeComplete ? Infinity : Date.now() + PRESTIGE_CHECK_MS;
      state.crimesDueAt = 0;
      state.gtaDueAt = 0;
      state.meltDueAt = 0;
      state.autoRankDueAt = 0;
      state.playerSearchDueAt = 0;
      state.combatDueAt = 0;
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.searchData = null;
      state.searchDataLoadedAt = 0;
      state.killDataRevision += 1;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.prestigeDueAt = Date.now() + 1_000;
      } else {
        state.prestigeStatus = dispatched
          ? 'Prestige result needs checking · rechecking in 3 minutes or after server delay'
          : `Prestige check delayed: ${friendlyGameError(error)}`;
        state.prestigeDueAt = Date.now() + Math.max(PRESTIGE_CHECK_MS, errorWait(error, PRESTIGE_CHECK_MS));
        log(`Auto-prestige: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
      }
    } finally {
      state.prestigeRunning = false;
      state.prestigeCommitting = false;
      render();
    }
  }

  async function runAutoGun() {
    if (!automationAllowed() || !state.settings.autoBuyGun || state.autoGunRunning) return;
    if (state.inJail) {
      state.autoGunDueAt = Date.now() + 5_000;
      state.autoGunStatus = 'Paused while in jail';
      return;
    }
    state.autoGunRunning = true;
    markFeatureEpoch('autoGun');
    const selectedGunId = Number(state.settings.autoGunId);
    state.currentAction = 'Checking gun';
    state.autoGunStatus = 'Checking gun';
    render();
    try {
      let stats = await gameJson('/api/player/stats');
      if (Number(stats?.health) <= 0) {
        stopForDeath();
        return;
      }

      let plan = await plannerRequest('/api/v1/auto-gun/plan', {
        method:'POST', token,
        body: {
          localEnabled: state.settings.autoBuyGun === true,
          inJail: state.inJail === true,
          gunId: state.settings.autoGunId,
          currentGun: stats?.gun || '',
          health: Number(stats?.health),
        },
      });

      if (plan.action === 'dead') {
        stopForDeath();
        return;
      }
      if (plan.action === 'equipped') {
        state.autoGunStatus = plan.status || `Gun equipped: ${stats?.gun}`;
        state.autoGunDueAt = Infinity;
        return;
      }

      const shop = await gameJson('/api/weaponry');
      const bank = await gameJson('/api/bank');
      const first = Array.isArray(shop?.guns) ? shop.guns.find((gun) => Number(gun?.id) === 1) : null;
      const item = Array.isArray(shop?.guns) ? shop.guns.find((gun) => Number(gun?.id) === Number(state.settings.autoGunId)) : null;

      plan = await plannerRequest('/api/v1/auto-gun/plan', {
        method:'POST', token,
        body: {
          localEnabled: state.settings.autoBuyGun === true,
          inJail: state.inJail === true,
          gunId: state.settings.autoGunId,
          currentGun: stats?.gun || '',
          health: Number(stats?.health),
          cash: String(bank?.money ?? '0'),
          shop: {
            location: String(shop?.location || ''),
            firstPurchasable: first?.purchasable === true ? true : first?.purchasable === false ? false : null,
            factoryOwned: shop?.gunFactory?.owned === true,
            factoryMine: shop?.gunFactory?.isMine === true,
            item: item ? {
              id: Number(item.id),
              name: String(item.name || ''),
              price: Number(item.price),
              purchasable: item.purchasable === true,
            } : null,
          },
        },
      });

      if (plan.action !== 'buy') {
        state.autoGunStatus = plan.status || 'Waiting to buy gun';
        state.autoGunDueAt = Date.now() + safeWaitMs(plan.waitMs, 60_000);
        return;
      }

      // Verify the player is still unarmed immediately before purchase.
      stats = await gameJson('/api/player/stats');
      if (stats?.gun !== 'None') {
        state.autoGunStatus = `Gun equipped: ${stats?.gun}`;
        state.autoGunDueAt = Infinity;
        return;
      }

      if (!state.settings.autoBuyGun || Number(state.settings.autoGunId) !== selectedGunId || Number(plan.gunId) !== selectedGunId) {
        throw new ActionCancelledError('Auto-buy gun selection changed');
      }
      const result = await gameJson('/api/weaponry/buy/gun', {
        method:'POST',
        timeoutMs:30_000,
        body:{ gunId:selectedGunId, location:String(plan.location) },
        validate: () => {
          if (!featureEpochCurrent('autoGun') || !state.settings.autoBuyGun || Number(state.settings.autoGunId) !== selectedGunId) {
            throw new ActionCancelledError('Auto-buy gun selection changed');
          }
        },
      });
      const message = cleanGameMessage(result?.html) || `Bought ${plan.expectedName || 'gun'}`;
      log(message, 'ok');
      state.autoGunStatus = `Gun equipped: ${plan.expectedName || 'selected gun'}`;
      state.autoGunDueAt = Infinity;
      state.combatDueAt = 0;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.autoGunStatus = state.settings.autoBuyGun ? 'Gun selection changed · rechecking' : 'Auto-buy gun disabled';
        state.autoGunDueAt = Date.now() + 250;
      } else {
        state.autoGunStatus = `Gun purchase/check delayed: ${friendlyGameError(error)}`;
        state.autoGunDueAt = Date.now() + Math.max(60_000, errorWait(error, 60_000));
        log(`Auto-buy gun: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
      }
    } finally {
      state.autoGunRunning = false;
      render();
    }
  }

  function addDiscoveredPlayers(values, source = '') {
    if (!state.settings.discoverPlayers) return 0;
    const own = normalizePlayerName(state.viewerUsername);
    const before = state.players.length;
    const combined = [...state.players];
    const existing = new Set(state.players.map(normalizePlayerName));
    for (const raw of Array.isArray(values) ? values : []) {
      const name = String(raw || '').trim();
      const key = normalizePlayerName(name);
      if (!name || name.length > 30 || !key || key === own || existing.has(key)) continue;
      existing.add(key);
      combined.push(name);
      if (combined.length >= 1000) break;
    }
    state.players = sanitisePlayers(combined);
    if (state.players.length !== before) {
      GM_setValue(KEYS.playerList, state.players);
      state.playerSearchDueAt = 0;
      state.combatDueAt = 0;
      state.playerDiscoveryStatus = `${state.players.length.toLocaleString('en-GB')} players collected${source ? ` · last: ${source}` : ''}`;
      renderPlayerActions();
      wakeAutomation();
    } else {
      state.playerDiscoveryStatus = `${state.players.length.toLocaleString('en-GB')} players collected`;
    }
    return state.players.length - before;
  }

  function removeSavedPlayer(name) {
    const key = normalizePlayerName(name);
    if (!key) return;
    const before = state.players.length;
    state.players = state.players.filter((value) => normalizePlayerName(value) !== key);
    if (state.players.length !== before) GM_setValue(KEYS.playerList, state.players);
    delete state.playerActions[key];
    GM_setValue(KEYS.playerActions, state.playerActions);
    if (state.activeBodyguard && (normalizePlayerName(state.activeBodyguard.name) === key || normalizePlayerName(state.activeBodyguard.primary) === key)) {
      state.activeBodyguard = null;
    }
    renderPlayerActions();
  }

  async function runPlayerDiscovery() {
    if (!automationAllowed() || !state.settings.discoverPlayers || state.playerDiscoveryRunning) return;
    state.playerDiscoveryRunning = true;
    state.currentAction = 'Checking visible online players';
    render();
    try {
      const data = await gameJson('/api/pages/online');
      if (data?.viewerUsername) state.viewerUsername = String(data.viewerUsername);
      const names = (Array.isArray(data?.players) ? data.players : [])
        .filter((player) => player && player.usernameHidden !== true)
        .map((player) => player.username);
      addDiscoveredPlayers(names, 'Players Online');
      state.playerDiscoveryDueAt = Date.now() + ONLINE_DISCOVERY_MS;
    } catch (error) {
      state.playerDiscoveryStatus = `Players Online scan failed: ${friendlyGameError(error)}`;
      state.playerDiscoveryDueAt = Date.now() + errorWait(error, 5_000);
    } finally {
      state.playerDiscoveryRunning = false;
      render();
    }
  }

  function gangRosterNames(profile) {
    if (!profile || typeof profile !== 'object') return [];
    return [
      profile.boss,
      ...(Array.isArray(profile.underboss) ? profile.underboss : []),
      ...(Array.isArray(profile.recruiters) ? profile.recruiters : []),
      ...(Array.isArray(profile.members) ? profile.members : []),
    ];
  }

  async function runGangDiscovery() {
    if (!automationAllowed() || !state.settings.discoverPlayers || state.gangDiscoveryRunning) return;
    state.gangDiscoveryRunning = true;
    try {
      state.currentAction = 'Scanning living gang members';
      render();
      const directory = await gameJson('/api/gangs');
      const gangs = (Array.isArray(directory?.gangs) ? directory.gangs : [])
        .map((gang) => Number(gang?.legacyId))
        .filter((id) => Number.isSafeInteger(id) && id > 0);
      let scanned = 0;
      for (const id of gangs) {
        if (!automationAllowed() || !state.settings.discoverPlayers) break;
        try {
          const profile = await gameJson(`/api/gangs/gang/${encodeURIComponent(String(id))}`);
          addDiscoveredPlayers(gangRosterNames(profile), `gang ${id}`);
          scanned += 1;
        } catch (error) {
          if (error?.status === 404) continue;
          throw error;
        }
      }
      state.playerDiscoveryStatus = `${state.players.length.toLocaleString('en-GB')} players collected · scanned ${scanned}/${gangs.length} gangs`;
      state.gangDiscoveryDueAt = Date.now() + GANG_DISCOVERY_MS;
    } catch (error) {
      state.playerDiscoveryStatus = `Gang scan failed: ${friendlyGameError(error)}`;
      state.gangDiscoveryDueAt = Date.now() + errorWait(error, 10_000);
    } finally {
      state.gangDiscoveryRunning = false;
      render();
    }
  }

  function discoverStealVictim(crime, result) {
    if (!state.settings.discoverPlayers || !crime || crime.slug !== 'steal' || result?.success !== true) return;
    const match = String(result?.html || '').match(/\bfrom\s+<b>([^<]+)<\/b>/i);
    if (!match) return;
    const holder = document.createElement('div');
    holder.innerHTML = match[1];
    const name = String(holder.textContent || '').trim();
    if (name) addDiscoveredPlayers([name], 'Steal from a player');
  }

  async function currentProtectionState(force = false) {
    const now = Date.now();
    const cacheMs = state.deathProtected ? 60_000 : 15_000;
    if (!force && state.deathProtectionCheckedAt > 0 && now - state.deathProtectionCheckedAt < cacheMs) {
      const elapsed = Math.floor((now - state.deathProtectionCheckedAt) / 1000);
      const remaining = Math.max(0, state.deathProtectionSecondsRemaining - elapsed);
      if (!state.deathProtected || remaining > 0) {
        return { active: state.deathProtected, secondsRemaining: remaining };
      }
    }
    const stats = await gameJson('/api/player/stats');
    if (Number(stats?.health) <= 0) {
      stopForDeath();
      return { active:false, secondsRemaining:0, dead:true };
    }
    state.deathProtected = stats?.deathProtected === true;
    state.deathProtectionCheckedAt = Date.now();
    state.deathProtectionSecondsRemaining = state.deathProtected
      ? Math.max(0, Math.ceil(Number(stats?.deathProtectionSecondsRemaining) || 0))
      : 0;
    return { active: state.deathProtected, secondsRemaining: state.deathProtectionSecondsRemaining };
  }

  function resetProtectionState(assumeProtected = true) {
    state.deathProtected = assumeProtected === true;
    state.deathProtectionCheckedAt = 0;
    state.deathProtectionSecondsRemaining = 0;
  }

  function protectionMutationSafe() {
    return state.deathProtected === false && state.deathProtectionCheckedAt > 0;
  }

  function killSearchStillWanted(username) {
    const key = normalizePlayerName(username);
    if (!key || !automationAllowed()) return false;
    const saved = state.players.some((name) => normalizePlayerName(name) === key);
    const action = state.playerActions[key];
    let guard = false;
    if (state.activeBodyguard && normalizePlayerName(state.activeBodyguard.name) === key) {
      const primaryAction = state.playerActions[normalizePlayerName(state.activeBodyguard.primary)];
      guard = Boolean(primaryAction && (primaryAction.kill === true || primaryAction.beam === true));
    }
    return guard || Boolean(action && (action.kill === true || action.beam === true)) || (state.settings.searchPlayers && saved);
  }

  async function performKillSearch(username, label = 'Searching') {
    const name = String(username || '').trim();
    const key = normalizePlayerName(name);
    if (!name || !key) return false;
    if (state.searchesInFlight.has(key)) return state.searchesInFlight.get(key);

    const operation = (async () => {
      try {
        state.currentAction = `${label} ${name}`;
        state.playerSearchStatus = `${label} ${name}`;
        render();
        const protection = await currentProtectionState(true);
        if (protection.dead || protection.active) {
          state.playerSearchStatus = protection.active ? 'Death protection active · searches paused' : state.playerSearchStatus;
          return false;
        }
        const result = await gameJson('/api/kill/search', {
          method:'POST',
          body:{ username:name },
          priority:REQUEST_PRIORITY.NORMAL,
          validate: () => {
            if (!protectionMutationSafe()) throw new ActionCancelledError('Death protection active or unverified');
            if (!killSearchStillWanted(name)) throw new ActionCancelledError('Kill search target changed');
          },
        });
        state.searchData = result?.data && typeof result.data === 'object' ? result.data : null;
        state.searchDataLoadedAt = Date.now();
        state.killDataRevision += 1;
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.playerSearchBackoff.delete(key);
        state.playerSearchStatus = `Last searched: ${name}`;
        state.playerSearchDueAt = 0;
        state.combatDueAt = 0;
        return result;
      } catch (error) {
        if (error instanceof ActionCancelledError) throw error;
        const message = friendlyGameError(error);
        if (error?.status === 404 && /player not found/i.test(message)) {
          removeSavedPlayer(name);
          state.playerSearchStatus = `${name} no longer exists`;
          return false;
        }
        if (![401,408,429].includes(Number(error?.status)) && Number(error?.status) < 500 && !error?.body?.dead && !error?.body?.inJail) {
          const long = error?.status === 404 || /dead|cannot be killed|protected from death|yourself/i.test(message);
          state.playerSearchBackoff.set(key, Date.now() + (long ? 6 * 60 * 60_000 : 15 * 60_000));
          state.playerSearchStatus = `${name} temporarily skipped`;
          log(`Kill search ${name}: ${message}`, 'warn');
          return false;
        }
        throw error;
      }
    })();

    state.searchesInFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      state.searchesInFlight.delete(key);
    }
  }

  async function runPlayerSearch() {
    if (!automationAllowed() || state.playerSearchRunning || (!state.settings.searchPlayers && !hasCombatSelections())) return;
    state.playerSearchRunning = true;
    markFeatureEpoch('search');
    try {
      const protection = await currentProtectionState();
      if (protection.dead) return;

      const revision = state.killDataRevision;
      const useCache = Boolean(state.searchData && Date.now() - state.searchDataLoadedAt < 5_000);
      const data = useCache
        ? state.searchData
        : await gameJson('/api/kill', { priority:REQUEST_PRIORITY.NORMAL });
      if (revision !== state.killDataRevision) {
        state.playerSearchDueAt = Date.now();
        return;
      }
      state.searchData = data;
      if (!useCache) state.searchDataLoadedAt = Date.now();
      if (data?.player?.alive === false) {
        stopForDeath();
        return;
      }
      if (data?.player?.username) state.viewerUsername = String(data.player.username);

      const now = Date.now();
      const backoffs = [];
      for (const [username, until] of state.playerSearchBackoff.entries()) {
        if (until <= now) state.playerSearchBackoff.delete(username);
        else backoffs.push({ username, remainingMs: until - now });
      }

      const plan = await plannerRequest('/api/v1/search/plan', {
        method:'POST', token,
        body: {
          searchPlayers: state.settings.searchPlayers === true,
          inJail: state.inJail === true,
          deathProtected: protection.active === true,
          deathProtectionSecondsRemaining: protection.secondsRemaining,
          viewerUsername: state.viewerUsername,
          savedPlayers: state.players,
          actions: actionRows(),
          pending: (Array.isArray(data?.pending) ? data.pending : []).map((row) => ({
            username:String(row?.username || ''),
            secondsUntilFound:Number(row?.secondsUntilFound),
          })),
          found: (Array.isArray(data?.found) ? data.found : []).map((row) => ({
            username:String(row?.username || ''),
            secondsRemaining:Number(row?.secondsRemaining),
            location:String(row?.location || ''),
            canShootHere:row?.canShootHere === true,
          })),
          activeBodyguard: state.activeBodyguard,
          backoffs,
        },
      });

      if (plan.action === 'search') {
        await performKillSearch(plan.username, plan.label || 'Searching');
        state.playerSearchDueAt = Date.now() + 100;
      } else {
        state.playerSearchStatus = plan.status || 'Waiting to search players';
        state.playerSearchDueAt = Date.now() + safeWaitMs(plan.waitMs, 60_000);
      }
    } catch (error) {
      state.searchData = null;
      state.searchDataLoadedAt = 0;
      if (error instanceof ActionCancelledError) {
        state.playerSearchDueAt = Date.now() + 250;
      } else {
        state.playerSearchStatus = `Player search failed: ${friendlyGameError(error)}`;
        state.playerSearchDueAt = Date.now() + errorWait(error, 5_000);
        log(`Player search: ${friendlyGameError(error)}`, error?.status === 429 ? 'warn' : 'error');
      }
    } finally {
      state.playerSearchRunning = false;
      render();
    }
  }

  function shootWaitMs() {
    const now = Date.now();
    state.shotTimes = state.shotTimes.filter((at) => now - at < SHOOT_WINDOW_MS);
    if (state.shotTimes.length < SHOOT_WINDOW_LIMIT) return 0;
    return Math.max(1, state.shotTimes[0] + SHOOT_WINDOW_MS - now + 5);
  }

  function combatCommandStillWanted(command) {
    const primary = String(command?.primary || command?.username || '').trim();
    const key = normalizePlayerName(primary);
    if (!key || !automationAllowed() || !featureEpochCurrent('combat')) return false;
    const action = state.playerActions[key];
    if (!action) return false;
    const follow = command?.follow === true;
    if (follow) {
      if (action.beam !== true || normalizePlayerName(activeBeamName()) !== key) return false;
      const currentMode = action.mode === 'bgs' ? 'bgs' : 'full';
      const plannedMode = command?.mode === 'bgs' ? 'bgs' : 'full';
      if (currentMode !== plannedMode) return false;
      return true;
    }
    return action.kill === true;
  }

  async function shootCombat(command) {
    const wait = shootWaitMs();
    if (wait > 0) {
      state.combatStatus = `Shoot pacing · ${formatWait(wait)}`;
      state.combatDueAt = Date.now() + wait;
      return;
    }

    const username = String(command?.username || '').trim();
    const bullets = Math.floor(Number(command?.bullets));
    if (!username || !Number.isSafeInteger(bullets) || bullets < 1) throw new Error('Invalid combat command');

    state.currentAction = `Shooting ${username} with ${bullets.toLocaleString('en-GB')} bullet${bullets === 1 ? '' : 's'}`;
    state.combatStatus = state.currentAction;
    render();
    state.shotTimes.push(Date.now());
    const killRevision = state.killDataRevision;

    try {
      const result = await gameJson('/api/kill/shoot', {
        method:'POST',
        timeoutMs:130_000,
        body:{ username, bullets, showName:false, message:'' },
        validate: () => {
          if (!protectionMutationSafe()) throw new ActionCancelledError('Death protection active or unverified');
          if (!combatCommandStillWanted(command)) throw new ActionCancelledError('Combat target changed');
          const primary = String(command?.primary || command?.username || '').trim();
          const action = state.playerActions[normalizePlayerName(primary)];
          const ownerShot = normalizePlayerName(username) === normalizePlayerName(primary) && String(command?.role || 'owner') !== 'bodyguard';
          if (command?.follow === true && action?.mode === 'bgs' && ownerShot && bullets !== 1) {
            throw new ActionCancelledError('BG-only Beam may probe the owner with exactly one bullet only');
          }
        },
      });

      if (result?.processed === true) {
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatStatus = `Shot at ${username} was processed; refreshing before retry`;
        state.combatDueAt = Date.now() + 5_000;
        return;
      }
      if (killRevision === state.killDataRevision && result?.data && typeof result.data === 'object') {
        state.killData = result.data;
        state.killDataLoadedAt = Date.now();
      } else {
        state.killData = null;
        state.killDataLoadedAt = 0;
      }

      const primary = String(command?.primary || username);
      const role = String(command?.role || 'owner');
      if (result?.blockingBodyguard) {
        const guard = String(result.blockingBodyguard);
        const same = state.activeBodyguard &&
          normalizePlayerName(state.activeBodyguard.primary) === normalizePlayerName(primary) &&
          normalizePlayerName(state.activeBodyguard.name) === normalizePlayerName(guard);
        let confirmedAt = same ? Number(state.activeBodyguard.confirmedAt) || 0 : 0;
        if (role === 'confirm_guard' && normalizePlayerName(command?.guardName) === normalizePlayerName(guard)) {
          confirmedAt = Date.now();
        }
        state.activeBodyguard = { primary, name:guard, confirmedAt };
        state.combatStatus = `Bodyguard found: ${guard}`;
        state.playerSearchDueAt = 0;
      } else if (result?.killed === true) {
        if (role === 'bodyguard') {
          log(`Bodyguard ${username} removed — returning to ${primary}`, 'ok');
          state.activeBodyguard = null;
        } else {
          const key = normalizePlayerName(primary);
          const action = state.playerActions[key] || {};
          state.playerActions[key] = { ...action, kill:false, beam:false };
          GM_setValue(KEYS.playerActions, state.playerActions);
          state.activeBodyguard = null;
          state.combatStatus = `${primary} killed`;
          log(`${primary} killed`, 'ok');
        }
      } else {
        if (role === 'confirm_guard') state.activeBodyguard = null;
        const message = cleanGameMessage(result?.html || result?.message);
        if (message) state.combatStatus = message;
      }
      state.combatDueAt = command?.follow === true ? Date.now() : Date.now() + 1_000;
    } catch (error) {
      const message = friendlyGameError(error);
      if (/bodyguard assignment changed/i.test(message)) {
        state.activeBodyguard = null;
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatStatus = 'Bodyguard assignment changed — refreshing';
        state.combatDueAt = Date.now();
        return;
      }
      throw error;
    }
  }

  async function executeCombatTravel(command, killData) {
    const targetLocation = String(command?.targetLocation || '');
    const currentLocation = String(killData?.player?.location || '');
    const mode = state.settings.beamTravelMode;

    let drug = null;
    let airport = null;
    if (mode !== 'airport') {
      drug = await gameJson('/api/drugs?page=1');
    }
    if (mode !== 'car') {
      airport = await gameJson('/api/airport');
    }

    const drugLocations = Array.isArray(drug?.locations) ? drug.locations : [];
    const airportDestinations = Array.isArray(airport?.destinations) ? airport.destinations : [];
    const plan = await plannerRequest('/api/v1/combat/travel-plan', {
      method:'POST', token,
      body: {
        mode,
        targetLocation,
        currentLocation,
        repairThreshold: state.settings.drugRepairDamage,
        drug: {
          favouriteExists: Boolean(drug?.favouriteCar),
          favouriteDamage: Number(drug?.favouriteCar?.damage || 0),
          driveAvailable: drug?.driveAvailable === true,
          driveSecondsRemaining: Number(drug?.driveSecondsRemaining),
          locations: drugLocations.slice(0,20).map((row,index) => ({ index, name:String(row?.name || '') })),
        },
        airport: {
          available: airport?.available === true,
          secondsRemaining: Number(airport?.secondsRemaining),
          destinations: airportDestinations.slice(0,30).map((row,index) => ({ index, name:String(row?.name || '') })),
        },
      },
    });

    if (plan.action === 'none') {
      state.combatDueAt = Date.now() + 500;
      return;
    }
    if (plan.action === 'repair_car') {
      const id = Number(drug?.favouriteCar?.publicId);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Favourite car ID unavailable');
      const result = await gameJson(`/api/gta/cars/${encodeURIComponent(String(id))}/repair`, {
        method:'POST',
        validate: () => { if (!combatCommandStillWanted(command)) throw new ActionCancelledError('Beam target changed'); },
      });
      const message = cleanGameMessage(result?.html);
      if (message) log(message, 'ok');
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.combatDueAt = Date.now();
      return;
    }
    if (plan.action === 'drive') {
      const destination = drugLocations[Number(plan.locationIndex)];
      const id = Number(destination?.id);
      if (!destination || !Number.isSafeInteger(id) || id <= 0) throw new Error('Beam drive destination changed');
      const result = await gameJson('/api/drugs/drive', {
        method:'POST',
        body:{ location:id },
        validate: () => { if (!combatCommandStillWanted(command)) throw new ActionCancelledError('Beam target changed'); },
      });
      const message = cleanGameMessage(result?.html);
      if (message) log(message, 'ok');
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.combatDueAt = Date.now();
      state.drugsDueAt = 0;
      return;
    }
    if (plan.action === 'fly') {
      const destination = airportDestinations[Number(plan.locationIndex)];
      const id = Number(destination?.id);
      if (!destination || !Number.isSafeInteger(id) || id <= 0) throw new Error('Beam airport destination changed');
      const result = await gameJson('/api/airport/fly', {
        method:'POST',
        body:{ location:id },
        validate: () => { if (!combatCommandStillWanted(command)) throw new ActionCancelledError('Beam target changed'); },
      });
      const message = cleanGameMessage(result?.html);
      if (message) log(message, 'ok');
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.combatDueAt = Date.now();
      return;
    }

    state.combatStatus = plan.status || `Waiting to travel to ${targetLocation}`;
    state.combatDueAt = Date.now() + safeWaitMs(plan.waitMs, 10_000);
  }

  async function runCombat() {
    if (!automationAllowed() || !hasCombatSelections() || state.combatRunning) return;
    state.combatRunning = true;
    markFeatureEpoch('combat');
    state.currentAction = 'Checking Kill / Beam';
    render();
    try {
      const protection = await currentProtectionState();
      if (protection.dead) return;

      const canReuseBeamData = Boolean(
        activeBeamName() &&
        state.killData &&
        Date.now() - state.killDataLoadedAt <= 1_500
      );
      const data = canReuseBeamData
        ? state.killData
        : await gameJson('/api/kill', { priority:REQUEST_PRIORITY.RAPID });
      if (!canReuseBeamData) {
        state.killData = data;
        state.killDataLoadedAt = Date.now();
      }
      if (data?.player?.alive === false) {
        stopForDeath();
        return;
      }
      if (data?.player?.username) state.viewerUsername = String(data.player.username);

      const plan = await plannerRequest('/api/v1/combat/plan', {
        method:'POST', token,
        body: {
          inJail: state.inJail === true,
          deathProtected: protection.active === true,
          actions: actionRows(),
          activeBodyguard: state.activeBodyguard,
          player: {
            username:String(data?.player?.username || ''),
            alive:data?.player?.alive !== false,
            gun:String(data?.player?.gun || ''),
            bullets:Number(data?.player?.bullets),
            location:String(data?.player?.location || ''),
          },
          pending:(Array.isArray(data?.pending) ? data.pending : []).map((row) => ({
            username:String(row?.username || ''),
            secondsUntilFound:Number(row?.secondsUntilFound),
          })),
          found:(Array.isArray(data?.found) ? data.found : []).map((row) => ({
            username:String(row?.username || ''),
            secondsRemaining:Number(row?.secondsRemaining),
            location:String(row?.location || ''),
            canShootHere:row?.canShootHere === true,
          })),
        },
      });

      state.combatStatus = plan.status || 'Kill and Beam active';

      if (plan.action === 'dead') {
        stopForDeath();
        return;
      }
      if (plan.action === 'need_gun') {
        if (state.settings.autoBuyGun) {
          state.autoGunDueAt = 0;
          state.combatStatus = 'Waiting for automatic gun purchase';
          state.combatDueAt = Date.now() + safeWaitMs(plan.waitMs, 1_000);
        } else {
          state.combatStatus = 'Buy a gun or enable Auto-buy gun';
          state.combatDueAt = Date.now() + 30_000;
        }
        return;
      }
      if (plan.action === 'wait') {
        state.combatDueAt = Date.now() + safeWaitMs(plan.waitMs, 1_000);
        return;
      }
      if (plan.action === 'search') {
        await performKillSearch(plan.username, plan.label || 'Searching');
        state.combatDueAt = Date.now();
        return;
      }
      if (plan.action === 'travel') {
        await executeCombatTravel(plan, data);
        return;
      }
      if (plan.action === 'shoot') {
        await shootCombat(plan);
        return;
      }
      if (plan.action === 'prepare') {
        const prepared = await gameJson('/api/kill/prepare', {
          method:'POST',
          body:{ username:String(plan.username) },
          validate: () => {
            if (!protectionMutationSafe()) throw new ActionCancelledError('Death protection active or unverified');
            if (!combatCommandStillWanted(plan)) throw new ActionCancelledError('Combat target changed');
          },
        });
        const after = await plannerRequest('/api/v1/combat/after-prepare', {
          method:'POST', token,
          body: {
            username:String(plan.username),
            primary:String(plan.primary || plan.username),
            role:String(plan.role || 'owner'),
            requiredBullets:Number(prepared?.bullets),
            availableBullets:Number(data?.player?.bullets),
          },
        });
        if (after.action === 'shoot') {
          await shootCombat({ ...plan, ...after });
        } else {
          state.combatStatus = after.status || 'Waiting for bullets';
          state.combatDueAt = Date.now() + safeWaitMs(after.waitMs, 30_000);
        }
        return;
      }

      state.combatDueAt = Date.now() + 1_000;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        state.combatDueAt = Date.now() + 250;
        return;
      }
      const message = friendlyGameError(error);
      if (/currently in|travel to|has not been found/i.test(message)) {
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatDueAt = Date.now();
      } else {
        state.combatStatus = `Combat failed: ${message}`;
        state.combatDueAt = Date.now() + errorWait(error, 5_000);
        log(`Combat: ${message}`, error?.status === 429 ? 'warn' : 'error');
      }
    } finally {
      state.combatRunning = false;
      render();
    }
  }

  async function refreshQuicktradeCatalog() {
    if (!token) return;
    const host = document.querySelector('#ul-simple-bot');
    try {
      if (host) host.querySelector('#ul-simple-qt-status').textContent = 'Loading perk names…';
      const data = await gameJson('/api/qt?a=perks&v=con');
      const names = new Set(state.qtCatalog);
      for (const offer of Array.isArray(data?.perkOffers) ? data.perkOffers : []) {
        const label = String(offer?.label || '').trim();
        if (label) names.add(label);
      }
      state.qtCatalog = [...names].sort((a,b) => a.localeCompare(b)).slice(0,1000);
      state.qtStatus = `Loaded ${state.qtCatalog.length} perk names. Type the exact perk name into the rule box.`;
      renderQuicktrade();
    } catch (error) {
      state.qtStatus = `Could not load perks: ${friendlyGameError(error)}`;
      renderQuicktrade();
    }
  }

  function quicktradeDefinitelyRejected(error) {
    return [400,401,403,404,409,429].includes(Number(error?.status));
  }

  function quicktradeReserve(candidate) {
    const tokenId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (candidate.kind === 'points') {
      const before = bigintSafe(state.qt.pointsRemaining);
      const units = bigintSafe(candidate.units);
      const after = before >= units ? before - units : 0n;
      state.qt.pointsRemaining = after.toString();
      state.qt.pending = {
        token:tokenId, kind:'points', units:units.toString(),
        previousRemaining:before.toString(), reservedRemaining:after.toString(),
      };
    } else {
      const rule = state.qt.rules.find((row) => row.id === candidate.ruleId);
      if (!rule) throw new Error('Quicktrade rule disappeared');
      const before = bigintSafe(rule.remaining);
      const after = before > 0n ? before - 1n : 0n;
      rule.remaining = after.toString();
      state.qt.pending = {
        token:tokenId, kind:'perks', ruleId:rule.id, units:'1',
        previousRemaining:before.toString(), reservedRemaining:after.toString(),
      };
    }
    saveQt();
    renderQuicktrade();
    return tokenId;
  }

  function quicktradeRestorePending() {
    const pending = state.qt.pending;
    if (!pending) return;
    if (pending.kind === 'points' && pending.quantityEdited !== true && state.qt.pointsRemaining === pending.reservedRemaining) {
      state.qt.pointsRemaining = pending.previousRemaining;
    } else if (pending.kind === 'perks' && pending.quantityEdited !== true) {
      const rule = state.qt.rules.find((row) => row.id === pending.ruleId);
      if (rule && rule.remaining === pending.reservedRemaining) rule.remaining = pending.previousRemaining;
    }
    state.qt.pending = null;
    saveQt();
    renderQuicktrade();
  }

  function quicktradeClearPending() {
    state.qt.pending = null;
    saveQt();
    renderQuicktrade();
  }

  function quicktradeCandidateStillAllowed(candidate) {
    if (!candidate || state.inJail || !automationAllowed() || state.qt.pending) return false;
    if (candidate.kind === 'points') {
      const units = bigintSafe(candidate.units);
      const price = bigintSafe(candidate.price);
      return state.qt.pointsEnabled === true && units > 0n && price > 0n &&
        units <= bigintSafe(state.qt.pointsRemaining) && price <= bigintSafe(state.qt.pointsMaxPrice);
    }
    if (candidate.kind === 'perks') {
      const rule = state.qt.rules.find((row) => row.id === candidate.ruleId);
      if (!state.qt.perksEnabled || !rule || rule.enabled === false || bigintSafe(rule.remaining) <= 0n) return false;
      return String(rule.label) === String(candidate.label || '') &&
        String(rule.currency) === String(candidate.currency || '') &&
        bigintSafe(candidate.price) > 0n && bigintSafe(candidate.price) <= bigintSafe(rule.maxPrice);
    }
    return false;
  }

  function quicktradeReservedCandidateStillAllowed(candidate, pendingToken) {
    const pending = state.qt.pending;
    if (!candidate || !pending || pending.token !== pendingToken || pending.quantityEdited === true ||
        state.inJail || !automationAllowed() || !featureEpochCurrent('quicktrade')) return false;
    if (candidate.kind === 'points' && pending.kind === 'points') {
      return state.qt.pointsEnabled === true && bigintSafe(candidate.price) > 0n &&
        bigintSafe(candidate.price) <= bigintSafe(state.qt.pointsMaxPrice) &&
        pending.units === String(candidate.units) && state.qt.pointsRemaining === pending.reservedRemaining;
    }
    if (candidate.kind === 'perks' && pending.kind === 'perks' && pending.ruleId === candidate.ruleId) {
      const rule = state.qt.rules.find((row) => row.id === candidate.ruleId);
      return state.qt.perksEnabled === true && Boolean(rule) && rule.enabled !== false &&
        String(rule.label) === String(candidate.label || '') && String(rule.currency) === String(candidate.currency || '') &&
        bigintSafe(candidate.price) > 0n && bigintSafe(candidate.price) <= bigintSafe(rule.maxPrice) &&
        rule.remaining === pending.reservedRemaining;
    }
    return false;
  }

  function quicktradeFundingStillAllowed(candidate, pendingToken) {
    const pending = state.qt.pending;
    if (!candidate || !pending || pending.kind !== 'swiss' || pending.token !== pendingToken ||
        state.inJail || !automationAllowed() || !featureEpochCurrent('quicktrade')) return false;
    if (candidate.kind === 'points') {
      return state.qt.pointsEnabled === true && bigintSafe(candidate.units) <= bigintSafe(state.qt.pointsRemaining) &&
        bigintSafe(candidate.price) <= bigintSafe(state.qt.pointsMaxPrice);
    }
    const rule = state.qt.rules.find((row) => row.id === candidate.ruleId);
    return candidate.kind === 'perks' && state.qt.perksEnabled === true && Boolean(rule) && rule.enabled !== false &&
      bigintSafe(rule.remaining) > 0n && String(rule.label) === String(candidate.label || '') &&
      String(rule.currency) === String(candidate.currency || '') && bigintSafe(candidate.price) <= bigintSafe(rule.maxPrice);
  }

  async function verifyQuicktradeCandidate(candidate) {
    if (candidate.kind === 'points') {
      const data = await gameJson('/api/qt?a=points');
      const offer = (Array.isArray(data?.pointsOffers) ? data.pointsOffers : []).find((row) => String(row?.id) === String(candidate.id));
      if (!offer || offer.own !== false) throw new Error('Quicktrade listing changed or sold');
      const listed = bigintSafe(offer.points);
      const price = bigintSafe(offer.pricePerPoint);
      const total = bigintSafe(offer.totalMoney);
      const units = bigintSafe(candidate.units);
      if (listed < units || price !== bigintSafe(candidate.price) || total !== listed * price) {
        throw new Error('Quicktrade listing changed or sold');
      }
      return;
    }
    const row = await gameJson(`/api/perks/${encodeURIComponent(String(candidate.id))}`);
    if (row?.forSale !== true || String(row?.label || '') !== String(candidate.label || '') ||
        String(row?.saleCurrency || '') !== String(candidate.currency || '') ||
        bigintSafe(row?.salePrice) !== bigintSafe(candidate.price)) {
      throw new Error('Quicktrade listing changed or sold');
    }
  }

  async function fundQuicktradeCash(cost, candidate) {
    const bank = await gameJson('/api/bank');
    const balance = (value) => {
      const text = String(value ?? '');
      if (!/^(0|[1-9]\d{0,18})$/.test(text)) throw new Error('Could not read Quicktrade cash/Swiss balances');
      return BigInt(text);
    };
    const cash = balance(bank?.money);
    const swiss = balance(bank?.swissMoney);
    const shortfall = cost > cash ? cost - cash : 0n;
    if (shortfall <= 0n) return;
    if (swiss < shortfall) throw new Error('Not enough cash plus Swiss for this Quicktrade offer');

    const withdrawalToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.qt.pending = { token:withdrawalToken, kind:'swiss', amount:shortfall.toString() };
    saveQt();
    renderQuicktrade();
    try {
      const result = await gameJson('/api/bank/swiss', {
        method:'POST',
        timeoutMs:30_000,
        body:{ action:'withdraw', amount:shortfall.toString() },
        validate: () => {
          if (!quicktradeFundingStillAllowed(candidate, withdrawalToken)) throw new ActionCancelledError('Quicktrade settings changed');
        },
      });
      const message = cleanGameMessage(result?.html);
      if (!/^You withdrew\b/i.test(message)) throw new Error('Swiss response did not confirm a withdrawal');
      if (state.qt.pending?.token !== withdrawalToken) throw new Error('Swiss withdrawal state changed');
      state.qt.pending = null;
      saveQt();
      renderQuicktrade();
      log(`Quicktrade: withdrew $${shortfall.toLocaleString('en-GB')} from Swiss`, 'ok');
    } catch (error) {
      if (state.qt.pending?.token === withdrawalToken && (error instanceof ActionCancelledError || quicktradeDefinitelyRejected(error))) {
        // ActionCancelled is raised only by the pre-dispatch validation path,
        // so the withdrawal definitely did not leave this browser.
        state.qt.pending = null;
        saveQt();
        renderQuicktrade();
      } else if (state.qt.pending?.token === withdrawalToken) {
        state.qtStatus = 'Swiss withdrawal unconfirmed. Check your bank before resuming Quicktrade.';
        log(state.qtStatus, 'warn');
        renderQuicktrade();
      }
      throw error;
    }
  }

  async function executeQuicktradeCandidate(candidate) {
    if (!quicktradeCandidateStillAllowed(candidate)) throw new ActionCancelledError('Quicktrade settings changed');
    await verifyQuicktradeCandidate(candidate);
    if (!quicktradeCandidateStillAllowed(candidate)) throw new ActionCancelledError('Quicktrade settings changed');
    if (candidate.kind === 'points') {
      const pointCost = bigintSafe(candidate.units) * bigintSafe(candidate.price);
      if (pointCost <= 0n) throw new Error('Quicktrade point cost could not be verified');
      await fundQuicktradeCash(pointCost, candidate);
      if (!quicktradeCandidateStillAllowed(candidate)) throw new ActionCancelledError('Quicktrade settings changed');
      await verifyQuicktradeCandidate(candidate);
    } else if (candidate.currency === 'money') {
      await fundQuicktradeCash(bigintSafe(candidate.price), candidate);
      if (!quicktradeCandidateStillAllowed(candidate)) throw new ActionCancelledError('Quicktrade settings changed');
      await verifyQuicktradeCandidate(candidate);
    }

    if (!quicktradeCandidateStillAllowed(candidate)) throw new ActionCancelledError('Quicktrade settings changed');
    const pendingToken = quicktradeReserve(candidate);
    try {
      const result = candidate.kind === 'points'
        ? await gameJson('/api/qt/accept', {
            method:'POST', timeoutMs:30_000,
            body:{ buy:'points', id:String(candidate.id), points:String(candidate.units) },
            validate: () => {
              if (!quicktradeReservedCandidateStillAllowed(candidate, pendingToken)) throw new ActionCancelledError('Quicktrade settings changed');
            },
          })
        : await gameJson('/api/qt/perks/buy', {
            method:'POST', timeoutMs:30_000,
            body:{ ids:[String(candidate.id)] },
            validate: () => {
              if (!quicktradeReservedCandidateStillAllowed(candidate, pendingToken)) throw new ActionCancelledError('Quicktrade settings changed');
            },
          });
      const message = cleanGameMessage(result?.html);
      if (!/^You bought\b/i.test(message)) throw new Error('Purchase response did not confirm a purchase');
      if (state.qt.pending?.token === pendingToken) quicktradeClearPending();
      state.qtStatus = message;
      log(message, 'ok');
      return true;
    } catch (error) {
      if (state.qt.pending?.token === pendingToken) {
        if (error instanceof ActionCancelledError || quicktradeDefinitelyRejected(error)) quicktradeRestorePending();
        else {
          state.qtStatus = 'Purchase unconfirmed. Check game transactions before resuming Quicktrade.';
          log(state.qtStatus, 'warn');
        }
      }
      throw error;
    }
  }

  async function runQuicktrade() {
    if (!automationAllowed() || !quicktradeReady() || state.qtRunning) return;
    state.qtRunning = true;
    markFeatureEpoch('quicktrade');
    let candidate = null;
    try {
      const pointData = state.qt.pointsEnabled ? await gameJson('/api/qt?a=points') : null;
      const perkData = state.qt.perksEnabled ? await gameJson('/api/qt?a=perks&v=con') : null;

      if (perkData) {
        const names = new Set(state.qtCatalog);
        for (const offer of Array.isArray(perkData?.perkOffers) ? perkData.perkOffers : []) {
          const label = String(offer?.label || '').trim();
          if (label) names.add(label);
        }
        state.qtCatalog = [...names].sort((a,b) => a.localeCompare(b)).slice(0,1000);
      }

      const now = Date.now();
      for (const [key, until] of state.qtOfferRetryAt.entries()) if (until <= now) state.qtOfferRetryAt.delete(key);
      const pointOffers = (Array.isArray(pointData?.pointsOffers) ? pointData.pointsOffers : [])
        .filter((offer) => !state.qtOfferRetryAt.has(`points:${offer?.id}`))
        .map((offer) => ({
          id:String(offer?.id || ''),
          own:offer?.own === true ? true : offer?.own === false ? false : null,
          points:String(offer?.points ?? '0'),
          pricePerPoint:String(offer?.pricePerPoint ?? '0'),
          totalMoney:String(offer?.totalMoney ?? '0'),
          offerCount:Number(offer?.offerCount),
        }));
      const perkOffers = (Array.isArray(perkData?.perkOffers) ? perkData.perkOffers : [])
        .filter((offer) => !state.qtOfferRetryAt.has(`perks:${offer?.id}`))
        .map((offer) => ({
          id:String(offer?.id || ''),
          own:offer?.own === true ? true : offer?.own === false ? false : null,
          label:String(offer?.label || ''),
          saleCurrency:String(offer?.saleCurrency || ''),
          salePrice:String(offer?.salePrice ?? '0'),
          permanent:offer?.permanent === true,
          expires:Number(offer?.expires),
        }));

      const plan = await plannerRequest('/api/v1/quicktrade/plan', {
        method:'POST', token,
        body: {
          inJail:state.inJail === true,
          pending:Boolean(state.qt.pending),
          points:{
            enabled:state.qt.pointsEnabled === true,
            maxPrice:String(state.qt.pointsMaxPrice || '0'),
            remaining:String(state.qt.pointsRemaining || '0'),
          },
          perksEnabled:state.qt.perksEnabled === true,
          perkRules:state.qt.rules,
          pointOffers,
          perkOffers,
          lastKind:state.qtLastKind,
        },
      });

      if (plan.action !== 'buy' || !plan.candidate) {
        state.qtStatus = plan.status || 'Watching Quicktrade — no matching offers within your limits';
        state.qtDueAt = Date.now() + safeWaitMs(plan.waitMs, 1_000);
        return;
      }

      candidate = plan.candidate;
      state.qtLastKind = candidate.kind;
      await executeQuicktradeCandidate(candidate);
      state.qtDueAt = Date.now() + 100;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        if (!state.qt.pending) state.qtStatus = 'Quicktrade settings changed · rechecking';
        state.qtDueAt = Date.now() + 250;
      } else {
        const message = friendlyGameError(error);
        if (!state.qt.pending) state.qtStatus = message || 'Quicktrade check failed';
        state.qtDueAt = Date.now() + errorWait(error, 1_000);
        if (candidate && !state.qt.pending && [400,403,404].includes(Number(error?.status)) && !error?.body?.dead && !error?.body?.inJail) {
          state.qtOfferRetryAt.set(`${candidate.kind}:${candidate.id}`, Date.now() + 15_000);
          state.qtDueAt = Date.now() + 100;
        }
        log(`Quicktrade: ${message}`, error?.status === 429 ? 'warn' : 'error');
      }
    } finally {
      state.qtRunning = false;
      render();
    }
  }

  function sanitiseRestartProgress(value) {
    const v = value && typeof value === 'object' ? value : {};
    const cleanName = (raw) => {
      const name = String(raw || '').trim();
      return name.length >= 2 && name.length <= 20 && /^[a-zA-Z0-9 _-]+$/.test(name) ? name : '';
    };
    return {
      active:v.active === true,
      blocked:v.blocked === true,
      userId:typeof v.userId === 'string' ? v.userId.slice(0,100) : '',
      username:cleanName(v.username),
      oldUsername:cleanName(v.oldUsername),
      pending:['create','retrieve'].includes(v.pending) ? v.pending : '',
      created:v.created === true,
      retrievalDone:v.retrievalDone === true,
      loginAttempted:v.loginAttempted === true,
      allowRetry:v.allowRetry === true,
      dueAt:Number.isFinite(Number(v.dueAt)) && Number(v.dueAt) > 0 ? Number(v.dueAt) : 0,
      message:String(v.message || '').slice(0,600),
    };
  }

  function loadRestartProgress() {
    return sanitiseRestartProgress(GM_getValue(KEYS.restartProgress, {}));
  }

  function saveRestartProgress(patch) {
    state.restartProgress = sanitiseRestartProgress({ ...state.restartProgress, ...patch });
    GM_setValue(KEYS.restartProgress, state.restartProgress);
    renderRestart();
  }

  function cancelRestart() {
    if (!state.restartProgress.active) return;
    // Preserve a dispatched mutation marker so a later resume reconciles it
    // from live account state instead of blindly repeating the request.
    saveRestartProgress({ active:false, blocked:false, allowRetry:false, message:'Automatic restart stopped' });
  }

  function stopForDeath() {
    if (state.stoppedForDeath) return;
    state.stoppedForDeath = true;
    GM_setValue(KEYS.deathStop, true);
    state.killData = null;
    state.killDataLoadedAt = 0;
    state.searchData = null;
    state.searchDataLoadedAt = 0;
    state.killDataRevision += 1;
    state.activeBodyguard = null;
    state.inJail = false;
    state.jailMarkedAt = 0;
    state.prestigeComplete = false;
    resetProtectionState(true);
    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
    state.autoRankControls = { crimes:false, gta:false, melt:false, drugs:false };
    state.settings.enabled = false;
    saveSettings();
    stopAutomation();
    state.currentAction = 'Character dead — stopped';
    log('Character death detected — gameplay automation stopped', 'warn');
    if (state.restart.enabled && token && state.botTab) armRestart();
    render();
  }

  function armRestart() {
    if (!state.restart.enabled || !token || !state.botTab) return false;
    state.settings.enabled = false;
    saveSettings();
    saveRestartProgress({
      active:true,
      blocked:false,
      dueAt:0,
      allowRetry:false,
      message:'Checking account before restart',
    });
    syncPlannerSocket();
    return true;
  }

  function restartAllowed() {
    return Boolean(
      token &&
      state.botTab &&
      state.controller &&
      state.restart.enabled &&
      state.restartProgress.active &&
      !state.restartProgress.blocked &&
      plannerSocketReady
    );
  }

  function pauseRestart(message) {
    saveRestartProgress({ blocked:true, message });
    log(`Restart: ${message}`, 'warn');
  }

  function retryRestart() {
    if (!token || !state.restart.enabled || state.restartRunning) return;
    if (!state.restartProgress.active && !state.stoppedForDeath && !state.restartProgress.pending) return;
    state.stoppedForDeath = true;
    GM_setValue(KEYS.deathStop, true);
    state.settings.enabled = false;
    saveSettings();
    saveRestartProgress({
      active:true,
      blocked:false,
      allowRetry:true,
      loginAttempted:false,
      dueAt:0,
      message:'Rechecking account before retry',
    });
    syncPlannerSocket();
    restartTick();
  }

  async function runRestart() {
    if (!restartAllowed() || state.restartRunning) return;
    state.restartRunning = true;
    let stage = 'check';

    const removeName = (name) => {
      const key = normalizePlayerName(name);
      state.restart.usernames = state.restart.usernames.filter((value) => normalizePlayerName(value) !== key);
      saveRestart();
    };

    try {
      let identity;
      try {
        identity = await gameJson('/api/auth/me', { skipAuthHandling:true });
      } catch (error) {
        if (error?.status !== 401) throw error;
        stage = 'login';
        if (state.restartProgress.loginAttempted && !state.restartProgress.allowRetry) {
          pauseRestart('Login was not confirmed. Log in manually or check the Login tab and retry.');
          return;
        }
        if (!state.login.autoLogin || !state.login.email || !state.login.password) {
          pauseRestart('Login required. Save your existing email/password and enable Auto-login in the Login tab, or log in manually, then retry.');
          return;
        }
        saveRestartProgress({ loginAttempted:true, allowRetry:false, message:'Logging in to the existing account' });
        try {
          identity = await gameJson('/api/auth/login', {
            method:'POST',
            timeoutMs:20_000,
            skipAuthHandling:true,
            body:{ email:state.login.email, password:state.login.password },
          });
        } catch (error) {
          if (error?.status && [400,401,403,404,409,429].includes(Number(error.status))) {
            saveRestartProgress({ loginAttempted:false });
          }
          throw error;
        }
        saveRestartProgress({ loginAttempted:false });
      }

      stage = 'check';
      if (!identity?.user?.id || typeof identity?.dead !== 'boolean' || typeof identity?.emailVerified !== 'boolean') {
        throw new Error('Could not verify the logged-in account');
      }
      if (state.restartProgress.userId && state.restartProgress.userId !== String(identity.user.id)) {
        pauseRestart('The logged-in account has changed. Stop automatic restart and check the account.');
        return;
      }
      saveRestartProgress({ userId:String(identity.user.id) });
      if (identity.emailVerified !== true) {
        pauseRestart('Email verification is required. Complete it normally, then retry.');
        return;
      }

      let status = await gameJson('/api/death/status', { skipAuthHandling:true });
      if (typeof status?.dead !== 'boolean' || !String(status?.username || '').trim()) {
        throw new Error('Could not verify the current character');
      }

      if (status.dead === true) {
        if (state.restartProgress.created ||
            (state.restartProgress.oldUsername && normalizePlayerName(state.restartProgress.oldUsername) !== normalizePlayerName(status.username))) {
          pauseRestart('The character changed or died again during restart. Check the game before continuing.');
          return;
        }
        if (state.restartProgress.pending === 'create' && !state.restartProgress.allowRetry) {
          pauseRestart('Character creation was not confirmed. Check the game, then use Retry after checking.');
          return;
        }

        const username = state.restartProgress.username || state.restart.usernames[0];
        if (!username) {
          pauseRestart('No usernames remaining. Add names or generate 100, then save the list.');
          return;
        }

        stage = 'create';
        saveRestartProgress({
          oldUsername:String(status.username),
          username,
          pending:'create',
          allowRetry:false,
          message:`Creating ${username}`,
        });
        try {
          const result = await gameJson('/api/death/restart', {
            method:'POST',
            timeoutMs:60_000,
            skipAuthHandling:true,
            body:{ username },
          });
          if (result?.ok !== true || String(result?.username || '') !== username) {
            throw new Error('Character creation response was not confirmed');
          }
          saveRestartProgress({ pending:'', created:true });
          removeName(username);
        } catch (error) {
          if (error?.status === 400 && /username is already taken/i.test(friendlyGameError(error))) {
            removeName(username);
            saveRestartProgress({ username:'', pending:'', dueAt:Date.now()+500, message:`${username} is taken — trying the next name` });
            return;
          }
          if (error?.status && [400,401,403,404,409,429].includes(Number(error.status))) {
            saveRestartProgress({ pending:'' });
          }
          throw error;
        }
        status = await gameJson('/api/death/status', { skipAuthHandling:true });
      } else {
        const liveUsername = String(status.username || '').trim();
        if (state.restartProgress.username && normalizePlayerName(state.restartProgress.username) !== normalizePlayerName(liveUsername)) {
          pauseRestart('The active username does not match the pending restart. Check the game before continuing.');
          return;
        }
        // Reconcile a lost successful create response from live state. Never
        // resend the mutation simply because its response was lost.
        if (state.restartProgress.pending === 'create') removeName(liveUsername);
        saveRestartProgress({
          username:liveUsername,
          created:true,
          pending:state.restartProgress.pending === 'create' ? '' : state.restartProgress.pending,
        });
      }

      if (status?.dead !== false || normalizePlayerName(status.username) !== normalizePlayerName(state.restartProgress.username)) {
        pauseRestart('The new character could not be confirmed alive. Check the game before continuing.');
        return;
      }

      stage = 'retrieve';
      if ((!state.restartProgress.retrievalDone && state.restart.retrieveAssets) || state.restartProgress.pending === 'retrieve') {
        saveRestartProgress({ message:'Checking assets available to retrieve' });
        const data = await gameJson('/api/retrieve', { skipAuthHandling:true });
        const totals = data?.retrievalTotals;
        if (!totals || typeof totals.swissMoney !== 'string' || !/^\d{1,36}$/.test(totals.swissMoney) ||
            typeof totals.points !== 'string' || !/^\d{1,36}$/.test(totals.points) ||
            !Number.isSafeInteger(totals.retrievableCarCount) || totals.retrievableCarCount < 0) {
          throw new Error('Could not read the retrieval totals');
        }
        const available = BigInt(totals.swissMoney) > 0n || BigInt(totals.points) > 0n || totals.retrievableCarCount > 0;

        if (available && state.restartProgress.pending === 'retrieve' && !state.restartProgress.allowRetry) {
          pauseRestart('Asset retrieval was not confirmed. Check Retrieve Accounts before retrying.');
          return;
        }
        if (available && state.restart.retrieveAssets) {
          saveRestartProgress({
            pending:'retrieve',
            allowRetry:false,
            message:'Retrieving Swiss, points and eligible cars (normal tax/fees apply)',
          });
          try {
            const result = await gameJson('/api/retrieve/all', {
              method:'POST', timeoutMs:60_000, skipAuthHandling:true, body:{},
            });
            const message = cleanGameMessage(result?.html);
            if (!/^Retrieved\b/i.test(message)) throw new Error('Asset retrieval response was not confirmed');
            log(message, 'ok');
            saveRestartProgress({ pending:'', retrievalDone:true });
          } catch (error) {
            if (error?.status && [400,401,403,404,409,429].includes(Number(error.status))) {
              saveRestartProgress({ pending:'' });
            }
            throw error;
          }
        } else {
          // No remaining assets also reconciles a previously-dispatched
          // retrieve request whose success response was lost.
          saveRestartProgress({ pending:'', retrievalDone:true });
        }
      }

      stage = 'finish';
      const finalStatus = await gameJson('/api/death/status', { skipAuthHandling:true });
      if (finalStatus?.dead !== false || normalizePlayerName(finalStatus.username) !== normalizePlayerName(state.restartProgress.username)) {
        pauseRestart('Character changed before resuming. Check the game.');
        return;
      }

      const username = String(finalStatus.username || state.restartProgress.username || '');
      state.stoppedForDeath = false;
      GM_setValue(KEYS.deathStop, false);
      state.authRequired = false;
      state.loginAutoAttempted = false;
      state.inJail = false;
      state.jailMarkedAt = 0;
      state.prestigeComplete = false;
      resetProtectionState(true);
      state.activeBodyguard = null;
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.searchData = null;
      state.searchDataLoadedAt = 0;
      state.killDataRevision += 1;
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
      state.autoRankControls = { crimes:false, gta:false, melt:false, drugs:false };
      state.settings.enabled = true;
      saveSettings();
      state.restartProgress = sanitiseRestartProgress(null);
      saveRestartProgress({ message:`Restart complete — ${username}` });
      resetAllDue();
      state.currentAction = 'Restart complete — resuming saved modules';
      log(`Restart complete: ${username} — resuming saved bot modules`, 'ok');
      if (/^\/death(?:\/|$)/.test(location.pathname)) location.replace('/home');
      wakeAutomation();
    } catch (error) {
      const message = friendlyGameError(error);
      if (error?.status === 429) {
        if (stage === 'login') saveRestartProgress({ loginAttempted:false });
        saveRestartProgress({ dueAt:Date.now()+Math.max(1_000,errorWait(error,1_000)), message:'Server rate limit — waiting before retry' });
      } else if (state.restartProgress.pending || (stage === 'login' && state.restartProgress.loginAttempted)) {
        // The next pass reconciles from read-only account/death/retrieve state.
        saveRestartProgress({ dueAt:Date.now()+2_000, message:'Response lost — checking account state before continuing' });
      } else if (error?.status === 401 && stage !== 'login') {
        saveRestartProgress({ dueAt:Date.now()+1_000, message:'Session changed — checking login again' });
      } else if (error?.status && [400,401,403,404,409].includes(Number(error.status))) {
        pauseRestart(`${message}. Check the game and retry${stage === 'retrieve' ? ', or turn asset retrieval off to resume without it' : ''}.`);
      } else {
        saveRestartProgress({ dueAt:Date.now()+5_000, message:`Restart check failed: ${message}` });
      }
    } finally {
      state.restartRunning = false;
      render();
    }
  }

  function restartTick() {
    if (!token || !state.botTab || !state.controller) return;
    if (state.restartProgress.active || state.authRequired) syncPlannerSocket();
    if (state.authRequired) void probeLoginSession();
    if (state.restart.enabled && state.stoppedForDeath && !state.restartProgress.active) armRestart();
    if (restartAllowed() && !state.restartRunning && Number(state.restartProgress.dueAt || 0) <= Date.now()) {
      void runRestart();
    }
  }

  function startRestartWatcher() {
    if (restartTimer) return;
    restartTimer = setInterval(restartTick, 500);
  }

  async function manualDeathRecheck() {
    if (!token) return;
    try {
      const status = await gameJson('/api/death/status', { skipAuthHandling:true });
      if (status?.dead === true) {
        if (state.restart.enabled) {
          armRestart();
          restartTick();
        } else {
          state.currentAction = 'Character is still dead';
          render();
        }
        return;
      }
      state.stoppedForDeath = false;
      GM_setValue(KEYS.deathStop, false);
      state.inJail = false;
      state.jailMarkedAt = 0;
      state.prestigeComplete = false;
      resetProtectionState(true);
      state.settings.enabled = true;
      saveSettings();
      resetAllDue();
      state.currentAction = 'Alive — automation resumed';
      log('Character alive — automation resumed', 'ok');
      wakeAutomation();
      render();
    } catch (error) {
      log(`Death check: ${friendlyGameError(error)}`, 'error');
    }
  }

  async function attemptAutoLogin(force = false) {
    if (loginRunning) return false;
    if ((!force && state.login.autoLogin !== true) || !state.login.email || !state.login.password) {
      state.loginStatus = state.authRequired ? 'Login required — save credentials or log in manually' : state.loginStatus;
      renderLogin();
      return false;
    }
    loginRunning = true;
    state.loginAutoAttempted = true;
    state.loginStatus = 'Attempting automatic login…';
    renderLogin();
    try {
      const result = await gameJson('/api/auth/login', {
        method:'POST',
        timeoutMs:20_000,
        skipAuthHandling:true,
        body:{ email:state.login.email, password:state.login.password },
      });
      if (!result?.user?.id && result?.ok !== true) throw new Error('Login response could not be verified');
      state.authRequired = false;
      state.loginAutoAttempted = false;
      state.loginProbeDueAt = 0;
      resetProtectionState(true);
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.searchData = null;
      state.searchDataLoadedAt = 0;
      state.killDataRevision += 1;
      state.loginStatus = 'Automatic login succeeded';
      log('Automatic login succeeded', 'ok');
      resetAllDue();
      wakeAutomation();
      return true;
    } catch (error) {
      state.authRequired = true;
      if (error instanceof ActionCancelledError) state.loginAutoAttempted = false;
      state.loginStatus = `Auto-login failed: ${friendlyGameError(error)}`;
      state.currentAction = 'Login required — check Login tab or log in manually';
      if (force) log(state.loginStatus, 'warn');
      return false;
    } finally {
      loginRunning = false;
      render();
    }
  }

  function handleAuthRequired() {
    if (!state.authRequired) {
      state.authRequired = true;
      state.loginAutoAttempted = false;
      state.loginProbeDueAt = 0;
      // A restored login is a new authenticated gameplay generation. Cancel
      // anything that was planned using the expired session so it cannot wake
      // up after recovery and mutate the new character/session.
      stopAutomationTimer();
      stopJailStream();
      state.automationEpoch += 1;
    }
    state.currentAction = 'Login required — attempting recovery';
    state.loginStatus = state.login.autoLogin && state.login.email && state.login.password
      ? 'Login required — automatic recovery active'
      : 'Login required — save credentials or log in manually';
    render();
    if (!state.loginAutoAttempted && state.login.autoLogin && state.login.email && state.login.password) {
      void attemptAutoLogin();
    }
  }

  async function probeLoginSession() {
    if (!state.authRequired || loginRunning || Date.now() < state.loginProbeDueAt) return;
    state.loginProbeDueAt = Date.now() + 2_000;
    try {
      const me = await gameJson('/api/auth/me', { skipAuthHandling:true });
      if (me?.user?.id) {
        state.authRequired = false;
        state.loginAutoAttempted = false;
        resetProtectionState(true);
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.searchData = null;
        state.searchDataLoadedAt = 0;
        state.killDataRevision += 1;
        state.loginStatus = 'Game session restored';
        log('Game session restored — automation resuming', 'ok');
        resetAllDue();
        wakeAutomation();
        render();
      }
    } catch (error) {
      if (error?.status !== 401) state.loginProbeDueAt = Date.now() + 10_000;
    }
  }

  function errorWait(error, fallback = 5_000) {
    if (error?.status === 429) {
      return Number(error?.retryAfter) > 0 ? Number(error.retryAfter) * 1000 + 50 : 500;
    }
    if (error?.status === 401) return 10_000;
    return fallback;
  }

  function requestRateKey(path, method = 'GET') {
    const route = String(path).split('?')[0].replace(/\/+$/, '') || '/';
    const verb = String(method || 'GET').toUpperCase();
    if (verb === 'GET' && route === '/api/jail') return 'jailRead';
    if (verb !== 'POST') return `GET ${route}`;
    if (route === '/api/kill/shoot') return 'shoot';
    if (route === '/api/kill/prepare') return 'prepare';
    if (route === '/api/kill/search') return 'search';
    if (/^\/api\/crimes\//.test(route)) return 'crime';
    if (route === '/api/gta/steal') return 'gta';
    if (route === '/api/qt/accept' || route === '/api/qt/perks/buy') return 'quicktrade';
    if (route === '/api/retrieve/all') return 'retrieve';
    if (isJailBustPath(route)) return 'jailBust';
    return `POST ${route}`;
  }

  function isJailBustPath(path) {
    return /^\/api\/jail\/bust(?:-bot)?\/[^/]+$/.test(String(path).split('?')[0]);
  }

  function requestBucket(key) {
    if (!key) return null;
    if (!requestLimiter.buckets.has(key)) {
      requestLimiter.buckets.set(key, { history: [], blockedUntil: 0 });
    }
    return requestLimiter.buckets.get(key);
  }

  function requestRateWait(key, now = Date.now()) {
    const bucket = requestBucket(key);
    if (!bucket) return 0;
    const config = ACTION_RATE_LIMITS[key];
    if (config) bucket.history = bucket.history.filter((at) => at + config.windowMs + 50 > now);
    const windowWait = config && bucket.history.length >= config.limit
      ? bucket.history[bucket.history.length - config.limit] + config.windowMs + 50 - now
      : 0;
    const interval = config?.minIntervalMs || 0;
    const spacingWait = interval && bucket.history.length
      ? bucket.history[bucket.history.length - 1] + interval - now
      : 0;
    return Math.max(0, bucket.blockedUntil - now, windowWait, spacingWait);
  }

  function refillRequestTokens(now = Date.now()) {
    const elapsed = Math.max(0, now - requestLimiter.lastRefillAt);
    if (elapsed <= 0) return;
    requestLimiter.tokens = Math.min(
      REQUEST_BURST_CAPACITY,
      requestLimiter.tokens + elapsed * REQUEST_REFILL_PER_SECOND / 1000,
    );
    requestLimiter.lastRefillAt = now;
  }

  function pumpRequestQueue() {
    if (requestLimiter.timer !== null) clearTimeout(requestLimiter.timer);
    requestLimiter.timer = null;
    const now = Date.now();
    if (state.globalRateLimitedUntil > now) {
      requestLimiter.timer = setTimeout(pumpRequestQueue, Math.max(1, state.globalRateLimitedUntil - now));
      return;
    }
    refillRequestTokens(now);

    requestLimiter.queue = requestLimiter.queue.filter((entry) => {
      try {
        if (entry.validate) entry.validate();
        return true;
      } catch (error) {
        entry.reject(error);
        return false;
      }
    });

    while (requestLimiter.queue.length > 0) {
      let selectedIndex = -1;
      for (let index = 0; index < requestLimiter.queue.length; index += 1) {
        const candidate = requestLimiter.queue[index];
        if (candidate.usesGlobalToken && requestLimiter.tokens < 1) continue;
        if (requestRateWait(candidate.rateKey, now) > 0) continue;
        const selected = selectedIndex >= 0 ? requestLimiter.queue[selectedIndex] : null;
        const score = (entry) => Math.max(0, entry.priority - Math.floor((now - entry.queuedAt) / 250));
        if (!selected || score(candidate) < score(selected) ||
            (score(candidate) === score(selected) && candidate.sequence < selected.sequence)) {
          selectedIndex = index;
        }
      }
      if (selectedIndex < 0) break;
      const [next] = requestLimiter.queue.splice(selectedIndex, 1);
      if (next.usesGlobalToken) requestLimiter.tokens -= 1;
      const bucket = requestBucket(next.rateKey);
      if (bucket && ACTION_RATE_LIMITS[next.rateKey]) bucket.history.push(now);
      next.resolve();
    }

    if (requestLimiter.queue.length > 0 && requestLimiter.timer === null) {
      const missing = Math.max(0, 1 - requestLimiter.tokens);
      const tokenWait = Math.ceil(missing * 1000 / REQUEST_REFILL_PER_SECOND);
      const readyWait = Math.min(...requestLimiter.queue.map((entry) => Math.max(
        entry.usesGlobalToken ? tokenWait : 0,
        requestRateWait(entry.rateKey, now),
      )));
      requestLimiter.timer = setTimeout(pumpRequestQueue, Math.max(1, readyWait));
    }
  }

  function reserveRequestSlot(priority, rateKey, validate) {
    return new Promise((resolve, reject) => {
      requestLimiter.queue.push({
        priority: Number.isFinite(priority) ? priority : REQUEST_PRIORITY.NORMAL,
        sequence: requestLimiter.sequence++,
        queuedAt: Date.now(),
        rateKey,
        usesGlobalToken: rateKey !== 'jailBust',
        validate,
        resolve,
        reject,
      });
      pumpRequestQueue();
    });
  }

  function gameplayMutationAllowed(path) {
    const route = String(path).split('?')[0].replace(/\/+$/, '') || '/';
    if (!token || !plannerSocketReady) return false;
    if (route === '/api/auth/login') return loginRunning || state.restartProgress.active;
    if (route.startsWith('/api/death/')) return restartAllowed();
    if (route === '/api/retrieve/all') return restartAllowed();

    if (!automationAllowed()) return false;
    if (route.startsWith('/api/auto-rank/')) {
      return featureEpochCurrent('autoRank') && state.settings.autoRank && !state.prestigeCommitting;
    }
    if (state.inJail) return false;
    if (/^\/api\/crimes\//.test(route)) return featureEpochCurrent('crimes') && state.settings.crimes && !state.prestigeCommitting;
    if (route === '/api/gta/steal') return featureEpochCurrent('gta') && state.settings.gta && !state.prestigeCommitting;
    if (isJailBustPath(route)) return featureEpochCurrent('jail') && state.settings.jailBust;
    if (route === '/api/melt/cars/melt') return featureEpochCurrent('melt') && state.settings.melt;
    if (/^\/api\/melt\/cars\/[^/]+\/repair$/.test(route)) {
      return featureEpochCurrent('melt') && state.settings.melt && state.settings.repairBeforeMelt;
    }
    if (/^\/api\/gta\/cars\/[^/]+\/repair$/.test(route)) {
      return (featureEpochCurrent('drugs') && state.settings.drugs && !activeBeamName()) ||
        (featureEpochCurrent('combat') && hasCombatSelections());
    }
    if (route === '/api/drugs/buy' || route === '/api/drugs/sell') {
      return featureEpochCurrent('drugs') && state.settings.drugs && !activeBeamName();
    }
    if (route === '/api/drugs/drive') {
      return (featureEpochCurrent('drugs') && state.settings.drugs && !activeBeamName()) ||
        (featureEpochCurrent('combat') && Boolean(activeBeamName()));
    }
    if (route === '/api/airport/fly') return featureEpochCurrent('combat') && Boolean(activeBeamName());
    if (route === '/api/prestige/start') return featureEpochCurrent('prestige') && state.settings.autoPrestige && state.prestigeCommitting;
    if (route === '/api/weaponry/buy/gun') return featureEpochCurrent('autoGun') && state.settings.autoBuyGun;
    if (route === '/api/kill/search') {
      if (!protectionMutationSafe()) return false;
      return (featureEpochCurrent('search') && state.settings.searchPlayers) ||
        (featureEpochCurrent('search') && hasCombatSelections()) ||
        (featureEpochCurrent('combat') && hasCombatSelections());
    }
    if (route === '/api/kill/prepare' || route === '/api/kill/shoot') {
      return protectionMutationSafe() && featureEpochCurrent('combat') && hasCombatSelections();
    }
    if (route === '/api/bank/swiss' || route === '/api/qt/accept' || route === '/api/qt/perks/buy') {
      return featureEpochCurrent('quicktrade') && (state.qt.pointsEnabled || state.qt.perksEnabled);
    }
    return true;
  }

  function gameMutationLane(path) {
    const route = String(path).split('?')[0].replace(/\/+$/, '') || '/';
    if (/^\/api\/crimes\//.test(route)) return 'crime';
    if (route === '/api/gta/steal') return 'gta';
    if (isJailBustPath(route)) return 'jail';
    if (route === '/api/kill/search') return 'search';
    if (route.startsWith('/api/auto-rank/')) return 'auto-rank';
    if (route === '/api/auth/login' || route.startsWith('/api/death/') || route === '/api/retrieve/all') return 'account';
    return 'economy';
  }

  async function gameJson(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'POST') return gameJsonDirect(path, { ...options, method });
    const lane = gameMutationLane(path);
    const execute = () => gameJsonDirect(path, { ...options, method });
    const tail = state.actionTails.get(lane) || Promise.resolve();
    const queued = tail.then(execute, execute);
    state.actionTails.set(lane, queued.catch(() => undefined));
    return queued;
  }

  async function gameJsonDirect(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const rateKey = requestRateKey(path, method);
    const priority = options.priority ?? (method === 'POST' ? REQUEST_PRIORITY.ACTION : REQUEST_PRIORITY.NORMAL);
    const callerValidate = typeof options.validate === 'function' ? options.validate : null;
    const validate = method === 'POST'
      ? () => {
          if (!gameplayMutationAllowed(path)) throw new ActionCancelledError('Action cancelled because automation state changed');
          if (callerValidate) callerValidate();
        }
      : null;

    await reserveRequestSlot(priority, rateKey, validate);
    if (validate) validate();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
    let response;
    let body = {};
    try {
      response = await fetch(new URL(path, location.origin), {
        method,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type':'application/json' } : {}) },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const type = response.headers.get('content-type') || '';
      body = type.includes('application/json') ? await response.json().catch(() => ({})) : { html: await response.text() };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const e = new Error(`Request timed out: ${path}`);
        e.status = 408;
        throw e;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const e = new Error(cleanGameMessage(body.html || body.error || body.message) || `HTTP ${response.status}`);
      e.status = response.status;
      e.body = body;
      const headerRetry = Number(response.headers.get('retry-after'));
      const bodyRetry = Number(body.retryAfterSec);
      e.retryAfter = Number.isFinite(headerRetry) && headerRetry > 0
        ? headerRetry
        : Number.isFinite(bodyRetry) && bodyRetry > 0
          ? bodyRetry
          : 0;

      if (response.status === 429 && body?.pageBlocked === true && e.retryAfter > 0) {
        state.globalRateLimitedUntil = Math.max(state.globalRateLimitedUntil, Date.now() + e.retryAfter * 1000 + 50);
        pumpRequestQueue();
      } else if (response.status === 429) {
        const bucket = requestBucket(rateKey);
        bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + (e.retryAfter > 0 ? e.retryAfter * 1000 + 50 : 250));
      }

      if (response.status === 401 && options.skipAuthHandling !== true) handleAuthRequired();
      if (body && body.dead === true) stopForDeath();
      if (body?.inJail === true || /while you are in jail|sent to jail/i.test(e.message || '')) markJailed();
      throw e;
    }
    if (body && body.dead === true) stopForDeath();
    if (body?.inJail === true || body?.playerStatsPatch?.inJail === true) markJailed();
    return body;
  }

  function cleanGameMessage(value) {
    const text = String(value ?? '');
    if (!text) return '';
    const holder = document.createElement('div');
    holder.innerHTML = text;
    return String(holder.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function friendlyGameError(error) {
    return cleanGameMessage(error?.message) || friendly(error);
  }

  function safeWaitMs(value, fallback) {
    const ms = Number(value);
    return Number.isFinite(ms) && ms >= 0 ? Math.min(86_400_000, Math.floor(ms)) : fallback;
  }

  function formatWait(ms) {
    const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.ceil(minutes / 60)}h`;
  }

  function renderStatusOnly(){const host=document.querySelector('#ul-simple-bot');if(!host)return;const lic=host.querySelector('#ul-cloud-licence-status');lic.textContent=state.licenceStatus;lic.classList.toggle('err',state.licenceError);}
  function openTab(tab){state.uiTab=validTab(tab);GM_setValue(KEYS.uiTab,state.uiTab);render();}

  function renderPlayerActions() {
    const box = document.querySelector('#ul-simple-player-actions');
    if (!box) return;
    box.replaceChildren();
    if (!state.players.length) {
      const empty = document.createElement('div');
      empty.className = 'ul-simple-player-action-row';
      empty.textContent = 'No players saved';
      box.appendChild(empty);
      return;
    }

    for (const name of state.players) {
      const key = normalizePlayerName(name);
      const action = state.playerActions[key] || { kill:false, beam:false, mode:'bgs' };
      const row = document.createElement('div');
      row.className = 'ul-simple-player-action-row';
      row.innerHTML = `<span class="ul-simple-player-action-name"></span>
        <input type="checkbox" class="k" aria-label="Kill">
        <input type="checkbox" class="b" aria-label="Beam">
        <select class="ul-simple-player-mode" aria-label="Beam mode">
          <option value="full">Full</option>
          <option value="bgs">BGs</option>
        </select>`;
      row.querySelector('.ul-simple-player-action-name').textContent = name;
      row.querySelector('.k').checked = action.kill === true;
      row.querySelector('.b').checked = action.beam === true;
      row.querySelector('.ul-simple-player-mode').value = action.mode === 'bgs' ? 'bgs' : 'full';

      row.querySelector('.k').addEventListener('change', (event) => {
        const current = state.playerActions[key] || { kill:false, beam:false, mode:'bgs' };
        state.playerActions[key] = { ...current, kill:event.target.checked };
        savePlayerActions();
      });

      row.querySelector('.b').addEventListener('change', (event) => {
        if (event.target.checked) {
          for (const [otherKey, other] of Object.entries(state.playerActions)) {
            if (other?.beam) state.playerActions[otherKey] = { ...other, beam:false };
          }
        }
        const current = state.playerActions[key] || { kill:false, beam:false, mode:'bgs' };
        state.playerActions[key] = { ...current, beam:event.target.checked };
        state.activeBodyguard = null;
        savePlayerActions();
      });

      row.querySelector('.ul-simple-player-mode').addEventListener('change', (event) => {
        const current = state.playerActions[key] || { kill:false, beam:false, mode:'bgs' };
        state.playerActions[key] = { ...current, mode:event.target.value === 'bgs' ? 'bgs' : 'full' };
        state.activeBodyguard = null;
        savePlayerActions();
      });

      box.appendChild(row);
    }
  }

  function renderQuicktrade() {
    const h = document.querySelector('#ul-simple-bot');
    if (!h) return;
    h.querySelector('#ul-simple-qt-points').checked = state.qt.pointsEnabled === true;
    h.querySelector('#ul-simple-qt-perks').checked = state.qt.perksEnabled === true;
    if (document.activeElement !== h.querySelector('#ul-simple-qt-point-price')) h.querySelector('#ul-simple-qt-point-price').value = formatInteger(state.qt.pointsMaxPrice);
    if (document.activeElement !== h.querySelector('#ul-simple-qt-point-quantity')) h.querySelector('#ul-simple-qt-point-quantity').value = formatInteger(state.qt.pointsRemaining);
    h.querySelector('#ul-simple-qt-point-summary').textContent =
      `Saved maximum ${formatInteger(state.qt.pointsMaxPrice)||'0'} cash/point · ${formatInteger(state.qt.pointsRemaining)||'0'} points remaining`;

    const rules = h.querySelector('#ul-simple-qt-rules');
    rules.replaceChildren();
    for (const rule of state.qt.rules) {
      const div = document.createElement('div');
      div.className = 'ul-simple-qt-rule';
      div.innerHTML = `<label><input type="checkbox" class="en"> <strong></strong></label><small></small><button type="button" class="edit">Edit</button><button type="button" class="remove">Remove</button>`;
      div.querySelector('strong').textContent = rule.label;
      div.querySelector('small').textContent = `Max ${formatInteger(rule.maxPrice)} ${rule.currency} · ${formatInteger(rule.remaining)} remaining`;
      div.querySelector('.en').checked = rule.enabled !== false;
      div.querySelector('.en').addEventListener('change', (event) => {
        rule.enabled = event.target.checked;
        state.qtDueAt = 0;
        saveQt();
        wakeAutomation();
      });
      div.querySelector('.edit').addEventListener('click', () => {
        h.querySelector('#ul-simple-qt-perk-name').value = rule.label;
        h.querySelector('#ul-simple-qt-currency').value = rule.currency;
        h.querySelector('#ul-simple-qt-perk-price').value = rule.maxPrice;
        h.querySelector('#ul-simple-qt-perk-quantity').value = rule.remaining;
        h.querySelector('#ul-simple-qt-perk-price').focus();
      });
      div.querySelector('.remove').addEventListener('click', () => {
        state.qt.rules = state.qt.rules.filter((row) => row.id !== rule.id);
        state.qtDueAt = 0;
        saveQt();
        renderQuicktrade();
        wakeAutomation();
      });
      rules.appendChild(div);
    }

    const catalog = [...new Set([...state.qtCatalog, ...state.qt.rules.map((rule) => rule.label)])];
    const datalist = h.querySelector('#ul-simple-qt-catalog');
    const signature = JSON.stringify(catalog);
    if (datalist && datalist.dataset.signature !== signature) {
      datalist.replaceChildren(...catalog.map((label) => {
        const option = document.createElement('option');
        option.value = label;
        return option;
      }));
      datalist.dataset.signature = signature;
    }

    const pending = state.qt.pending;
    h.querySelector('#ul-simple-qt-status').textContent = pending
      ? (pending.kind === 'swiss'
        ? (state.qtRunning ? 'Withdrawing purchase shortfall from Swiss…' : 'Swiss withdrawal unconfirmed. Check your bank before resuming; no purchase quantity was deducted.')
        : (state.qtRunning ? 'Purchase in progress…' : 'Purchase unconfirmed. Check game transactions and remaining quantities before resuming.'))
      : state.qtStatus;
    const clearPending = h.querySelector('#ul-simple-qt-clear-pending');
    if (clearPending) clearPending.hidden = !pending || state.qtRunning;
  }

  function renderRestart() {
    const h = document.querySelector('#ul-simple-bot');
    if (!h) return;
    h.querySelector('#ul-simple-restart-enabled').checked = state.restart.enabled === true;
    h.querySelector('#ul-simple-restart-retrieve').checked = state.restart.retrieveAssets === true;
    if (document.activeElement !== h.querySelector('#ul-simple-restart-names')) {
      h.querySelector('#ul-simple-restart-names').value = state.restart.usernames.join('\n');
    }
    const status = h.querySelector('#ul-simple-restart-status');
    if (status) {
      status.textContent = state.restartProgress.message ||
        (state.restart.enabled ? 'Restart ready · waiting for death' : 'Automatic restart disabled');
    }
    const retry = h.querySelector('#ul-simple-restart-retry');
    if (retry) retry.disabled = !(state.restartProgress.blocked || state.restartProgress.pending);
  }

  function renderLogin() {
    const h = document.querySelector('#ul-simple-bot');
    if (!h) return;
    h.querySelector('#ul-cloud-auth-licence').value = String(GM_getValue(KEYS.licence,'') || '');
    h.querySelector('#ul-cloud-auth-device').value = String(GM_getValue(KEYS.deviceLabel,'Browser') || 'Browser');
    if (document.activeElement !== h.querySelector('#ul-simple-login-email')) h.querySelector('#ul-simple-login-email').value = state.login.email || '';
    h.querySelector('#ul-simple-login-auto').checked = state.login.autoLogin === true;
    h.querySelector('#ul-simple-login-password').placeholder = state.login.password ? 'Saved locally — enter a new password to change it' : 'Enter password to save/change';
    h.querySelector('#ul-simple-login-status').textContent = state.loginStatus ||
      (state.login.password
        ? `${state.login.autoLogin ? 'Auto-login enabled' : 'Login saved; auto-login disabled'} · stored locally in Tampermonkey`
        : 'No login saved');
    h.querySelector('#ul-simple-login-retry').disabled = !state.authRequired || loginRunning;

    const updateStatus = h.querySelector('#ul-simple-update-status');
    const updateAction = h.querySelector('#ul-simple-update-action');
    if (updateStatus) {
      updateStatus.textContent = state.updateStatus;
      updateStatus.style.borderColor = state.updateRequired ? '#8f3f3f' : state.updateAvailable ? '#7a6930' : '#3a4c5d';
      updateStatus.style.color = state.updateRequired ? '#ffb0b0' : state.updateAvailable ? '#ffe28a' : '#b9cedd';
    }
    if (updateAction) {
      updateAction.disabled = state.updateChecking;
      updateAction.textContent = state.updateChecking
        ? 'Checking…'
        : state.updateRequired
          ? `Update required · v${state.updateMinVersion || state.updateLatestVersion}`
          : state.updateAvailable
            ? `Update to v${state.updateLatestVersion}`
            : 'Check for updates';
    }
  }

  function renderLogs(){const h=document.querySelector('#ul-simple-bot');if(!h)return;h.querySelector('#ul-simple-last').textContent=state.logs[0]?.text||'None yet';const box=h.querySelector('#ul-simple-logs');box.replaceChildren();for(const item of state.logs.slice(0,100)){const d=document.createElement('div');d.className=`ul-simple-log ${item.kind||''}`;d.textContent=`${new Date(item.at).toLocaleTimeString()} · ${item.text}`;box.appendChild(d);}}

  function log(text,kind='info'){state.logs.unshift({at:Date.now(),text:String(text),kind});state.logs=state.logs.slice(0,100);renderLogs();}
  function saveSettings(){
    // Any local automation-setting edit starts a new gameplay generation. This
    // makes a rapid feature OFF -> ON (or target/travel preference edit) unable
    // to revive an older async plan that was already waiting on a read/queue.
    state.automationEpoch += 1;
    GM_setValue(KEYS.settings,state.settings);
  }
  function saveQt(){GM_setValue(KEYS.quicktrade,state.qt)}
  function saveRestart(){GM_setValue(KEYS.restart,state.restart);renderRestart()}


  function loadSettings(){const r=GM_getValue(KEYS.settings,{});const v=r&&typeof r==='object'?r:{};return {...DEFAULT_SETTINGS,...v,drugRepairDamage:clampInt(v.drugRepairDamage,1,99,DEFAULT_SETTINGS.drugRepairDamage),beamTravelMode:['auto','car','airport'].includes(v.beamTravelMode)?v.beamTravelMode:'auto',autoGunId:clampInt(v.autoGunId,1,9,9)}}
  function loadPlayers(){return sanitisePlayers(GM_getValue(KEYS.playerList,[]))}
  function loadPlayerActions(){
    const r=GM_getValue(KEYS.playerActions,{});
    const v=r&&typeof r==='object'?r:{};
    const out={};
    for(const [rawKey,raw] of Object.entries(v)){
      if(!raw||typeof raw!=='object')continue;
      const key=String(rawKey||'').trim().toLocaleLowerCase();
      if(!key)continue;
      out[key]={
        kill:raw.kill===true,
        beam:raw.beam===true,
        mode:raw.mode==='full'?'full':'bgs',
      };
    }
    return out;
  }
  function loadQuicktrade(){
    const r=GM_getValue(KEYS.quicktrade,{});
    const v=r&&typeof r==='object'?r:{};
    const rules=(Array.isArray(v.rules)?v.rules:[]).slice(0,100).flatMap((raw)=>{
      if(!raw||typeof raw!=='object')return[];
      const id=String(raw.id||'').trim();
      const label=String(raw.label||'').trim();
      const currency=raw.currency==='points'?'points':raw.currency==='money'?'money':'';
      if(!id||!label||!currency)return[];
      return[{id,label:label.slice(0,250),currency,maxPrice:integerText(raw.maxPrice),remaining:integerText(raw.remaining),enabled:raw.enabled!==false}];
    });
    const pending=v.pending&&typeof v.pending==='object'&&['points','perks','swiss'].includes(v.pending.kind)?{
      token:String(v.pending.token||''),
      kind:v.pending.kind,
      ruleId:String(v.pending.ruleId||''),
      units:integerText(v.pending.units),
      amount:integerText(v.pending.amount),
      previousRemaining:integerText(v.pending.previousRemaining),
      reservedRemaining:integerText(v.pending.reservedRemaining),
      quantityEdited:v.pending.quantityEdited===true,
    }:null;
    return{pointsEnabled:v.pointsEnabled===true,pointsMaxPrice:integerText(v.pointsMaxPrice),pointsRemaining:integerText(v.pointsRemaining),perksEnabled:v.perksEnabled===true,rules,pending};
  }
  function loadRestart(){const r=GM_getValue(KEYS.restart,{});const v=r&&typeof r==='object'?r:{};return{enabled:v.enabled===true,retrieveAssets:v.retrieveAssets===true,usernames:sanitiseRestartNames(v.usernames)}}
  function loadLogin(){const r=GM_getValue(KEYS.login,{});const v=r&&typeof r==='object'?r:{};return{email:typeof v.email==='string'?v.email:'',password:typeof v.password==='string'?v.password:'',autoLogin:v.autoLogin!==false}}

  function sanitisePlayers(list){const seen=new Set(),out=[];for(const raw of Array.isArray(list)?list:[]){const n=String(raw||'').trim();const k=n.toLowerCase();if(!n||n.length>30||seen.has(k))continue;seen.add(k);out.push(n)}return out.slice(0,1000)}
  function sanitiseRestartNames(list){const seen=new Set(),out=[];for(const raw of Array.isArray(list)?list:[]){const n=String(raw||'').trim();const k=n.toLowerCase();if(n.length<2||n.length>20||!/^[a-zA-Z0-9 _-]+$/.test(n)||seen.has(k))continue;seen.add(k);out.push(n)}return out.slice(0,1000)}
  function generateRestartNames(existing,count){const first=['Silent','Silver','Crimson','Hidden','Rapid','Frost','Iron','Lucky','Golden','Storm','Night','Wild','Stone','Amber','Royal','Arctic','Solar','Misty','Shadow','Cobalt','Scarlet','Velvet','Copper','Lunar'];const last=['Falcon','Wolf','Raven','Fox','Tiger','Lynx','Hawk','Viper','Panther','Badger','Otter','Owl','Drifter','Comet','Ranger','Sparrow','Ghost','Pilot','Nomad','Cobra','Finch','Heron','Lancer','Rook'];const seen=new Set(existing.map(x=>x.toLowerCase())),out=[];for(let i=0;out.length<count&&i<count*100;i++){const n=`${first[Math.floor(Math.random()*first.length)]}${last[Math.floor(Math.random()*last.length)]}${Math.floor(Math.random()*9000)+1000}`;if(seen.has(n.toLowerCase()))continue;seen.add(n.toLowerCase());out.push(n)}return out}
  function integerText(v){const t=String(v??'').replace(/[\s,]/g,'').trim();return /^\d{1,19}$/.test(t)?t:'0'}
  function formatInteger(v){try{return BigInt(integerText(v)).toLocaleString('en-GB')}catch{return'0'}}
  function clampInt(v,min,max,fallback){const n=Number(v);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback}
  function validTab(v){return['actions','cars','players','quicktrade','restart','login','logs'].includes(v)?v:'actions'}

  function ensureDeviceIdentity(){let id=String(GM_getValue(KEYS.deviceId,'')||'');if(!/^[A-Za-z0-9_-]{10,128}$/.test(id)){id=randomDeviceId();GM_setValue(KEYS.deviceId,id)}let label=String(GM_getValue(KEYS.deviceLabel,'')||'').trim();if(!label){GM_setValue(KEYS.deviceLabel,'Browser')}}
  function randomDeviceId(){if(crypto.randomUUID)return`dev_${crypto.randomUUID().replace(/-/g,'')}`;const b=new Uint8Array(16);crypto.getRandomValues(b);return`dev_${Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')}`}

  function versionParts(value) {
    const match = String(value || '').trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
  }

  function compareVersions(a, b) {
    const aa = versionParts(a);
    const bb = versionParts(b);
    for (let i = 0; i < 3; i += 1) {
      if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
    }
    return 0;
  }

  function normaliseLicenceFeatures(payload) {
    const raw = Array.isArray(payload)
      ? payload
      // v2.2.4 compatibility during rollout: translate the old boolean object
      // into the canonical feature-ID list used from v2.2.5 onward.
      : (payload && typeof payload === 'object' && payload.fastJailStream === true
        ? [LICENCE_FEATURE.FAST_JAIL_STREAM]
        : []);
    const out = new Set();
    for (const value of raw) {
      const feature = String(value || '').trim().toLowerCase();
      if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(feature)) out.add(feature);
    }
    return out;
  }

  function applyVersionInfo(info) {
    if (!info || typeof info !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(info, 'features')) {
      const hadFastJail = hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM);
      state.licenceFeatures = normaliseLicenceFeatures(info.features);
      const hasFastJail = hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM);
      if (hadFastJail !== hasFastJail) {
        if (!hasFastJail) stopJailStream();
        else syncJailStream();
      }
    }
    const latest = String(info.latestLoaderVersion || info.botVersion || '').trim();
    const minimum = String(info.minLoaderVersion || '').trim();
    const updateUrl = String(info.updateUrl || '').trim();
    if (latest) state.updateLatestVersion = latest;
    if (minimum) state.updateMinVersion = minimum;
    if (/^https:\/\//i.test(updateUrl)) state.updateUrl = updateUrl;
    state.updateRequired = Boolean(minimum && compareVersions(SCRIPT_VERSION, minimum) < 0);
    state.updateAvailable = Boolean(latest && compareVersions(SCRIPT_VERSION, latest) < 0);
    state.updateLastCheckedAt = Date.now();
    if (state.updateRequired) {
      const requiredVersion = latest && compareVersions(latest, minimum) >= 0 ? latest : minimum;
      state.updateStatus = `Update required · loader v${SCRIPT_VERSION} → v${requiredVersion}`;
    } else if (state.updateAvailable) {
      state.updateStatus = `Update available · loader v${SCRIPT_VERSION} → v${latest}`;
    } else {
      state.updateStatus = `Loader v${SCRIPT_VERSION} · up to date`;
    }
    renderLogin();
  }

  async function checkForUpdates(manual = false) {
    if (state.updateChecking) return;
    state.updateChecking = true;
    state.updateStatus = `Loader v${SCRIPT_VERSION} · checking for updates…`;
    renderLogin();
    try {
      const info = await requestJson('/api/v1/version');
      applyVersionInfo(info);
      if (manual) log(state.updateStatus, state.updateAvailable || state.updateRequired ? 'warn' : 'ok');
    } catch (error) {
      state.updateStatus = `Loader v${SCRIPT_VERSION} · update check failed: ${friendly(error)}`;
      if (manual) log(`Update check: ${friendly(error)}`, 'warn');
    } finally {
      state.updateChecking = false;
      renderLogin();
    }
  }

  function openLoaderUpdate() {
    const url = /^https:\/\//i.test(String(state.updateUrl || '')) ? state.updateUrl : LOADER_UPDATE_URL;
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function requestJson(path,options={}){return new Promise((resolve,reject)=>{const headers={Accept:'application/json'};let data;if(options.body!==undefined){headers['Content-Type']='application/json';data=JSON.stringify(options.body)}if(options.token)headers.Authorization=`Bearer ${options.token}`;GM_xmlhttpRequest({method:options.method||'GET',url:`${WORKER_URL}${path}`,headers,data,timeout:15000,onload:(r)=>{let body={};try{body=JSON.parse(r.responseText||'{}')}catch{}if(r.status>=200&&r.status<300)return resolve(body);const e=new Error(body.message||`HTTP ${r.status}`);e.status=r.status;e.code=body.code||'';e.body=body;reject(e)},onerror:()=>reject(new Error('Could not reach the licensing server.')),ontimeout:()=>reject(new Error('Licensing request timed out.'))})})}
  function friendly(error){if(error?.code==='disabled')return'This licence is pending or has been disabled by the owner.';if(error?.code==='invalid_licence')return'Licence not recognised.';if(error?.code==='device_limit')return error.message||'Device limit reached.';if(error?.code==='device_removed')return'This device has been removed by the owner.';if(error?.code==='update_required'||error?.code==='websocket_required')return error.message||'This loader version is no longer supported.';if(error?.code==='expired_session')return'Licence session expired. Reauthorising.';return error?.message||String(error||'Unknown error')}
})();
