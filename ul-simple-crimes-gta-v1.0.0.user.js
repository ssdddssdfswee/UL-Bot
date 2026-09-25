// ==UserScript==
// @name         Underworld Legacy - Crimes & GTA
// @namespace    https://underworldlegacy.com/
// @version      1.18.0
// @description  API-first UL automation with Quicktrade, Swiss funding, automatic character restart, username generation, optional asset retrieval and local login recovery.
// @author       Aphotic
// @updateURL    https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js
// @downloadURL  https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js
// @match        https://underworldlegacy.com/*
// @match        https://www.underworldlegacy.com/*
// @match        http://localhost:3000/*
// @match        http://127.0.0.1:3000/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_getTab
// @grant        GM_saveTab
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = 'Underworld Legacy Bot';
  const SETTINGS_KEY = 'ul_simple_crimes_gta_settings_v1';
  const CONTROLLER_LOCK = 'ul-simple-crimes-gta-controller-v1';
  const BOT_TAB_KEY = 'ul_simple_crimes_gta_bot_tab_v1';
  const UI_TAB_KEY = 'ul_simple_crimes_gta_ui_tab_v1';
  const PLAYER_LIST_KEY = 'ul_simple_player_list_v1';
  const PLAYER_ACTIONS_KEY = 'ul_simple_player_actions_v1';
  const DEATH_STOP_KEY = 'ul_simple_death_stop_v1';
  const QT_KEY = 'ul_simple_quicktrade_v1';
  const RESTART_KEY = 'ul_simple_restart_settings_v1';
  const RESTART_PROGRESS_KEY = 'ul_simple_restart_progress_v1';
  const LOGIN_CREDENTIALS_KEY = 'ul_simple_login_credentials_v1';
  const LOGIN_RECOVERY_KEY = 'ul_simple_login_recovery_v5';
  const LOGIN_HANDOFF_KEY = 'ul_simple_login_handoff_v2';
  const LOGIN_WINDOW_PREFIX = 'ul-simple-login-recovery-v2:';
  const LOGIN_TAB_STATE_FIELD = 'ulSimpleCrimesGtaTabStateV3';
  const LOGIN_SUCCESS_GUARD_KEY = 'ul_simple_login_success_guard_v1';
  sessionStorage.removeItem('ul_simple_login_recovery_v1');
  sessionStorage.removeItem('ul_simple_login_recovery_v2');
  sessionStorage.removeItem('ul_simple_login_recovery_v3');
  sessionStorage.removeItem('ul_simple_login_recovery_v4');
  const LOGIN_RECOVERY_MAX_AGE_MS = 30 * 60_000;
  const LOGIN_HANDOFF_MAX_AGE_MS = 2 * 60_000;
  const LOGIN_RECOVERY_PROBE_MS = 2_000;
  const ONLINE_DISCOVERY_MS = 2 * 60_000;
  const GANG_DISCOVERY_MS = 10 * 60_000;
  const PLAYER_SEARCH_MIN_RENEW_LEAD_SECONDS = 30 * 60;
  const PLAYER_SEARCH_RENEW_SAFETY_SECONDS = 120;
  const SHOOT_WINDOW_MS = 10_000;
  const SHOOT_WINDOW_LIMIT = 49;
  // September 18 game source: separate fixed windows, NOT a combined
  // prepare/shoot allowance. Sliding client windows are slightly stricter.
  const ACTION_RATE_LIMITS = Object.freeze({
    shoot: { limit: SHOOT_WINDOW_LIMIT, windowMs: SHOOT_WINDOW_MS },
    prepare: { limit: 98, windowMs: 10_000 },
    search: { limit: 98, windowMs: 10_000 },
    crime: { limit: 98, windowMs: 10_000 },
    gta: { limit: 98, windowMs: 10_000 },
    quicktrade: { limit: 98, windowMs: 10_000 },
    retrieve: { limit: 19, windowMs: 30_000 },
  });
  // The server refills 20 global request tokens per second with a 100-request
  // burst. Keep a little headroom for ordinary play in another tab while still
  // allowing the bot to use accumulated burst capacity.
  const REQUEST_REFILL_PER_SECOND = 18;
  const REQUEST_BURST_CAPACITY = 80;
  const REQUEST_PRIORITY = Object.freeze({ ACTION: 0, RAPID: 1, NORMAL: 2, BACKGROUND: 3 });
  const DRUG_ROUTE = Object.freeze({
    russia: { buy: 'heroin', next: 'usa' },
    usa: { buy: 'lsd', next: 'south africa' },
    'south africa': { buy: 'ecstasy', next: 'russia' },
  });
  const DRUG_SELL_DESTINATIONS = Object.freeze({
    cannabis: 'russia',
    heroin: 'usa',
    cocaine: 'england',
    ecstasy: 'russia',
    lsd: 'south africa',
  });
  const TOGGLEABLE_TUNER_NAME = 'Tuner';
  const NEVER_MELT_CAR_NAMES = new Set([
    'RS Tuner',
    'Mythic Car',
    'Hyper Car',
    'Black Car',
    'Orange Car',
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
    autoRank: false,
    discoverPlayers: false,
    searchPlayers: false,
    beamTravelMode: 'auto',
    drugRepairDamage: 60,
  });

  const state = {
    settings: loadSettings(),
    botTab: sessionStorage.getItem(BOT_TAB_KEY) === 'true',
    uiTab: ['actions', 'cars', 'players', 'quicktrade', 'restart', 'login', 'logs'].includes(sessionStorage.getItem(UI_TAB_KEY))
      ? sessionStorage.getItem(UI_TAB_KEY)
      : 'actions',
    controller: false,
    generation: 0,
    apiInFlight: 0,
    restart: sanitiseRestart(GM_getValue(RESTART_KEY, null)),
    restartProgress: sanitiseRestartProgress(GM_getValue(RESTART_PROGRESS_KEY, null)),
    restartRevision: 0,
    restartRunning: false,
    controllerLockRequested: false,
    releaseController: null,
    inJail: false,
    jailMarkedAt: 0,
    authRequired: false,
    loginRecovery: loadLoginRecovery(),
    loginCredentials: loadLoginCredentials(),
    loginCredentialStatus: '',
    globalRateLimitedUntil: 0,
    stoppedForDeath: GM_getValue(DEATH_STOP_KEY, false) === true,
    currentAction: 'Waiting for controller',
    lastAction: 'None yet',
    crimesDueAt: 0,
    gtaDueAt: 0,
    jailBustDueAt: 0,
    meltDueAt: 0,
    drugsDueAt: 0,
    autoRankDueAt: 0,
    playerDiscoveryDueAt: 0,
    gangDiscoveryDueAt: 0,
    playerSearchDueAt: 0,
    combatDueAt: 0,
    beamTravelRefreshPending: false,
    jailDueAt: 0,
    qt: loadQuicktrade(),
    qtRevision: 0,
    qtDueAt: 0,
    qtRunning: false,
    qtCatalogRunning: false,
    qtLastKind: 'perks',
    qtOfferRetryAt: new Map(),
    qtCatalog: [],
    qtStatus: 'Quicktrade purchasing disabled',
    crimesRunning: false,
    gtaRunning: false,
    jailBustRunning: false,
    meltRunning: false,
    drugsRunning: false,
    autoRankRunning: false,
    playerDiscoveryRunning: false,
    gangDiscoveryRunning: false,
    playerSearchRunning: false,
    combatRunning: false,
    jailRunning: false,
    jailMonitorRunning: false,
    jailBustCandidate: null,
    drugContextLoaded: false,
    drugFavouriteCarId: null,
    drugStatus: 'Drugs not checked',
    autoRankActive: false,
    autoRankEndsAt: 0,
    autoRankControls: { crimes: false, gta: false, melt: false },
    autoRankMeltCarNames: [],
    autoRankMeltNotice: '',
    tunerMeltNotice: '',
    autoRankStatus: 'Auto Rank not checked',
    playerNames: loadPlayerNames(),
    playerActions: loadPlayerActions(),
    viewerUsername: '',
    playerDiscoveryStatus: 'Player discovery disabled',
    playerSearchStatus: 'Player searching disabled',
    playerSearchBackoff: new Map(),
    searchesInFlight: new Map(),
    searchData: null,
    searchDataLoadedAt: 0,
    killData: null,
    killDataLoadedAt: 0,
    killDataRevision: 0,
    activeBodyguard: null,
    combatStatus: 'Kill and Beam idle',
    actionTails: new Map(),
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

  let schedulerTimer = null;
  let schedulerWakeQueued = false;
  let schedulerStarted = false;
  let loginRecoveryTimer = null;
  let loginRecoveryProbeRunning = false;
  let loginRecoveryLastProbeAt = 0;
  let loginRecoverySubmitRunning = false;
  let loginRecoveryLastRedirectAt = 0;
  let restartTimer = null;

  class ApiError extends Error {
    constructor(status, message, body, retryAfter = 0) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
      this.retryAfter = retryAfter;
    }
  }

  class ActionCancelledError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ActionCancelledError';
    }
  }

  function loadSettings() {
    const stored = GM_getValue(SETTINGS_KEY, {});
    return sanitiseSettings({ ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) });
  }

  // Decimal strings avoid rounding large game balances/prices through Number.
  function qtInteger(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return '0';
    const text = String(value ?? '').trim().replace(/[\s,]/g, '');
    if (!/^\d{1,19}$/.test(text)) return '0';
    const amount = BigInt(text);
    return amount <= 9223372036854775807n ? amount.toString() : '0';
  }

  function sanitiseQuicktrade(value) {
    const v = value && typeof value === 'object' ? value : {};
    const ids = new Set();
    const rules = (Array.isArray(v.rules) ? v.rules : []).slice(0, 100).flatMap((rule) => {
      if (!rule || typeof rule !== 'object' || typeof rule.id !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(rule.id) || ids.has(rule.id)) return [];
      if (typeof rule.label !== 'string' || !rule.label.trim() || rule.label.length > 250 || !['money', 'points'].includes(rule.currency)) return [];
      ids.add(rule.id);
      return [{ id: rule.id, label: rule.label.trim(), currency: rule.currency,
        maxPrice: qtInteger(rule.maxPrice), remaining: qtInteger(rule.remaining), enabled: rule.enabled === true }];
    });
    return {
      pointsEnabled: v.pointsEnabled === true,
      pointsMaxPrice: qtInteger(v.pointsMaxPrice),
      pointsRemaining: qtInteger(v.pointsRemaining),
      perksEnabled: v.perksEnabled === true,
      rules,
      // Save pending purchases/withdrawals before dispatch. Neither API has
      // an idempotency key, so a lost response must prevent automatic retries.
      pending: v.pending && typeof v.pending === 'object' ? v.pending : null,
    };
  }

  function loadQuicktrade() { return sanitiseQuicktrade(GM_getValue(QT_KEY, null)); }

  function saveQuicktrade(patch, editedQuantityKey = '') {
    const next = sanitiseQuicktrade({ ...state.qt, ...patch });
    // Saving a quantity replaces the remaining budget, even when its numeric
    // value equals the reservation. A rejected request must not undo that edit.
    const pendingKey = next.pending?.kind === 'points' ? 'points' : next.pending?.ruleId;
    if (next.pending && editedQuantityKey && editedQuantityKey === pendingKey) {
      next.pending = { ...next.pending, quantityEdited: true };
    }
    GM_setValue(QT_KEY, next);
    state.qt = next;
    state.qtRevision += 1;
    state.qtDueAt = 0;
    render();
    requestSchedulerWake();
  }

  function qtPointsReady() {
    return state.qt.pointsEnabled && BigInt(state.qt.pointsMaxPrice) > 0n && BigInt(state.qt.pointsRemaining) > 0n;
  }

  function qtPerksReady() {
    return state.qt.perksEnabled && state.qt.rules.some((r) => r.enabled && BigInt(r.maxPrice) > 0n && BigInt(r.remaining) > 0n);
  }

  function qtReady() { return !state.qt.pending && (qtPointsReady() || qtPerksReady()); }

  function qtPointsCandidate(offer) {
    if (!qtPointsReady() || !offer || offer.own !== false || !offer.id) return null;
    const units = BigInt(qtInteger(offer.points));
    const price = BigInt(qtInteger(offer.pricePerPoint));
    const total = BigInt(qtInteger(offer.totalMoney));
    if (units <= 0n || price <= 0n || total !== units * price || !Number.isSafeInteger(offer.offerCount) || offer.offerCount < 1) return null;
    if (price > BigInt(state.qt.pointsMaxPrice) || units > BigInt(state.qt.pointsRemaining)) return null;
    return { kind: 'points', id: String(offer.id), units: units.toString(), price, total };
  }

  function qtPerkCandidate(offer, ruleId = '') {
    if (!state.qt.perksEnabled || !offer || offer.own !== false || !offer.id || !['money', 'points'].includes(offer.saleCurrency)) return null;
    const price = BigInt(qtInteger(offer.salePrice));
    if (price <= 0n || (offer.permanent !== true && (!Number.isFinite(Number(offer.expires)) || Number(offer.expires) <= 0))) return null;
    const rule = state.qt.rules.find((r) => (!ruleId || r.id === ruleId) && r.enabled
      && r.label === offer.label && r.currency === offer.saleCurrency
      && BigInt(r.remaining) > 0n && price <= BigInt(r.maxPrice));
    return rule ? { kind: 'perks', id: String(offer.id), ruleId: rule.id, label: rule.label, currency: rule.currency, units: '1', price } : null;
  }

  function rememberQtCatalog(data) {
    const labels = new Set(state.qtCatalog);
    for (const offer of Array.isArray(data.perkOffers) ? data.perkOffers : []) {
      if (typeof offer.label === 'string' && offer.label.length <= 250) labels.add(offer.label);
    }
    state.qtCatalog = [...labels].sort((a, b) => a.localeCompare(b)).slice(0, 1000);
  }

  async function refreshQtCatalog() {
    if (state.qtCatalogRunning) return;
    if (!actionAllowed() || state.authRequired) {
      state.qtStatus = 'Start the bot in this tab to load perk names. Purchasing toggles can stay off.';
      render(); return;
    }
    state.qtCatalogRunning = true;
    try {
      const data = await api('/api/qt?a=perks&v=con', { priority: REQUEST_PRIORITY.NORMAL });
      rememberQtCatalog(data);
      state.qtStatus = `Loaded ${state.qtCatalog.length} perk names. Select or type the exact name.`;
    } catch (error) {
      handleTaskError('Quicktrade list', error);
      state.qtStatus = `Could not load perks: ${error.message}`;
    } finally { state.qtCatalogRunning = false; render(); }
  }

  async function buyQuicktrade(candidate) {
    let revision = state.qtRevision;
    const generation = state.generation;
    let quoteAt = 0;
    let pending = null;
    const validate = () => {
      if (generation !== state.generation || state.inJail) throw new ActionCancelledError('Quicktrade stopped or player jailed');
      if (revision !== state.qtRevision || state.qt.pending || !qtReady()) throw new ActionCancelledError('Quicktrade settings changed');
      if (quoteAt && Date.now() - quoteAt > 1500) throw new ActionCancelledError('Quicktrade quote needs refreshing');
    };
    const saveWorkflow = (patch) => {
      // Our pending-marker writes may advance the revision, but must never
      // hide a settings edit made by the user during an in-flight withdrawal.
      const unchanged = revision === state.qtRevision;
      saveQuicktrade(patch);
      if (unchanged) revision = state.qtRevision;
    };
    const refreshQuote = async () => {
      let refreshed;
      if (candidate.kind === 'points') {
        const data = await api('/api/qt?a=points', { priority: REQUEST_PRIORITY.NORMAL, validate });
        const row = (Array.isArray(data.pointsOffers) ? data.pointsOffers : []).find((o) => String(o.id) === candidate.id);
        refreshed = qtPointsCandidate(row);
      } else {
        const row = await api(`/api/perks/${encodeURIComponent(candidate.id)}`, { priority: REQUEST_PRIORITY.NORMAL, validate });
        refreshed = row.forSale === true ? qtPerkCandidate(row, candidate.ruleId) : null;
      }
      if (!refreshed || refreshed.units !== candidate.units || refreshed.price !== candidate.price) {
        throw new ActionCancelledError('Quicktrade listing changed or sold');
      }
    };
    const fundCashPurchase = async () => {
      const cost = candidate.kind === 'points' ? candidate.total : candidate.price;
      const bank = await api('/api/bank', { priority: REQUEST_PRIORITY.NORMAL, validate });
      // Bank moneyToJson returns decimal strings. Missing/rounded balances
      // are not zero: refuse to move money if either balance is unreadable.
      const balance = (value) => {
        if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) {
          throw new Error('Could not read Quicktrade cash/Swiss balances');
        }
        return BigInt(value);
      };
      const cash = balance(bank.money), swiss = balance(bank.swissMoney);
      const shortfall = cost > cash ? cost - cash : 0n;
      if (shortfall === 0n) return;
      if (swiss < shortfall) throw new ApiError(400, 'Not enough cash plus Swiss for this Quicktrade offer', {});
      const balanceAt = Date.now();
      let withdrawalToken = null;
      try {
        // Already inside the economy queue: a nested queueAction would wait
        // on itself. api still applies the global limiter and dispatch guards.
        const result = await api('/api/bank/swiss', {
          method: 'POST', body: { action: 'withdraw', amount: shortfall.toString() },
          priority: REQUEST_PRIORITY.NORMAL, timeoutMs: 30_000,
          validate: () => {
            validate();
            if (Date.now() - balanceAt > 1500) throw new ActionCancelledError('Swiss balance needs refreshing');
          },
          onDispatch: () => {
            withdrawalToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            saveWorkflow({ pending: { token: withdrawalToken, kind: 'swiss', amount: shortfall.toString() } });
          },
        });
        if (!/^You withdrew\b/i.test(cleanMessage(result.html))) throw new Error('Swiss response did not confirm a withdrawal');
        if (state.qt.pending?.token !== withdrawalToken) throw new ActionCancelledError('Swiss withdrawal state changed');
        saveWorkflow({ pending: null });
        log(`Quicktrade: withdrew $${shortfall.toLocaleString('en-GB')} from Swiss`, 'ok');
      } catch (error) {
        if (withdrawalToken && state.qt.pending?.token === withdrawalToken) {
          if (error instanceof ApiError && [400, 401, 403, 404, 409, 429].includes(error.status)) {
            saveWorkflow({ pending: null });
          } else {
            state.qtStatus = 'Swiss withdrawal unconfirmed. Check your bank before resuming Quicktrade.';
            log(state.qtStatus, 'warn');
          }
        }
        throw error;
      }
    };
    try {
      const result = await queueAction(candidate.kind === 'points' ? '/api/qt/accept' : '/api/qt/perks/buy',
        candidate.kind === 'points' ? `Buying ${candidate.units} Quicktrade points` : `Buying perk: ${candidate.label}`, {
          body: candidate.kind === 'points' ? { buy: 'points', id: candidate.id } : { ids: [candidate.id] },
          priority: REQUEST_PRIORITY.NORMAL,
          timeoutMs: 30_000,
          validate,
          beforeSend: async () => {
            // This runs inside the shared spending lane, after earlier travel,
            // repairs or shots finish. Never buy from an old queued snapshot.
            await refreshQuote();
            if (candidate.kind === 'points' || candidate.currency === 'money') {
              await fundCashPurchase();
              // A listing may disappear or change while banking is in flight.
              await refreshQuote();
            }
            quoteAt = Date.now();
          },
          onDispatch: () => {
            const remaining = candidate.kind === 'points' ? state.qt.pointsRemaining : state.qt.rules.find((r) => r.id === candidate.ruleId).remaining;
            pending = { token: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind: candidate.kind,
              ruleId: candidate.ruleId || '', units: candidate.units, reservedRemaining: (BigInt(remaining) - BigInt(candidate.units)).toString() };
            const patch = candidate.kind === 'points'
              ? { pointsRemaining: pending.reservedRemaining }
              : { rules: state.qt.rules.map((r) => r.id === candidate.ruleId ? { ...r, remaining: pending.reservedRemaining } : r) };
            saveQuicktrade({ ...patch, pending });
          },
        });
      if (!/^You bought\b/i.test(cleanMessage(result.html))) throw new Error('Purchase response did not confirm a purchase');
      if (state.qt.pending?.token === pending?.token) saveQuicktrade({ pending: null });
      state.qtStatus = cleanMessage(result.html);
      return true;
    } catch (error) {
      if (pending && state.qt.pending?.token === pending.token) {
        const definitelyRejected = error instanceof ApiError && [400, 401, 403, 404, 409, 429].includes(error.status);
        if (definitelyRejected) {
          // Only restore the reservation if the user has not edited that limit.
          const patch = { pending: null };
          const quantityEdited = state.qt.pending.quantityEdited === true;
          if (!quantityEdited && candidate.kind === 'points' && state.qt.pointsRemaining === pending.reservedRemaining) {
            patch.pointsRemaining = (BigInt(state.qt.pointsRemaining) + BigInt(pending.units)).toString();
          } else if (!quantityEdited && candidate.kind === 'perks') {
            patch.rules = state.qt.rules.map((r) => r.id === pending.ruleId && r.remaining === pending.reservedRemaining
              ? { ...r, remaining: (BigInt(r.remaining) + 1n).toString() } : r);
          }
          saveQuicktrade(patch);
        } else {
          state.qtStatus = 'Purchase unconfirmed. Check game transactions before resuming Quicktrade.';
          log(state.qtStatus, 'warn');
        }
      }
      throw error;
    }
  }

  async function runQuicktrade() {
    if (state.qtRunning || !qtReady()) return;
    state.qtRunning = true;
    const generation = state.generation;
    let candidate = null;
    try {
      const [points, perks] = await Promise.all([
        qtPointsReady() ? api('/api/qt?a=points', { priority: REQUEST_PRIORITY.NORMAL }) : null,
        qtPerksReady() ? api('/api/qt?a=perks&v=con', { priority: REQUEST_PRIORITY.NORMAL }) : null,
      ]);
      if (perks) rememberQtCatalog(perks);
      for (const [key, until] of state.qtOfferRetryAt) {
        if (until <= Date.now()) state.qtOfferRetryAt.delete(key);
      }
      const available = (offer) => offer && !state.qtOfferRetryAt.has(`${offer.kind}:${offer.id}`);
      const sort = (a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0;
      const point = (points?.pointsOffers || []).map(qtPointsCandidate).filter(available).sort(sort)[0];
      const perk = (perks?.perkOffers || []).map((o) => qtPerkCandidate(o)).filter(available)
        .sort((a, b) => a.currency.localeCompare(b.currency) || sort(a, b))[0];
      candidate = point && perk ? (state.qtLastKind === 'points' ? perk : point) : point || perk;
      state.qtDueAt = Date.now() + 1000;
      if (candidate) {
        state.qtLastKind = candidate.kind;
        await buyQuicktrade(candidate);
        state.qtDueAt = Date.now();
      } else state.qtStatus = 'Watching Quicktrade — no matching offers within your limits';
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) handleTaskError('Quicktrade', error);
      if (!state.qt.pending) state.qtStatus = error.message || 'Quicktrade check failed';
      state.qtDueAt = Date.now() + (error instanceof ActionCancelledError ? 500 : errorBackoff(error));
      if (candidate && !state.qt.pending && error instanceof ApiError && [400, 403, 404].includes(error.status)
        && !error.body?.dead && !error.body?.inJail) {
        // A cheap but unaffordable/blocked listing must not hide other offers.
        // Retry this listing later; other candidates keep their normal budget.
        state.qtOfferRetryAt.set(`${candidate.kind}:${candidate.id}`, Date.now() + 15_000);
        if (state.qtOfferRetryAt.size > 1000) state.qtOfferRetryAt.delete(state.qtOfferRetryAt.keys().next().value);
        state.qtDueAt = Date.now() + 100;
      }
    } finally {
      state.qtRunning = false;
      if (generation !== state.generation && !state.qt.pending) state.qtStatus = 'Quicktrade stopped';
      render();
    }
  }

  function validRestartName(value) {
    const name = String(value ?? '').trim();
    return name.length >= 2 && name.length <= 20 && /^[a-zA-Z0-9 _-]+$/.test(name) ? name : '';
  }

  function sanitiseRestart(value) {
    const v = value && typeof value === 'object' ? value : {};
    const seen = new Set();
    const usernames = (Array.isArray(v.usernames) ? v.usernames : []).flatMap((raw) => {
      const name = validRestartName(raw), key = name.toLowerCase();
      if (!name || seen.has(key)) return [];
      seen.add(key); return [name];
    }).slice(0, 1000);
    return { enabled: v.enabled === true, retrieveAssets: v.retrieveAssets === true, usernames };
  }

  function sanitiseRestartProgress(value) {
    const v = value && typeof value === 'object' ? value : {};
    return {
      active: v.active === true, blocked: v.blocked === true,
      userId: typeof v.userId === 'string' ? v.userId.slice(0, 100) : '',
      oldUsername: validRestartName(v.oldUsername), username: validRestartName(v.username),
      created: v.created === true, retrievalDone: v.retrievalDone === true,
      pending: ['create', 'retrieve'].includes(v.pending) ? v.pending : '',
      loginAttempted: v.loginAttempted === true, allowRetry: v.allowRetry === true,
      dueAt: Number.isFinite(v.dueAt) && v.dueAt > 0 ? v.dueAt : 0,
      message: typeof v.message === 'string' ? v.message.slice(0, 600) : '',
    };
  }

  function saveRestartProgress(patch) {
    state.restartProgress = sanitiseRestartProgress({ ...state.restartProgress, ...patch });
    GM_setValue(RESTART_PROGRESS_KEY, state.restartProgress);
    render();
  }

  function cancelRestart() {
    if (state.restartProgress.active) {
      // Keep any dispatched operation for reconciliation if the user resumes.
      saveRestartProgress({ active: false, blocked: false, allowRetry: false, message: 'Automatic restart stopped' });
    }
  }

  function saveRestart(patch) {
    state.restart = sanitiseRestart({ ...state.restart, ...patch });
    GM_setValue(RESTART_KEY, state.restart);
    state.restartRevision += 1;
    if (!state.restart.enabled) { state.generation += 1; cancelRestart(); }
    else if (state.restartProgress.active) saveRestartProgress({ blocked: false, dueAt: 0 });
    render();
  }

  function generateRestartNames(existing, count = 100) {
    const first = ['Silent', 'Silver', 'Crimson', 'Hidden', 'Rapid', 'Frost', 'Iron', 'Lucky', 'Golden', 'Storm', 'Night', 'Wild', 'Stone', 'Amber', 'Royal', 'Arctic', 'Solar', 'Misty', 'Shadow', 'Cobalt', 'Scarlet', 'Velvet', 'Copper', 'Lunar'];
    const last = ['Falcon', 'Wolf', 'Raven', 'Fox', 'Tiger', 'Lynx', 'Hawk', 'Viper', 'Panther', 'Badger', 'Otter', 'Owl', 'Drifter', 'Comet', 'Ranger', 'Sparrow', 'Ghost', 'Pilot', 'Nomad', 'Cobra', 'Finch', 'Heron', 'Lancer', 'Rook'];
    const seen = new Set(existing.map((name) => String(name).trim().toLowerCase()));
    const names = [];
    for (let attempt = 0; names.length < count && attempt < count * 100; attempt++) {
      const name = `${first[Math.floor(Math.random() * first.length)]}${last[Math.floor(Math.random() * last.length)]}${Math.floor(Math.random() * 9000) + 1000}`;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase()); names.push(name);
    }
    return names;
  }

  function armRestart() {
    if (!state.restart.enabled || !state.botTab) return false;
    state.generation += 1;
    clearLoginRecovery();
    state.settings = sanitiseSettings({ ...state.settings, enabled: false });
    GM_setValue(SETTINGS_KEY, state.settings);
    saveRestartProgress({ active: true, blocked: false, dueAt: 0, message: 'Checking account before restart' });
    return true;
  }

  function restartAllowed() {
    return state.botTab && state.controller && state.restart.enabled
      && state.restartProgress.active && !state.restartProgress.blocked;
  }

  function pauseRestart(message) {
    saveRestartProgress({ blocked: true, message });
    log(`Restart: ${message}`, 'warn');
  }

  function retryRestart() {
    if (!state.restart.enabled || !state.botTab || state.restartRunning) return;
    if (!state.restartProgress.active && !state.stoppedForDeath && !state.restartProgress.pending) return;
    armRestart();
    saveRestartProgress({ allowRetry: true, loginAttempted: false, message: 'Rechecking account before retry' });
    restartTick();
  }

  async function runRestart() {
    if (!restartAllowed() || state.restartRunning) return;
    // Drain old requests before rotating the session. Queued gameplay requests
    // are invalidated by generation and cannot dispatch during this workflow.
    if (state.apiInFlight || loginRecoverySubmitRunning || loginRecoveryProbeRunning) return;
    state.restartRunning = true;
    const generation = state.generation;
    let revision = state.restartRevision;
    let stage = 'check';
    const check = () => {
      if (!restartAllowed() || generation !== state.generation || revision !== state.restartRevision) {
        throw new ActionCancelledError('Restart stopped or settings changed');
      }
    };
    const request = async (path, options = {}) => {
      const data = await api(path, { ...options, restartFlow: true, priority: REQUEST_PRIORITY.NORMAL, validate: check });
      check(); return data;
    };
    const removeName = (name) => {
      saveRestart({ usernames: state.restart.usernames.filter((n) => n.toLowerCase() !== name.toLowerCase()) });
      revision = state.restartRevision;
    };
    const mutate = async (kind, path, body) => {
      try {
        return await request(path, { method: 'POST', body, timeoutMs: 60_000,
          onDispatch: () => saveRestartProgress({ pending: kind, allowRetry: false }) });
      } catch (error) {
        if (generation === state.generation && error instanceof ApiError && [400, 401, 403, 404, 409, 429].includes(error.status)) {
          saveRestartProgress({ pending: '' });
        }
        throw error;
      }
    };
    try {
      let identity;
      try { identity = await request('/api/auth/me'); }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        stage = 'login';
        if (state.restartProgress.loginAttempted) return pauseRestart('Login was not confirmed. Log in manually or check the Login tab and retry.');
        const credentials = loadLoginCredentials();
        if (!credentials.autoLogin || !hasSavedLoginCredentials(credentials)) {
          return pauseRestart('Login required. Save your existing email/password and enable Auto-login in the Login tab, or log in manually, then retry.');
        }
        saveRestartProgress({ message: 'Logging in to the existing account' });
        identity = await request('/api/auth/login', { method: 'POST', timeoutMs: 20_000,
          body: { email: credentials.email, password: credentials.password },
          onDispatch: () => saveRestartProgress({ loginAttempted: true }) });
        saveRestartProgress({ loginAttempted: false });
      }
      stage = 'check';
      if (!identity?.user?.id || typeof identity.dead !== 'boolean' || typeof identity.emailVerified !== 'boolean') throw new Error('Could not verify the logged-in account');
      if (state.restartProgress.userId && state.restartProgress.userId !== identity.user.id) {
        return pauseRestart('The logged-in account has changed. Stop automatic restart and check the account.');
      }
      saveRestartProgress({ userId: identity.user.id });
      if (!identity.emailVerified) return pauseRestart('Email verification is required. Complete it normally, then retry.');
      let status = await request('/api/death/status');
      if (typeof status.dead !== 'boolean' || !validRestartName(status.username)) throw new Error('Could not verify the current character');
      if (status.dead) {
        if (state.restartProgress.created || (state.restartProgress.oldUsername && state.restartProgress.oldUsername !== status.username)) {
          return pauseRestart('The character changed or died again during restart. Check the game before continuing.');
        }
        if (state.restartProgress.pending === 'create' && !state.restartProgress.allowRetry) {
          return pauseRestart('Character creation was not confirmed. Check the game, then use Retry after checking.');
        }
        const username = state.restartProgress.username || state.restart.usernames[0];
        if (!username) return pauseRestart('No usernames remaining. Add names or generate 100, then save the list.');
        saveRestartProgress({ oldUsername: status.username, username, message: `Creating ${username}` });
        stage = 'create';
        const result = await mutate('create', '/api/death/restart', { username });
        if (result.ok !== true || result.username !== username) throw new Error('Character creation response was not confirmed');
        saveRestartProgress({ pending: '', created: true });
        removeName(username);
        status = await request('/api/death/status');
      } else {
        if (state.restartProgress.username && state.restartProgress.username !== status.username) {
          return pauseRestart('The active username does not match the pending restart. Check the game before continuing.');
        }
        // A lost success response or page reload is reconciled from the live
        // character; never send another create request once it already exists.
        if (state.restartProgress.pending === 'create') removeName(status.username);
        saveRestartProgress({ username: status.username, created: true,
          pending: state.restartProgress.pending === 'create' ? '' : state.restartProgress.pending });
      }
      if (status.dead !== false || status.username !== state.restartProgress.username) {
        return pauseRestart('The new character could not be confirmed alive. Check the game before continuing.');
      }
      stage = 'retrieve';
      if ((!state.restartProgress.retrievalDone && state.restart.retrieveAssets) || state.restartProgress.pending === 'retrieve') {
        saveRestartProgress({ message: 'Checking assets available to retrieve' });
        const data = await request('/api/retrieve');
        const totals = data.retrievalTotals;
        if (!totals || !['swissMoney', 'points'].every((key) => typeof totals[key] === 'string' && /^\d{1,36}$/.test(totals[key]))
          || !Number.isSafeInteger(totals.retrievableCarCount) || totals.retrievableCarCount < 0) throw new Error('Could not read the retrieval totals');
        const available = BigInt(totals.swissMoney) > 0n || BigInt(totals.points) > 0n || totals.retrievableCarCount > 0;
        if (available && state.restartProgress.pending === 'retrieve' && !state.restartProgress.allowRetry) {
          return pauseRestart('Asset retrieval was not confirmed. Check Retrieve Accounts before retrying.');
        }
        if (available && state.restart.retrieveAssets) {
          saveRestartProgress({ message: 'Retrieving Swiss, points and eligible cars (normal tax/fees apply)' });
          const result = await mutate('retrieve', '/api/retrieve/all', {});
          if (!/^Retrieved\b/i.test(cleanMessage(result.html))) throw new Error('Asset retrieval response was not confirmed');
          log(cleanMessage(result.html), 'ok');
        }
        saveRestartProgress({ pending: '', retrievalDone: true });
      }
      stage = 'finish';
      const finalStatus = await request('/api/death/status');
      if (finalStatus.dead !== false || finalStatus.username !== state.restartProgress.username) return pauseRestart('Character changed before resuming. Check the game.');
      const username = finalStatus.username;
      state.generation += 1;
      prepareRuntimeForStart(true);
      state.settings = sanitiseSettings({ ...state.settings, enabled: true });
      GM_setValue(SETTINGS_KEY, state.settings);
      state.restartProgress = sanitiseRestartProgress(null);
      saveRestartProgress({ message: `Restart complete — ${username}` });
      log(`Restart complete: ${username} — resuming saved bot modules`, 'ok');
      // Leave public/death pages after the new session and retrieval are ready.
      if (isLoginPage() || /^\/death(?:\/|$)/.test(location.pathname)) {
        setLoginSuccessGuard(); location.replace('/home');
      }
      wakeAll();
    } catch (error) {
      if (error instanceof ActionCancelledError || generation !== state.generation) return;
      if (error instanceof ApiError && error.status === 429) {
        if (stage === 'login') saveRestartProgress({ loginAttempted: false });
        saveRestartProgress({ dueAt: Date.now() + Math.max(1000, errorBackoff(error)), message: 'Server rate limit — waiting before retry' });
      } else if (stage === 'create' && error instanceof ApiError && error.status === 400 && /username is already taken/i.test(error.message)) {
        const name = state.restartProgress.username;
        removeName(name);
        saveRestartProgress({ username: '', pending: '', dueAt: Date.now() + 500, message: `${name} is taken — trying the next name` });
      } else if (!(error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status))
        && (state.restartProgress.pending || (stage === 'login' && state.restartProgress.loginAttempted))) {
        // Read-only reconciliation may establish success after a lost response.
        // If it cannot, the next check pauses without repeating the mutation.
        saveRestartProgress({ dueAt: Date.now() + 2000, message: 'Response lost — checking account state before continuing' });
      } else if (error instanceof ApiError && error.status === 401 && stage !== 'login') {
        saveRestartProgress({ dueAt: Date.now() + 1000, message: 'Session changed — checking login again' });
      } else if (state.restartProgress.pending || stage === 'login' || (error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status))) {
        pauseRestart(`${error.message || 'Request unconfirmed'}. Check the game and retry${stage === 'retrieve' ? ', or turn asset retrieval off to resume without it' : ''}.`);
      } else {
        saveRestartProgress({ dueAt: Date.now() + 5000, message: `Restart check failed: ${error.message || 'Connection error'}` });
      }
    } finally {
      state.restartRunning = false;
      render(); requestSchedulerWake();
    }
  }

  function restartTick() {
    if (state.botTab && state.controller && state.restart.enabled && state.settings.enabled
      && location.pathname === '/death' && !loginSuccessGuardActive()) stopAutomationForDeath();
    if (restartAllowed() && !state.restartRunning && state.restartProgress.dueAt <= Date.now()) void runRestart();
  }

  function startRestartWatcher() {
    if (restartTimer !== null) return;
    restartTimer = setInterval(restartTick, 500);
    restartTick();
  }

  function sanitiseLoginCredentials(value) {
    const email = typeof (value && value.email) === 'string' ? value.email.trim() : '';
    const password = typeof (value && value.password) === 'string' ? value.password : '';
    return {
      email,
      password,
      autoLogin: value && value.autoLogin === false ? false : true,
    };
  }

  function loadLoginCredentials() {
    const stored = GM_getValue(LOGIN_CREDENTIALS_KEY, null);
    return sanitiseLoginCredentials(stored && typeof stored === 'object' ? stored : null);
  }

  function hasSavedLoginCredentials(credentials = state.loginCredentials) {
    return !!(credentials && credentials.email && credentials.password);
  }

  function saveLocalLoginCredentials(email, password, autoLogin) {
    const next = sanitiseLoginCredentials({ email, password, autoLogin });
    if (!next.email || !next.password) return false;
    state.loginCredentials = next;
    GM_setValue(LOGIN_CREDENTIALS_KEY, next);
    state.loginCredentialStatus = 'Login saved locally in Tampermonkey';
    log('Login credentials saved locally in Tampermonkey', 'ok');
    return true;
  }

  function clearLocalLoginCredentials() {
    state.loginCredentials = sanitiseLoginCredentials(null);
    GM_setValue(LOGIN_CREDENTIALS_KEY, null);
    state.loginCredentialStatus = 'Saved login cleared';
    log('Saved login cleared from Tampermonkey', 'info');
  }

  function isLoginPage() {
    // Underworld Legacy serves the login form at the site root (/).
    // There is no dedicated /login route; unauthenticated game pages redirect here.
    return location.pathname === '/';
  }

  function currentRelativeUrl() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function setLoginSuccessGuard(durationMs = 10_000) {
    try {
      sessionStorage.setItem(LOGIN_SUCCESS_GUARD_KEY, String(Date.now() + durationMs));
    } catch {}
  }

  function loginSuccessGuardActive() {
    try {
      const until = Number(sessionStorage.getItem(LOGIN_SUCCESS_GUARD_KEY) || 0);
      if (Number.isFinite(until) && until > Date.now()) return true;
      sessionStorage.removeItem(LOGIN_SUCCESS_GUARD_KEY);
    } catch {}
    return false;
  }

  function safeReturnUrl(value) {
    const url = String(value || '');
    if (!url.startsWith('/') || url.startsWith('//') || url === '/' || /^\/login(?:[/?#]|$)/.test(url)) return '/home';
    return url;
  }

  function makeLoginRecoveryToken() {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    } catch {
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  }

  function sanitiseLoginRecovery(value) {
    const startedAt = Number(value && value.startedAt);
    if (!value || value.active !== true || !Number.isFinite(startedAt) || Date.now() - startedAt > LOGIN_RECOVERY_MAX_AGE_MS) {
      return null;
    }
    const submittedAt = Number(value.submittedAt);
    const retryAfterUntil = Number(value.retryAfterUntil);
    return {
      active: true,
      startedAt,
      returnUrl: safeReturnUrl(value.returnUrl),
      token: typeof value.token === 'string' ? value.token.slice(0, 100) : '',
      submittedAt: Number.isFinite(submittedAt) && submittedAt >= startedAt ? submittedAt : 0,
      attemptBlocked: value.attemptBlocked === true,
      retryAfterUntil: Number.isFinite(retryAfterUntil) && retryAfterUntil > 0 ? retryAfterUntil : 0,
    };
  }

  function loadLoginRecovery() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(LOGIN_RECOVERY_KEY) || 'null');
      const recovery = sanitiseLoginRecovery(parsed);
      if (!recovery) sessionStorage.removeItem(LOGIN_RECOVERY_KEY);
      return recovery;
    } catch {
      sessionStorage.removeItem(LOGIN_RECOVERY_KEY);
      return null;
    }
  }

  function setLoginWindowToken(token) {
    if (!token) return;
    try { window.name = `${LOGIN_WINDOW_PREFIX}${token}`; } catch {}
  }

  function getLoginWindowToken() {
    try {
      const name = String(window.name || '');
      return name.startsWith(LOGIN_WINDOW_PREFIX) ? name.slice(LOGIN_WINDOW_PREFIX.length) : '';
    } catch {
      return '';
    }
  }

  function clearLoginWindowToken(token = '') {
    try {
      const current = getLoginWindowToken();
      if (current && (!token || current === token)) window.name = '';
    } catch {}
  }

  function saveLoginHandoff(recovery) {
    if (!recovery || !recovery.token) return;
    // GM_setValue is the synchronous handoff. Unlike sessionStorage it is shared
    // by the same userscript across www/non-www redirects. window.name tags the
    // originating browser tab so another ordinary game tab does not take over.
    GM_setValue(LOGIN_HANDOFF_KEY, {
      token: recovery.token,
      startedAt: recovery.startedAt,
      returnUrl: recovery.returnUrl,
    });
    setLoginWindowToken(recovery.token);
  }

  function loadLoginHandoff() {
    const raw = GM_getValue(LOGIN_HANDOFF_KEY, null);
    if (!raw || typeof raw !== 'object') return null;
    const startedAt = Number(raw.startedAt);
    const token = typeof raw.token === 'string' ? raw.token : '';
    if (!token || !Number.isFinite(startedAt) || Date.now() - startedAt > LOGIN_HANDOFF_MAX_AGE_MS) {
      GM_setValue(LOGIN_HANDOFF_KEY, null);
      return null;
    }
    return {
      active: true,
      startedAt,
      returnUrl: safeReturnUrl(raw.returnUrl),
      token,
      submittedAt: 0,
      attemptBlocked: false,
      retryAfterUntil: 0,
    };
  }

  function savePerTabState() {
    if (typeof GM_getTab !== 'function' || typeof GM_saveTab !== 'function') return;
    // Persist only the identity of the bot tab. Login recovery itself must not be
    // stored in GM tab state: GM_saveTab is asynchronous, so an old active
    // recovery snapshot can survive the successful-login navigation and then be
    // restored on /home, resurrecting the redirect loop. Recovery handoff uses
    // the synchronous GM value + window.name/sessionStorage mechanisms instead.
    const snapshot = {
      botTab: state.botTab === true,
      savedAt: Date.now(),
    };
    try {
      GM_getTab((tab) => {
        const next = tab && typeof tab === 'object' ? tab : {};
        next[LOGIN_TAB_STATE_FIELD] = snapshot;
        GM_saveTab(next);
      });
    } catch {
      // The synchronous GM handoff + window.name remain the redirect-safe path.
    }
  }

  function restorePerTabState(done) {
    if (typeof GM_getTab !== 'function') {
      done();
      return;
    }
    try {
      GM_getTab((tab) => {
        try {
          const next = tab && typeof tab === 'object' ? tab : {};
          const saved = next[LOGIN_TAB_STATE_FIELD];
          if (saved && typeof saved === 'object' && typeof saved.botTab === 'boolean') {
            state.botTab = saved.botTab;
            sessionStorage.setItem(BOT_TAB_KEY, state.botTab ? 'true' : 'false');
          }

          // Clean up any recovery payload written by older builds. Never restore
          // it after navigation; only the bot-tab boolean belongs in per-tab state.
          next[LOGIN_TAB_STATE_FIELD] = { botTab: state.botTab === true, savedAt: Date.now() };
          if (typeof GM_saveTab === 'function') GM_saveTab(next);
        } finally {
          done();
        }
      });
    } catch {
      done();
    }
  }

  function saveLoginRecovery(returnUrl = currentRelativeUrl()) {
    const existing = loadLoginRecovery() || sanitiseLoginRecovery(state.loginRecovery);
    const recovery = existing || {
      active: true,
      startedAt: Date.now(),
      returnUrl: safeReturnUrl(returnUrl),
      token: makeLoginRecoveryToken(),
      submittedAt: 0,
      attemptBlocked: false,
      retryAfterUntil: 0,
    };
    if (!recovery.token) recovery.token = makeLoginRecoveryToken();
    sessionStorage.setItem(LOGIN_RECOVERY_KEY, JSON.stringify(recovery));
    state.loginRecovery = recovery;
    saveLoginHandoff(recovery); // synchronous before any redirect
    savePerTabState();
    return recovery;
  }

  function updateLoginRecovery(patch) {
    const recovery = sanitiseLoginRecovery({ ...(loadLoginRecovery() || state.loginRecovery || {}), ...patch });
    if (!recovery) return null;
    sessionStorage.setItem(LOGIN_RECOVERY_KEY, JSON.stringify(recovery));
    state.loginRecovery = recovery;
    savePerTabState();
    return recovery;
  }

  function adoptLoginHandoff() {
    if (!isLoginPage()) return null;
    const handoff = loadLoginHandoff();
    if (!handoff) return null;

    const windowToken = getLoginWindowToken();
    // Prefer the exact tab token. If a browser/redirect has stripped window.name,
    // fall back only while a very fresh bot-generated handoff exists and the bot
    // is globally enabled. This prevents a lost token from making recovery inert.
    const belongsHere = windowToken === handoff.token || state.botTab;
    if (!belongsHere) return null;

    state.loginRecovery = handoff;
    state.botTab = true;
    state.authRequired = true;
    sessionStorage.setItem(LOGIN_RECOVERY_KEY, JSON.stringify(handoff));
    sessionStorage.setItem(BOT_TAB_KEY, 'true');
    setLoginWindowToken(handoff.token);
    savePerTabState();
    state.currentAction = 'Login recovery armed — waiting for saved login';
    log('Login recovery: redirect handoff restored in this tab', 'info');
    render();
    return handoff;
  }

  function clearLoginRecovery() {
    const token = state.loginRecovery && state.loginRecovery.token;
    sessionStorage.removeItem(LOGIN_RECOVERY_KEY);
    const handoff = loadLoginHandoff();
    if (!handoff || !token || handoff.token === token) GM_setValue(LOGIN_HANDOFF_KEY, null);
    clearLoginWindowToken(token || '');
    state.loginRecovery = null;
    loginRecoveryLastProbeAt = 0;
    savePerTabState();
  }

  function loginElements() {
    const email = document.querySelector('#login-email');
    const password = document.querySelector('#login-password');
    const submit = document.querySelector('#login-button');
    const form = submit ? submit.closest('form') : null;
    return { email, password, submit, form };
  }

  function markLoginRecoverySubmitted() {
    const recovery = loadLoginRecovery() || state.loginRecovery || adoptLoginHandoff();
    if (!recovery) return;
    updateLoginRecovery({ submittedAt: Date.now(), attemptBlocked: true });
    state.authRequired = true;
    state.currentAction = 'Manual login submitted — waiting for session';
    loginRecoveryLastProbeAt = 0;
    render();
  }

  function prepareLoginFormForRecovery() {
    if (!isLoginPage()) return false;
    const { email, password, submit, form } = loginElements();
    if (!email || !password || !submit || !form) return false;
    if (form.dataset.ulSimpleLoginRecoveryBound !== 'true') {
      form.dataset.ulSimpleLoginRecoveryBound = 'true';
      form.addEventListener('submit', (event) => {
        // Prevent a manual click from racing the one saved-credential request.
        if (loginRecoverySubmitRunning) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        markLoginRecoverySubmitted();
      }, true);
    }
    return true;
  }

  async function submitSavedLoginOnce(recovery) {
    if (loginRecoverySubmitRunning || !recovery || recovery.attemptBlocked) return false;
    if (!state.botTab || !state.controller || !state.settings.enabled || state.restartProgress.active) return false;
    const retryAfterUntil = Number(recovery.retryAfterUntil) || 0;
    if (retryAfterUntil > Date.now()) {
      state.loginCredentialStatus = `Login retry blocked for ${Math.ceil((retryAfterUntil - Date.now()) / 1000)}s by server rate limit`;
      render();
      return false;
    }
    const credentials = loadLoginCredentials();
    state.loginCredentials = credentials;
    if (!credentials.autoLogin || !hasSavedLoginCredentials(credentials)) return false;

    loginRecoverySubmitRunning = true;
    updateLoginRecovery({ submittedAt: Date.now(), attemptBlocked: true });
    state.authRequired = true;
    state.currentAction = 'Auto-login — sending one saved login request';
    state.loginCredentialStatus = 'Auto-login in progress';
    log('Login recovery: sending one saved Tampermonkey login request', 'info');
    render();

    // Copy only into short-lived local variables for the request. They are never
    // written to logs, URLs, sessionStorage, localStorage or the bot settings.
    let emailValue = credentials.email;
    let passwordValue = credentials.password;
    const generation = state.generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    const stillCurrent = () => generation === state.generation && state.botTab && state.controller
      && state.settings.enabled && !state.restartProgress.active;
    try {
      const body = JSON.stringify({ email: emailValue, password: passwordValue });
      emailValue = '';
      passwordValue = '';

      const response = await fetch(new URL('/api/auth/login', location.origin), {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!stillCurrent()) return false;

      if (!response.ok) {
        const retryAfter = clampInteger(response.headers.get('retry-after'), 0, 3600, 0);
        const message = cleanMessage(data.error || data.message) || `HTTP ${response.status}`;
        const retryAfterUntil = response.status === 429 && retryAfter > 0
          ? Date.now() + retryAfter * 1000 + 50
          : 0;
        updateLoginRecovery({ submittedAt: 0, attemptBlocked: true, retryAfterUntil });
        state.currentAction = retryAfterUntil > 0
          ? `Auto-login rate-limited — retry after ${retryAfter}s`
          : `Auto-login failed — ${message}`;
        state.loginCredentialStatus = state.currentAction;
        log(`Login recovery: ${message}`, 'error');
        render();
        if (retryAfterUntil > 0) setTimeout(render, Math.max(100, retryAfterUntil - Date.now() + 100));
        ensureLoginRecoveryPage(state.loginRecovery || recovery);
        return false;
      }

      if (data.emailVerified === false) {
        clearLoginRecovery();
        state.authRequired = true;
        state.currentAction = 'Email verification required';
        state.loginCredentialStatus = 'Email verification required';
        render();
        location.assign('/verify-email');
        return true;
      }
      if (data.dead === true) {
        clearLoginRecovery();
        stopAutomationForDeath();
        if (location.pathname !== '/death') location.assign('/death');
        return true;
      }

      const returnUrl = safeReturnUrl(recovery.returnUrl);
      // Login succeeded while we are still physically on the public root page.
      // Guard the short navigation gap so the 500ms recovery watcher cannot see
      // "no recovery + / + enabled bot" and incorrectly arm a fresh login cycle.
      setLoginSuccessGuard();
      clearLoginRecovery();
      state.authRequired = false;
      state.currentAction = 'Login restored — resuming bot';
      state.loginCredentialStatus = 'Auto-login successful';
      log('Login restored — resuming saved bot modules', 'ok');
      if (isLoginPage() && currentRelativeUrl() !== returnUrl) {
        location.replace(returnUrl);
      } else {
        wakeAll();
        requestSchedulerWake();
      }
      return true;
    } catch (error) {
      if (!stillCurrent()) return false;
      updateLoginRecovery({ submittedAt: 0, attemptBlocked: true, retryAfterUntil: 0 });
      const message = error?.name === 'AbortError' ? 'Login timed out — check the game before retrying' : cleanMessage(error && error.message) || 'Could not connect to server';
      state.currentAction = `Auto-login request failed — ${message}`;
      state.loginCredentialStatus = state.currentAction;
      log(`Login recovery: ${message}`, 'error');
      render();
      ensureLoginRecoveryPage(state.loginRecovery || recovery);
      return false;
    } finally {
      clearTimeout(timeout);
      emailValue = '';
      passwordValue = '';
      loginRecoverySubmitRunning = false;
    }
  }

  function retrySavedLogin() {
    const recovery = loadLoginRecovery() || state.loginRecovery || (state.authRequired ? saveLoginRecovery('/home') : null);
    state.loginCredentials = loadLoginCredentials();
    if (!recovery || !hasSavedLoginCredentials() || !state.loginCredentials.autoLogin) return false;
    const retryAfterUntil = Number(recovery.retryAfterUntil) || 0;
    if (retryAfterUntil > Date.now()) {
      state.loginCredentialStatus = `Server rate limit — retry in ${Math.ceil((retryAfterUntil - Date.now()) / 1000)}s`;
      render();
      return false;
    }
    const next = updateLoginRecovery({ submittedAt: 0, attemptBlocked: false, retryAfterUntil: 0 }) || recovery;
    state.loginCredentialStatus = 'Retrying saved login';
    if (isLoginPage()) void submitSavedLoginOnce(next);
    else ensureLoginRecoveryPage(next);
    return true;
  }

  function ensureLoginRecoveryPage(recovery) {
    if (!recovery || isLoginPage()) return false;
    const now = Date.now();
    if (now - loginRecoveryLastRedirectAt < 1_500) return false;
    loginRecoveryLastRedirectAt = now;
    const target = new URL('/', location.origin).href;
    try {
      location.replace(target);
    } catch {
      try { window.location.href = target; } catch {}
    }
    return true;
  }

  function beginLoginRecovery() {
    if (state.authRequired && state.loginRecovery) {
      ensureLoginRecoveryPage(state.loginRecovery);
      return;
    }
    const returnUrl = isLoginPage() ? '/home' : currentRelativeUrl();
    const recovery = saveLoginRecovery(returnUrl);
    state.generation += 1;
    state.authRequired = true;
    state.loginCredentials = loadLoginCredentials();
    state.currentAction = state.loginCredentials.autoLogin && hasSavedLoginCredentials()
      ? 'Session expired — opening login for automatic recovery'
      : 'Session expired — login required';
    log(state.loginCredentials.autoLogin && hasSavedLoginCredentials()
      ? 'Session expired — opening login for one saved Tampermonkey login attempt'
      : 'Session expired — no enabled saved login; opening the normal login page', 'warn');
    requestSchedulerWake();
    if (!isLoginPage()) ensureLoginRecoveryPage(recovery);
    else {
      prepareLoginFormForRecovery();
      render();
    }
  }

  async function probeLoginRecovery(recovery) {
    if (!recovery || loginRecoveryProbeRunning || isLoginPage()) return;
    const submittedAt = Number(recovery.submittedAt) || 0;
    if (submittedAt <= 0) return;
    const now = Date.now();
    if (now - loginRecoveryLastProbeAt < LOGIN_RECOVERY_PROBE_MS) return;

    loginRecoveryLastProbeAt = now;
    loginRecoveryProbeRunning = true;
    const generation = state.generation;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(new URL('/api/auth/me', location.origin), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401 || !response.ok) return;
      const data = await response.json().catch(() => ({}));
      if (generation !== state.generation || !state.botTab || !state.settings.enabled || state.restartProgress.active) return;
      if (data.dead === true) {
        clearLoginRecovery();
        stopAutomationForDeath();
        if (location.pathname !== '/death') location.assign('/death');
        return;
      }
      if (data.emailVerified === false) {
        clearLoginRecovery();
        state.authRequired = true;
        state.currentAction = 'Email verification required before the bot can resume';
        render();
        if (location.pathname !== '/verify-email') location.assign('/verify-email');
        return;
      }
      const returnUrl = safeReturnUrl(recovery.returnUrl);
      setLoginSuccessGuard();
      clearLoginRecovery();
      state.authRequired = false;
      state.currentAction = 'Login restored — resuming bot';
      log('Login restored — resuming saved bot modules', 'ok');
      if (currentRelativeUrl() !== returnUrl) {
        location.replace(returnUrl);
      } else {
        wakeAll();
        requestSchedulerWake();
      }
    } catch {
      // Manual login recovery can be checked again on the next low-frequency tick.
    } finally {
      clearTimeout(timeout);
      loginRecoveryProbeRunning = false;
    }
  }

  function loginRecoveryTick() {
    // Restart owns authentication until the new character has been verified.
    if (state.restartProgress.active) return;
    if (!state.botTab && !adoptLoginHandoff()) return;
    if (!state.settings.enabled) return;
    if (location.pathname === '/verify-email') { state.authRequired = true; return; }
    // Once we have actually left the public login page, the post-login guard has
    // served its purpose. Remove it immediately rather than leaving it around.
    if (!isLoginPage()) {
      try { sessionStorage.removeItem(LOGIN_SUCCESS_GUARD_KEY); } catch {}
    }

    let recovery = loadLoginRecovery() || sanitiseLoginRecovery(state.loginRecovery);
    if (!recovery && isLoginPage()) recovery = adoptLoginHandoff();

    // A successful direct login clears recovery before navigation leaves '/'.
    // During that tiny gap, do NOT interpret the root page as a fresh logout.
    const loginSuccessPendingNavigation = !recovery && isLoginPage() && loginSuccessGuardActive();

    // If the actual bot tab is already sitting on the root login page (for example
    // after a browser/page reload with an expired session), arm recovery locally —
    // but only when we are not in the post-login navigation grace window above.
    if (!recovery && !loginSuccessPendingNavigation && isLoginPage() && state.settings.enabled && state.botTab && !state.stoppedForDeath) {
      recovery = saveLoginRecovery('/home');
      state.currentAction = 'Login recovery armed on existing bot login page';
      log('Login recovery armed on the current bot login page', 'info');
    }

    state.loginRecovery = recovery;
    state.loginCredentials = loadLoginCredentials();

    if (!recovery) {
      if (loginSuccessPendingNavigation) {
        state.authRequired = false;
        state.currentAction = 'Login restored — opening game';
        return;
      }
      if (state.authRequired) {
        state.authRequired = false;
        requestSchedulerWake();
        render();
      }
      return;
    }

    state.authRequired = true;
    const submittedAt = Number(recovery.submittedAt) || 0;

    if (isLoginPage()) {
      prepareLoginFormForRecovery();
      if (!recovery.attemptBlocked && submittedAt <= 0 && state.loginCredentials.autoLogin && hasSavedLoginCredentials()) {
        void submitSavedLoginOnce(recovery);
      }
      return;
    }

    if (submittedAt > 0) {
      void probeLoginRecovery(recovery);
      return;
    }

    state.currentAction = recovery.attemptBlocked
      ? 'Auto-login stopped — check Login tab or log in manually'
      : 'Login required — opening login';
    ensureLoginRecoveryPage(recovery);
  }

  function startLoginRecoveryWatcher() {
    if (loginRecoveryTimer !== null) return;
    loginRecoveryTick();
    loginRecoveryTimer = setInterval(loginRecoveryTick, 500);
  }

  function sanitiseSettings(value) {
    return {
      enabled: value.enabled === true,
      crimes: value.crimes !== false,
      gta: value.gta !== false,
      jailBust: value.jailBust === true,
      melt: value.melt === true,
      meltCommon: value.meltCommon !== false,
      meltRare: value.meltRare === true,
      meltTuners: value.meltTuners === true,
      repairBeforeMelt: value.repairBeforeMelt === true,
      drugs: value.drugs === true,
      autoRank: value.autoRank === true,
      discoverPlayers: value.discoverPlayers === true,
      searchPlayers: value.searchPlayers === true,
      beamTravelMode: ['auto', 'car', 'airport'].includes(value.beamTravelMode) ? value.beamTravelMode : DEFAULT_SETTINGS.beamTravelMode,
      drugRepairDamage: clampInteger(value.drugRepairDamage, 1, 99, DEFAULT_SETTINGS.drugRepairDamage),
    };
  }

  function normalisePlayerName(value) {
    return String(value || '').trim().toLocaleLowerCase();
  }

  function validPlayerName(value) {
    const name = String(value || '').trim();
    return name && name.length <= 30 && normalisePlayerName(name) !== 'unknown' ? name : '';
  }

  function sanitisePlayerNames(values) {
    const unique = new Map();
    for (const value of Array.isArray(values) ? values : []) {
      const name = validPlayerName(value);
      if (name && !unique.has(normalisePlayerName(name))) unique.set(normalisePlayerName(name), name);
    }
    return [...unique.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }

  function loadPlayerNames() {
    return sanitisePlayerNames(GM_getValue(PLAYER_LIST_KEY, []));
  }

  function sanitisePlayerActions(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    let beamAssigned = false;
    for (const [rawKey, rawAction] of Object.entries(value)) {
      const key = normalisePlayerName(rawKey);
      if (!key || !rawAction || typeof rawAction !== 'object') continue;
      const beam = rawAction.beam === true && !beamAssigned;
      if (beam) beamAssigned = true;
      if (rawAction.kill === true || beam) {
        result[key] = {
          kill: rawAction.kill === true,
          beam,
          beamMode: rawAction.beamMode === 'kill' ? 'kill' : 'one',
        };
      }
    }
    return result;
  }

  function loadPlayerActions() {
    return sanitisePlayerActions(GM_getValue(PLAYER_ACTIONS_KEY, {}));
  }

  function savePlayerActions() {
    state.playerActions = sanitisePlayerActions(state.playerActions);
    GM_setValue(PLAYER_ACTIONS_KEY, state.playerActions);
    state.playerSearchDueAt = 0;
    state.combatDueAt = 0;
    requestSchedulerWake();
    render();
  }

  function playerAction(name) {
    return state.playerActions[normalisePlayerName(name)] || { kill: false, beam: false, beamMode: 'one' };
  }

  function activeBeamName() {
    const entry = state.playerNames.find((name) => playerAction(name).beam);
    return entry || '';
  }

  function hasCombatActions() {
    return state.playerNames.some((name) => {
      const action = playerAction(name);
      return action.kill || action.beam;
    });
  }

  function setViewerUsername(value) {
    const name = validPlayerName(value);
    if (!name) return;
    state.viewerUsername = name;
    const ownKey = normalisePlayerName(name);
    const filtered = state.playerNames.filter((playerName) => normalisePlayerName(playerName) !== ownKey);
    if (filtered.length !== state.playerNames.length) {
      state.playerNames = filtered;
      GM_setValue(PLAYER_LIST_KEY, state.playerNames);
    }
  }

  function replacePlayerNames(values, message = '') {
    const ownKey = normalisePlayerName(state.viewerUsername);
    state.playerNames = sanitisePlayerNames(values).filter((name) => normalisePlayerName(name) !== ownKey);
    GM_setValue(PLAYER_LIST_KEY, state.playerNames);
    if (state.settings.searchPlayers) state.playerSearchDueAt = 0;
    state.playerDiscoveryStatus = `${state.playerNames.length.toLocaleString('en-GB')} player${state.playerNames.length === 1 ? '' : 's'} collected`;
    if (message) log(message, 'ok');
    render();
    requestSchedulerWake();
  }

  function removeNonLivingPlayer(value) {
    const name = validPlayerName(value);
    const key = normalisePlayerName(name);
    if (!key) return false;
    const before = state.playerNames.length;
    state.playerNames = state.playerNames.filter((playerName) => normalisePlayerName(playerName) !== key);
    delete state.playerActions[key];
    state.playerSearchBackoff.delete(key);
    if (state.activeBodyguard && (
      normalisePlayerName(state.activeBodyguard.name) === key ||
      normalisePlayerName(state.activeBodyguard.primary) === key
    )) {
      state.activeBodyguard = null;
    }
    if (state.playerNames.length === before) return false;
    GM_setValue(PLAYER_LIST_KEY, state.playerNames);
    GM_setValue(PLAYER_ACTIONS_KEY, state.playerActions);
    state.playerDiscoveryStatus = `${state.playerNames.length.toLocaleString('en-GB')} player${state.playerNames.length === 1 ? '' : 's'} collected`;
    state.playerSearchStatus = `Removed ${name}: no living player exists with that name`;
    state.combatStatus = `Removed ${name} from the player list`;
    log(`${name} removed from player list — game reports no living player with that exact name`, 'ok');
    return true;
  }

  function addDiscoveredPlayerNames(values, source) {
    if (!state.settings.discoverPlayers) return 0;
    const ownName = normalisePlayerName(state.viewerUsername);
    const existing = new Map(state.playerNames.map((name) => [normalisePlayerName(name), name]));
    let added = 0;
    for (const value of values) {
      const name = validPlayerName(value);
      const key = normalisePlayerName(name);
      if (!name || key === ownName || existing.has(key)) continue;
      existing.set(key, name);
      added += 1;
    }
    if (added > 0) {
      state.playerNames = [...existing.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
      GM_setValue(PLAYER_LIST_KEY, state.playerNames);
      state.playerSearchDueAt = 0;
      log(`Discovered ${added} new player${added === 1 ? '' : 's'} from ${source}`, 'ok');
    }
    state.playerDiscoveryStatus = `${state.playerNames.length.toLocaleString('en-GB')} player${state.playerNames.length === 1 ? '' : 's'} collected`;
    render();
    if (added > 0) requestSchedulerWake();
    return added;
  }

  function saveSettings(patch) {
    const wasStoppedForDeath = state.stoppedForDeath;
    if (patch.enabled === false) {
      state.generation += 1;
      clearLoginRecovery();
      cancelRestart();
    }
    if (patch.enabled === true && wasStoppedForDeath && state.restart.enabled && armRestart()) return;
    state.settings = sanitiseSettings({ ...state.settings, ...patch });
    GM_setValue(SETTINGS_KEY, state.settings);
    if (patch.enabled === true) {
      prepareRuntimeForStart(wasStoppedForDeath);
    }
    render();
    requestSchedulerWake();
  }

  function prepareRuntimeForStart(afterDeath = false) {
    state.stoppedForDeath = false;
    GM_setValue(DEATH_STOP_KEY, false);
    state.authRequired = false;
    if (afterDeath) {
      state.inJail = false;
      state.jailMarkedAt = 0;
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
      state.autoRankControls = { crimes: false, gta: false, melt: false };
      state.autoRankMeltCarNames = [];
      state.autoRankMeltNotice = '';
      state.autoRankStatus = state.settings.autoRank ? 'Checking Auto Rank for this character' : 'Auto-renew disabled';
      state.drugStatus = state.settings.drugs ? 'Checking drug run for this character' : 'Drug run disabled';
      state.playerSearchStatus = state.settings.searchPlayers ? 'Checking searches for this character' : 'Player searching disabled';
      state.combatStatus = 'Kill and Beam idle';
      state.killData = null;
      state.killDataLoadedAt = 0;
      state.activeBodyguard = null;
      state.beamTravelRefreshPending = false;
      state.searchData = null;
      state.killDataRevision += 1;
    }
    if (state.settings.drugs) state.drugContextLoaded = false;
    wakeAll();
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }

  function cleanMessage(value) {
    const box = document.createElement('div');
    box.innerHTML = String(value || '');
    return (box.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function log(message, level = 'info') {
    const text = cleanMessage(message) || String(message);
    state.lastAction = text;
    state.logs.unshift({ at: Date.now(), text, level });
    state.logs = state.logs.slice(0, 6);
    render();
  }

  function setTunerMeltNotice(message) {
    if (message === state.tunerMeltNotice) return;
    state.tunerMeltNotice = message;
    if (message) log(message, 'warn');
  }

  function wakeAll() {
    state.crimesDueAt = 0;
    state.gtaDueAt = 0;
    state.jailBustDueAt = 0;
    state.meltDueAt = 0;
    state.drugsDueAt = 0;
    state.autoRankDueAt = 0;
    state.playerDiscoveryDueAt = 0;
    state.gangDiscoveryDueAt = 0;
    state.playerSearchDueAt = 0;
    state.combatDueAt = 0;
    state.jailDueAt = 0;
    requestSchedulerWake();
  }

  function markJailed() {
    state.inJail = true;
    state.jailMarkedAt = Date.now();
    state.jailBustCandidate = null;
    state.jailDueAt = 0;
  }

  function stopAutomationForDeath() {
    const shouldRestart = state.restart.enabled && state.botTab && (state.settings.enabled || state.restartProgress.active);
    state.generation += 1;
    state.stoppedForDeath = true;
    state.inJail = false;
    state.authRequired = false;
    state.settings = sanitiseSettings({ ...state.settings, enabled: false });
    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
    state.autoRankControls = { crimes: false, gta: false, melt: false };
    state.autoRankMeltCarNames = [];
    state.autoRankMeltNotice = '';
    state.autoRankDueAt = 0;
    state.autoRankStatus = state.settings.autoRank
      ? 'Stopped after death · restart character, then press Restart bot'
      : 'Auto-renew disabled';
    state.drugContextLoaded = false;
    state.drugStatus = state.settings.drugs ? 'Stopped after death' : 'Drug run disabled';
    state.playerSearchStatus = state.settings.searchPlayers ? 'Stopped after death' : 'Player searching disabled';
    state.combatStatus = 'Stopped after death';
    state.killData = null;
    state.killDataLoadedAt = 0;
    state.activeBodyguard = null;
    state.beamTravelRefreshPending = false;
    state.searchData = null;
    state.killDataRevision += 1;
    GM_setValue(DEATH_STOP_KEY, true);
    GM_setValue(SETTINGS_KEY, state.settings);
    log('Character is dead — automation stopped; saved modules will be rechecked after Restart bot', 'error');
    if (shouldRestart && !state.restartProgress.active) armRestart();
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
      requestLimiter.timer = setTimeout(
        pumpRequestQueue,
        Math.max(1, state.globalRateLimitedUntil - now),
      );
      return;
    }
    refillRequestTokens(now);

    // Discard stopped/disabled work BEFORE it consumes tokens or is sent.
    requestLimiter.queue = requestLimiter.queue.filter((entry) => {
      try { if (entry.validate) entry.validate(); return true; }
      catch (error) { entry.reject(error); return false; }
    });
    while (requestLimiter.tokens >= 1 && requestLimiter.queue.length > 0) {
      let selectedIndex = -1;
      for (let index = 0; index < requestLimiter.queue.length; index += 1) {
        const candidate = requestLimiter.queue[index];
        if (requestRateWait(candidate.rateKey, now) > 0) continue;
        const selected = requestLimiter.queue[selectedIndex];
        // Age waiting work to prevent endless rapid scans starving discovery
        // or ordinary searches. Ready actions normally take the first slot.
        const score = (entry) => Math.max(0, entry.priority - Math.floor((now - entry.queuedAt) / 250));
        if (
          !selected || score(candidate) < score(selected) ||
          (score(candidate) === score(selected) && candidate.sequence < selected.sequence)
        ) {
          selectedIndex = index;
        }
      }
      if (selectedIndex < 0) break;
      const [next] = requestLimiter.queue.splice(selectedIndex, 1);
      requestLimiter.tokens -= 1;
      const bucket = requestBucket(next.rateKey);
      if (bucket && ACTION_RATE_LIMITS[next.rateKey]) bucket.history.push(now);
      next.resolve();
    }

    if (requestLimiter.queue.length > 0 && requestLimiter.timer === null) {
      const missing = Math.max(0, 1 - requestLimiter.tokens);
      const tokenWait = Math.ceil(missing * 1000 / REQUEST_REFILL_PER_SECOND);
      const featureWait = Math.min(...requestLimiter.queue.map((entry) => requestRateWait(entry.rateKey, now)));
      const waitMs = Math.max(1, tokenWait, featureWait);
      requestLimiter.timer = setTimeout(pumpRequestQueue, waitMs);
    }
  }

  function requestRateKey(path, method = 'GET') {
    const route = path.split('?')[0];
    if (method !== 'POST') return `GET ${route}`;
    if (route === '/api/kill/shoot') return 'shoot';
    if (route === '/api/kill/prepare') return 'prepare';
    if (route === '/api/kill/search') return 'search';
    if (/^\/api\/crimes\//.test(route)) return 'crime';
    if (/^\/api\/gta\//.test(route)) return 'gta';
    if (route === '/api/qt/accept' || route === '/api/qt/perks/buy') return 'quicktrade';
    if (route === '/api/retrieve/all') return 'retrieve';
    return `POST ${route.replace(/\/bust\/[^/]+$/, '/bust')}`;
  }

  function requestBucket(key) {
    if (!key) return null;
    if (!requestLimiter.buckets.has(key)) requestLimiter.buckets.set(key, { history: [], blockedUntil: 0 });
    return requestLimiter.buckets.get(key);
  }

  function requestRateWait(key, now = Date.now()) {
    const bucket = requestBucket(key);
    if (!bucket) return 0;
    const config = ACTION_RATE_LIMITS[key];
    if (config) bucket.history = bucket.history.filter((at) => at + config.windowMs + 50 > now);
    const windowWait = config && bucket.history.length >= config.limit
      ? bucket.history[bucket.history.length - config.limit] + config.windowMs + 50 - now : 0;
    return Math.max(0, bucket.blockedUntil - now, windowWait);
  }

  function reserveRequestSlot(priority = REQUEST_PRIORITY.NORMAL, rateKey = '', validate = null) {
    return new Promise((resolve, reject) => {
      requestLimiter.queue.push({
        priority: Number.isFinite(priority) ? priority : REQUEST_PRIORITY.NORMAL,
        sequence: requestLimiter.sequence++,
        queuedAt: Date.now(), rateKey, validate, reject,
        resolve,
      });
      pumpRequestQueue();
    });
  }

  async function api(path, options = {}) {
    const generation = state.generation;
    const method = options.method || 'GET';
    const priority = options.priority ?? (
      method === 'POST' ? REQUEST_PRIORITY.ACTION : REQUEST_PRIORITY.NORMAL
    );
    const rateKey = requestRateKey(path, method);
    const validate = () => {
      const allowed = options.restartFlow === true
        ? restartAllowed() && ['/api/auth/me', '/api/auth/login', '/api/death/status', '/api/death/restart', '/api/retrieve', '/api/retrieve/all'].includes(path)
        : actionAllowed() && !state.authRequired;
      if (!allowed || generation !== state.generation) throw new ActionCancelledError('Automation is stopped');
      if (options.validate) options.validate();
    };
    await reserveRequestSlot(priority, rateKey, validate);
    validate();
    const controller = new AbortController();
    const timeoutMs = clampInteger(options.timeoutMs, 1_000, 130_000, 15_000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    let body;
    state.apiInFlight += 1;
    try {
      if (options.onDispatch) options.onDispatch();
      response = await fetch(new URL(path, location.origin), {
        method,
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const contentType = response.headers.get('content-type') || '';
      body = contentType.includes('application/json')
        ? await response.json()
        : { html: await response.text() };
      if (generation !== state.generation) throw new ActionCancelledError('Previous bot run ended');
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new ApiError(408, `Request timed out: ${path}`, {});
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      state.apiInFlight -= 1;
    }

    if (!response.ok) {
      const message = cleanMessage(body.html || body.error || body.message) || `${response.status} ${response.statusText}`;
      const retryAfter = Math.max(
        clampInteger(response.headers.get('retry-after'), 0, 3600, 0),
        clampInteger(body.retryAfterSec, 0, 3600, 0),
      );
      if (response.status === 429 && body.pageBlocked === true && retryAfter > 0) {
        state.globalRateLimitedUntil = Math.max(
          state.globalRateLimitedUntil,
          Date.now() + retryAfter * 1000 + 50,
        );
      } else if (response.status === 429) {
        const bucket = requestBucket(rateKey);
        bucket.blockedUntil = Math.max(bucket.blockedUntil, Date.now() + (retryAfter > 0 ? retryAfter * 1000 + 50 : 250));
      }
      throw new ApiError(response.status, message, body, retryAfter);
    }
    state.authRequired = false;
    return body;
  }

  function actionAllowed() {
    return state.botTab && state.controller && state.settings.enabled && !state.stoppedForDeath && !state.restartProgress.active;
  }

  async function queueAction(path, label, options = {}) {
    const generation = state.generation;
    if (!actionAllowed()) throw new ActionCancelledError('Automation is stopped');
    if (state.inJail && options.allowInJail !== true) throw new ActionCancelledError('Player is in jail');

    const validate = () => {
      if (!actionAllowed() || generation !== state.generation) {
        throw new ActionCancelledError('Automation is stopped');
      }
      if (state.inJail && options.allowInJail !== true) {
        throw new ActionCancelledError('Player is in jail');
      }
      if (options.validate) options.validate();
      const enabled = path.startsWith('/api/crimes/') ? state.settings.crimes
        : path === '/api/gta/steal' ? state.settings.gta
        : path.startsWith('/api/melt/') ? state.settings.melt
        : path.startsWith('/api/jail/bust/') ? state.settings.jailBust
        : path.startsWith('/api/auto-rank/') ? state.settings.autoRank
        : path === '/api/drugs/buy' || path === '/api/drugs/sell' ? state.settings.drugs && !activeBeamName()
        : true;
      if (!enabled) throw new ActionCancelledError('Feature switched off');
    };
    const execute = async () => {
      validate();
      if (options.beforeSend) { await options.beforeSend(); validate(); }

      state.currentAction = label;
      render();

      const result = await api(path, {
        method: 'POST',
        body: options.body,
        timeoutMs: options.timeoutMs,
        priority: options.priority,
        validate,
        onDispatch: options.onDispatch,
      });
      const message = cleanMessage(result.html) || label;
      log(message, result.success === false ? 'warn' : 'ok');
      if (result.success === false || /sent to (?:the )?jail/i.test(message)) {
        markJailed();
      }
      return result;
    };

    // These server-transactional actions don't need to wait for a slow shot
    // or a purchase. Spending, repairs, travel and shooting remain ordered.
    const lane = path.startsWith('/api/crimes/') ? 'crime'
      : path === '/api/gta/steal' ? 'gta'
      : path.startsWith('/api/jail/bust/') ? 'jail'
      : path === '/api/kill/search' ? 'search'
      : path.startsWith('/api/auto-rank/') ? 'auto-rank'
      : 'economy';
    const tail = state.actionTails.get(lane) || Promise.resolve();
    const queued = tail.then(execute, execute);
    state.actionTails.set(lane, queued.catch(() => undefined));
    return queued;
  }

  function nextTimeFromSeconds(seconds, fallbackSeconds) {
    const parsed = Number(seconds);
    const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackSeconds;
    return Date.now() + safe * 1000 + 50;
  }

  function nextCrimeTimeFromCooldown(seconds, fallbackSeconds = 5) {
    const parsed = Number(seconds);
    const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackSeconds;
    return Date.now() + safe * 1000 + 5;
  }

  function nextCrimePollFromRoundedSeconds(seconds, checkedAt = Date.now()) {
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
    if (parsed <= 1) return Date.now() + 100;
    return checkedAt + (parsed - 1) * 1000 + 100;
  }

  async function runCrimes() {
    state.crimesRunning = true;
    state.currentAction = 'Checking crimes';
    render();
    try {
      const data = await api('/api/crimes', { priority: REQUEST_PRIORITY.ACTION });
      const crimes = Array.isArray(data.crimes) ? data.crimes : [];
      const checkedAt = Date.now();
      const nextTimes = [];
      let rankedUp = false;

      for (const crime of crimes) {
        if (crime.locked) continue;
        if (!crime.available) {
          nextTimes.push(nextCrimePollFromRoundedSeconds(crime.secondsRemaining, checkedAt));
          continue;
        }

        try {
          const result = await queueAction(
            `/api/crimes/${encodeURIComponent(crime.id)}/commit`,
            `Committing ${crime.name}`
          );
          discoverPlayerStealVictim(crime, result);
          nextTimes.push(nextCrimeTimeFromCooldown(result.cooldownSeconds));
          rankedUp = rankedUp || result.rankedUp === true;
          if (result.success === false || state.inJail) break;
        } catch (error) {
          if (error instanceof ActionCancelledError) break;
          throw error;
        }
      }

      state.crimesDueAt = rankedUp
        ? Date.now()
        : nextTimes.length
          ? Math.min(...nextTimes)
          : Date.now() + 10_000;
    } catch (error) {
      handleTaskError('Crimes', error);
      state.crimesDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.crimesRunning = false;
      refreshIdleStatus();
    }
  }

  async function runGta() {
    state.gtaRunning = true;
    state.currentAction = 'Checking GTA';
    render();
    try {
      const data = await api('/api/gta', { priority: REQUEST_PRIORITY.ACTION });
      if (data.available && !data.locked) {
        const result = await queueAction('/api/gta/steal', 'Committing GTA');
        state.gtaDueAt = nextTimeFromSeconds(result.cooldownSeconds, 5);
        if (result.success === true && state.settings.melt) state.meltDueAt = 0;
      } else {
        state.gtaDueAt = data.locked
          ? Date.now() + 30_000
          : nextTimeFromSeconds(data.secondsRemaining, 5);
      }
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) handleTaskError('GTA', error);
      state.gtaDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.gtaRunning = false;
      refreshIdleStatus();
    }
  }

  function canMeltCar(car) {
    if (!car || typeof car.name !== 'string') return false;
    if (car.protectedFromMelt === true) return false;
    if (
      state.settings.drugs &&
      state.drugFavouriteCarId !== null &&
      Number(car.publicId) === state.drugFavouriteCarId
    ) return false;
    // A standard Tuner is the sole opt-in exception to the high-value-car
    // block. API-protected and favourite drug-run cars remain protected above.
    if (car.name === TOGGLEABLE_TUNER_NAME) return state.settings.meltTuners;
    if (NEVER_MELT_CAR_NAMES.has(car.name) || car.rarity === 'veryRare') return false;
    if (car.rarity === 'normal') return state.settings.meltCommon;
    if (car.rarity === 'rare') return state.settings.meltRare;
    return false;
  }

  async function runMelt() {
    state.meltRunning = true;
    state.currentAction = 'Checking cars to melt';
    render();
    try {
      const overview = await api('/api/melt?page=1', { priority: REQUEST_PRIORITY.ACTION });
      if (overview.autoRank && overview.autoRank.committingMelt === true) {
        state.meltDueAt = Date.now() + 5_000;
        return;
      }
      if (!overview.available) {
        state.meltDueAt = nextTimeFromSeconds(overview.secondsRemaining, 5);
        return;
      }

      const groups = Array.isArray(overview.groups) ? overview.groups : [];
      const tunerGroupAvailable = state.settings.meltTuners && groups.some(
        (group) => group && group.name === TOGGLEABLE_TUNER_NAME && Number(group.count) > 0,
      );
      let car = null;

      if (state.settings.meltTuners && !tunerGroupAvailable) {
        setTunerMeltNotice('Tuners enabled, but the melt API reports no unprotected Tuner outside Quicktrade');
      } else if (!state.settings.meltTuners) {
        setTunerMeltNotice('');
      }

      // The unfiltered melt page is paginated. Looking only at that page first
      // can leave Tuners untouched forever while other eligible cars keep
      // occupying it, so an enabled Tuner filter gets an explicit first lookup.
      if (tunerGroupAvailable) {
        const tunerPage = await api(`/api/melt?page=1&filter=${encodeURIComponent(TOGGLEABLE_TUNER_NAME)}`, { priority: REQUEST_PRIORITY.ACTION });
        if (!tunerPage.available) {
          state.meltDueAt = nextTimeFromSeconds(tunerPage.secondsRemaining, 5);
          return;
        }
        const tunerCars = (Array.isArray(tunerPage.cars) ? tunerPage.cars : [])
          .filter((candidate) => candidate && candidate.name === TOGGLEABLE_TUNER_NAME);
        car = tunerCars.find(canMeltCar) || null;
        if (car) {
          setTunerMeltNotice('');
        } else if (tunerCars.some((candidate) => (
          state.settings.drugs &&
          state.drugFavouriteCarId !== null &&
          Number(candidate.publicId) === state.drugFavouriteCarId
        ))) {
          setTunerMeltNotice('Tuners enabled, but the available Tuner is the active drug-run favourite and remains protected');
        } else {
          setTunerMeltNotice('Tuners enabled, but the filtered melt API returned no safely eligible Tuner');
        }
      }

      const eligibleGroups = groups.filter((group) => Number(group.count) > 0 && canMeltCar(group));
      if (!car && eligibleGroups.length === 0) {
        state.meltDueAt = Date.now() + 30_000;
        return;
      }

      const eligibleNames = new Set(eligibleGroups.map((group) => group.name));
      if (!car) {
        car = (Array.isArray(overview.cars) ? overview.cars : [])
          .find((candidate) => eligibleNames.has(candidate.name) && canMeltCar(candidate)) || null;
      }

      if (!car) {
        for (const eligibleGroup of eligibleGroups) {
          const filtered = await api(`/api/melt?page=1&filter=${encodeURIComponent(eligibleGroup.name)}`, { priority: REQUEST_PRIORITY.ACTION });
          if (!filtered.available) {
            state.meltDueAt = nextTimeFromSeconds(filtered.secondsRemaining, 5);
            return;
          }
          car = (Array.isArray(filtered.cars) ? filtered.cars : []).find(canMeltCar);
          if (car) break;
        }
      }

      const publicId = Number(car && car.publicId);
      if (!car || !Number.isSafeInteger(publicId) || publicId <= 0 || !canMeltCar(car)) {
        log('Melt: no safely eligible car was returned', 'warn');
        state.meltDueAt = Date.now() + 30_000;
        return;
      }

      if (state.settings.repairBeforeMelt && Number(car.damage) > 0) {
        await queueAction(
          `/api/melt/cars/${encodeURIComponent(String(publicId))}/repair`,
          `Repairing ${car.displayName || car.name} before melting`,
          { validate: () => {
            if (!state.settings.repairBeforeMelt || !canMeltCar(car)) throw new ActionCancelledError('Melt repair selection changed');
          } },
        );
      }

      const result = await queueAction(
        `/api/melt/cars/${encodeURIComponent(String(publicId))}/melt`,
        `Melting ${car.displayName || car.name}`,
        { validate: () => {
          if (!canMeltCar(car)) throw new ActionCancelledError('Melt selection changed');
        } },
      );
      state.meltDueAt = nextTimeFromSeconds(result.cooldownSeconds, 5);
      if (hasCombatActions()) state.combatDueAt = 0;
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) handleTaskError('Melt', error);
      state.meltDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.meltRunning = false;
      refreshIdleStatus();
    }
  }

  function normaliseDrugLabel(value) {
    const label = String(value || '').trim().toLocaleLowerCase();
    if (label === 'united states' || label === 'united states of america') return 'usa';
    return label;
  }

  function drugLotId(lot) {
    return normaliseDrugLabel(lot && (lot.drugId || lot.name));
  }

  function findDrugLocation(data, wantedLocation) {
    const wanted = normaliseDrugLabel(wantedLocation);
    return (Array.isArray(data.locations) ? data.locations : [])
      .find((location) => normaliseDrugLabel(location && location.name) === wanted) || null;
  }

  function nextDrugDriveCheck(data) {
    const seconds = Number(data.driveSecondsRemaining);
    return Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 + 50 : 500);
  }

  async function repairDrugCarIfRequired(favouriteCar) {
    if (!favouriteCar || Number(favouriteCar.damage || 0) < state.settings.drugRepairDamage) return false;
    const publicId = Number(favouriteCar.publicId);
    if (!Number.isSafeInteger(publicId) || publicId <= 0) {
      state.drugStatus = `Drug car needs repair, but its car ID is unavailable`;
      state.drugsDueAt = Date.now() + 10_000;
      return true;
    }
    await queueAction(
      `/api/gta/cars/${encodeURIComponent(String(publicId))}/repair`,
      `Repairing drug car ${favouriteCar.name || ''}`.trim(),
      { validate: validateDrugRun },
    );
    state.drugsDueAt = Date.now();
    return true;
  }

  function validateDrugRun() {
    if (!state.settings.drugs || activeBeamName()) throw new ActionCancelledError('Drug travel paused or disabled');
  }

  async function runDrugs() {
    state.drugsRunning = true;
    state.currentAction = 'Checking drug run';
    render();
    try {
      const data = await api('/api/drugs?page=1', { priority: REQUEST_PRIORITY.ACTION });
      const location = normaliseDrugLabel(data.location);
      const displayLocation = String(data.location || 'Unknown');
      const capacity = Math.max(0, Number(data.capacity ?? data.rankCapacity) || 0);
      const unitsHeld = Math.max(0, Number(data.unitsHeld) || 0);
      const inventory = Array.isArray(data.inventory) ? data.inventory.filter((lot) => lot && lot.id) : [];
      const favouriteCar = data.favouriteCar && typeof data.favouriteCar === 'object' ? data.favouriteCar : null;
      const favouriteCarId = Number(favouriteCar && favouriteCar.publicId);

      state.drugContextLoaded = true;
      state.drugFavouriteCarId = Number.isSafeInteger(favouriteCarId) && favouriteCarId > 0 ? favouriteCarId : null;
      if (activeBeamName()) return; // Context-only check while Beam owns travel.
      state.drugStatus = `${displayLocation}: ${unitsHeld.toLocaleString('en-GB')}/${capacity.toLocaleString('en-GB')} drug units${
        favouriteCar ? ` · ${favouriteCar.name} ${Number(favouriteCar.damage || 0)}% damage` : ' · no favourite car'
      }`;

      // Sell only lots whose intended profitable destination is the current city.
      const lotsToSell = inventory.filter((lot) => DRUG_SELL_DESTINATIONS[drugLotId(lot)] === location);
      if (lotsToSell.length > 0) {
        await queueAction('/api/drugs/sell', `Selling drugs in ${displayLocation}`, {
          body: { ids: lotsToSell.map((lot) => String(lot.id)) },
        });
        state.drugsDueAt = Date.now();
        return;
      }

      // Existing stock always takes priority. Carry it to its best sell city
      // rather than liquidating it at a loss or mixing it with the next load.
      if (inventory.length > 0 || unitsHeld > 0) {
        const carriedLot = inventory.find((lot) => DRUG_SELL_DESTINATIONS[drugLotId(lot)]);
        const destinationName = carriedLot ? DRUG_SELL_DESTINATIONS[drugLotId(carriedLot)] : null;
        if (!destinationName) {
          state.drugStatus += ' · unsupported held drug';
          state.drugsDueAt = Date.now() + 15_000;
          return;
        }
        if (!favouriteCar) {
          state.drugStatus += ' · favourite a car to continue';
          state.drugsDueAt = Date.now() + 10_000;
          return;
        }
        if (await repairDrugCarIfRequired(favouriteCar)) return;
        if (data.driveAvailable !== true) {
          state.drugsDueAt = nextDrugDriveCheck(data);
          return;
        }
        const destination = findDrugLocation(data, destinationName);
        if (!destination) {
          state.drugStatus += ` · ${destinationName} destination unavailable`;
          state.drugsDueAt = Date.now() + 10_000;
          return;
        }
        await queueAction('/api/drugs/drive', `Driving to ${destination.name} with drugs`, {
          body: { location: Number(destination.id) },
          validate: validateDrugRun,
        });
        state.drugsDueAt = Date.now();
        return;
      }

      const routeStep = DRUG_ROUTE[location];
      if (!favouriteCar) {
        state.drugStatus += ' · favourite a car to begin';
        state.drugsDueAt = Date.now() + 10_000;
        return;
      }
      if (await repairDrugCarIfRequired(favouriteCar)) return;

      // England/Mexico are not part of the optimal loop. Enter it at Russia.
      if (!routeStep) {
        if (data.driveAvailable !== true) {
          state.drugsDueAt = nextDrugDriveCheck(data);
          return;
        }
        const russia = findDrugLocation(data, 'russia');
        if (!russia) {
          state.drugStatus += ' · Russia destination unavailable';
          state.drugsDueAt = Date.now() + 10_000;
          return;
        }
        await queueAction('/api/drugs/drive', `Driving to ${russia.name} to start optimal route`, {
          body: { location: Number(russia.id) },
          validate: validateDrugRun,
        });
        state.drugsDueAt = Date.now();
        return;
      }

      const market = Array.isArray(data.market) ? data.market : [];
      const buyDrug = market.find((drug) => normaliseDrugLabel(drug && (drug.id || drug.name)) === routeStep.buy);
      if (!buyDrug) {
        state.drugStatus += ` · ${routeStep.buy} unavailable`;
        state.drugsDueAt = Date.now() + 10_000;
        return;
      }
      const remainingCapacity = Math.max(0, capacity - unitsHeld);
      const price = bigintOrZero(buyDrug.price);
      const cash = bigintOrZero(data.money);
      const affordable = price > 0n ? Number(cash / price) : 0;
      const amount = Math.max(0, Math.min(remainingCapacity, Number.isSafeInteger(affordable) ? affordable : remainingCapacity));
      if (amount <= 0) {
        state.drugStatus += remainingCapacity <= 0 ? ' · capacity full' : ' · insufficient cash';
        state.drugsDueAt = Date.now() + 15_000;
        return;
      }
      await queueAction('/api/drugs/buy', `Buying ${amount.toLocaleString('en-GB')} ${buyDrug.name}`, {
        body: { drug: String(buyDrug.id), amount },
      });
      state.drugsDueAt = Date.now();
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) handleTaskError('Drugs', error);
      state.drugsDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.drugsRunning = false;
      refreshIdleStatus();
    }
  }

  function bigintOrZero(value) {
    try {
      return BigInt(String(value ?? '0'));
    } catch {
      return 0n;
    }
  }

  function autoRankEndTime(data, paused = false) {
    const absolute = Date.parse(paused ? data.sessionPausedEndsAt : data.sessionEndsAt);
    if (Number.isFinite(absolute) && absolute > Date.now()) return absolute;
    const seconds = Number(data.sessionSecondsRemaining);
    return Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0;
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

  function applyAutoRankState(data) {
    const tier = Number(data && data.tier) || 0;
    const serverSettings = data && data.settings && typeof data.settings === 'object' ? data.settings : {};
    state.autoRankControls = {
      crimes: serverSettings.autoCrime === true,
      gta: serverSettings.autoGta === true,
      melt: serverSettings.autoMelt === true,
    };
    state.autoRankMeltCarNames = Array.isArray(serverSettings.autoMeltCarNames)
      ? serverSettings.autoMeltCarNames.filter((name) => typeof name === 'string')
      : [];
    if (tier < 1) {
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
      state.autoRankControls = { crimes: false, gta: false, melt: false };
      state.autoRankMeltCarNames = [];
      state.autoRankMeltNotice = '';
      state.autoRankStatus = 'Disabled · Auto Rank Tier 1 is not unlocked';
      state.autoRankDueAt = 0;
      if (state.settings.autoRank) {
        state.settings = sanitiseSettings({ ...state.settings, autoRank: false });
        GM_setValue(SETTINGS_KEY, state.settings);
        log('Auto-renew rank switched off — this character does not have Auto Rank Tier 1', 'warn');
      }
      return 'locked';
    }

    if (data.sessionActive === true) {
      const endsAt = autoRankEndTime(data, false);
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      state.autoRankActive = true;
      state.autoRankEndsAt = endsAt;
      const controlled = [
        state.autoRankControls.crimes ? 'crimes' : '',
        state.autoRankControls.gta ? 'GTA' : '',
        state.autoRankControls.melt ? 'melt' : '',
      ].filter(Boolean);
      state.autoRankStatus = `Active · ${compactDuration(remaining)} remaining${controlled.length ? ` · server: ${controlled.join(', ')}` : ' · bot actions remain local'}`;
      const meltNotice = state.settings.melt && state.settings.meltTuners && state.autoRankControls.melt
        ? state.autoRankMeltCarNames.includes(TOGGLEABLE_TUNER_NAME)
          ? 'Auto Rank controls melting: only unprotected, non-favourite, non-profile Tuners selected in Auto Melt are eligible'
          : 'Tuner melting is blocked: Auto Rank controls melting but its Auto Melt car list does not include Tuner'
        : '';
      if (meltNotice && meltNotice !== state.autoRankMeltNotice) log(meltNotice, 'warn');
      state.autoRankMeltNotice = meltNotice;
      // Use the server-provided end time as the wake-up clock. No constant
      // polling is needed while server-side Auto Rank is already running.
      state.autoRankDueAt = endsAt > Date.now() ? endsAt + 100 : Date.now() + 500;
      return 'active';
    }

    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
    state.autoRankMeltNotice = '';
    if (data.sessionPaused === true) {
      const pausedEndsAt = autoRankEndTime(data, true);
      const remaining = Math.max(0, Math.ceil((pausedEndsAt - Date.now()) / 1000));
      state.autoRankStatus = `Paused · ${compactDuration(remaining)} remaining`;
      // Respect a deliberate Stop Ranking click. Only start a new session once
      // the paused activity itself has expired.
      state.autoRankDueAt = pausedEndsAt > Date.now() ? pausedEndsAt + 100 : Date.now() + 500;
      return 'paused';
    }

    state.autoRankStatus = 'Activity expired · starting ranking';
    state.autoRankDueAt = Date.now();
    return 'inactive';
  }

  async function runAutoRank() {
    if (state.autoRankRunning) return;
    state.autoRankRunning = true;
    state.currentAction = 'Checking Auto Rank activity';
    render();
    try {
      const status = await api('/api/auto-rank', { priority: REQUEST_PRIORITY.ACTION });
      const sessionState = applyAutoRankState(status);
      if (sessionState !== 'inactive') return;

      const started = await queueAction('/api/auto-rank/session/start', 'Starting Auto Rank', {
        allowInJail: true,
      });
      applyAutoRankState(started);
      if (started.sessionActive !== true) {
        state.autoRankDueAt = Date.now() + 2_000;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && /already active/i.test(error.message)) {
        state.autoRankDueAt = Date.now() + 500;
      } else if (!(error instanceof ActionCancelledError)) {
        handleTaskError('Auto Rank', error);
        state.autoRankDueAt = Date.now() + errorBackoff(error);
      }
    } finally {
      state.autoRankRunning = false;
      refreshIdleStatus();
    }
  }

  function autoRankIsActiveNow() {
    if (!state.autoRankActive) return false;
    if (state.autoRankEndsAt > Date.now()) return true;
    state.autoRankActive = false;
    return false;
  }

  async function runPlayerDiscovery() {
    if (state.playerDiscoveryRunning) return;
    state.playerDiscoveryRunning = true;
    state.currentAction = 'Checking visible online players';
    render();
    try {
      const data = await api('/api/pages/online', { priority: REQUEST_PRIORITY.BACKGROUND });
      setViewerUsername(data.viewerUsername);
      const visibleNames = (Array.isArray(data.players) ? data.players : [])
        .filter((player) => player && player.usernameHidden !== true)
        .map((player) => player.username);
      addDiscoveredPlayerNames(visibleNames, 'Players Online');
      state.playerDiscoveryDueAt = Date.now() + ONLINE_DISCOVERY_MS;
    } catch (error) {
      handleTaskError('Player discovery', error);
      state.playerDiscoveryDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.playerDiscoveryRunning = false;
      refreshIdleStatus();
    }
  }

  function gangProfilePlayerNames(profile) {
    if (!profile || typeof profile !== 'object') return [];
    return [
      profile.boss,
      ...(Array.isArray(profile.underboss) ? profile.underboss : []),
      ...(Array.isArray(profile.recruiters) ? profile.recruiters : []),
      ...(Array.isArray(profile.members) ? profile.members : []),
    ];
  }

  async function discoverGangPlayers() {
    if (state.gangDiscoveryRunning) return;
    state.gangDiscoveryRunning = true;
    try {
      state.currentAction = 'Scanning living gang members';
      render();
      const directory = await api('/api/gangs', { priority: REQUEST_PRIORITY.BACKGROUND });
      const gangs = (Array.isArray(directory.gangs) ? directory.gangs : [])
        .map((gang) => ({ legacyId: Number(gang && gang.legacyId) }))
        .filter((gang) => Number.isSafeInteger(gang.legacyId) && gang.legacyId > 0);
      let scanned = 0;

      for (const gang of gangs) {
        if (!state.settings.discoverPlayers || !actionAllowed()) break;
        try {
          const profile = await api(`/api/gangs/gang/${encodeURIComponent(String(gang.legacyId))}`, {
            priority: REQUEST_PRIORITY.BACKGROUND,
          });
          // Save each completed roster even if a later gang fails to load.
          addDiscoveredPlayerNames(gangProfilePlayerNames(profile), `gang ${gang.legacyId}`);
          scanned += 1;
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) continue;
          throw error;
        }
      }

      log(`Gang scan: ${scanned}/${gangs.length} rosters read · ${state.playerNames.length} saved players`, 'info');
      state.gangDiscoveryDueAt = Date.now() + GANG_DISCOVERY_MS;
    } catch (error) {
      handleTaskError('Gang discovery', error);
      state.gangDiscoveryDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.gangDiscoveryRunning = false;
      refreshIdleStatus();
    }
  }

  function discoverPlayerStealVictim(crime, result) {
    if (
      !state.settings.discoverPlayers ||
      !crime ||
      crime.slug !== 'steal' ||
      !result ||
      result.success !== true
    ) return false;

    const match = String(result.html || '').match(/\bfrom\s+<b>([^<]+)<\/b>/i);
    if (!match) return false;
    const decoded = document.createElement('div');
    decoded.innerHTML = match[1];
    const username = validPlayerName(decoded.textContent);
    if (!username) return false;
    addDiscoveredPlayerNames([username], 'Steal from a player');
    return true;
  }

  function discoverJailInmates(data) {
    if (!state.settings.discoverPlayers) return;
    setViewerUsername(data.viewerUsername);
    const inmateNames = (Array.isArray(data.inmates) ? data.inmates : []).map((inmate) => inmate && inmate.username);
    addDiscoveredPlayerNames(inmateNames, 'Jail');
  }

  function nextPlayerSearchCheck(data) {
    const waits = [];
    for (const pending of Array.isArray(data.pending) ? data.pending : []) {
      const seconds = Number(pending.secondsUntilFound);
      if (Number.isFinite(seconds)) waits.push(Math.max(1, seconds));
    }
    for (const found of Array.isArray(data.found) ? data.found : []) {
      const seconds = Number(found.secondsRemaining) - playerSearchRenewLeadSeconds(data);
      if (Number.isFinite(seconds)) waits.push(Math.max(1, seconds));
    }
    const seconds = waits.length ? Math.min(...waits) : 60;
    // Recheck at least once every five minutes so list edits or searches made
    // elsewhere are eventually reflected without continuously polling.
    return Date.now() + Math.min(5 * 60_000, seconds * 1000 + 100);
  }

  function playerSearchRenewLeadSeconds(data) {
    const activeNames = new Set(state.playerNames.map(normalisePlayerName).filter(Boolean));
    for (const row of [...(Array.isArray(data.pending) ? data.pending : []), ...(Array.isArray(data.found) ? data.found : [])]) {
      const key = normalisePlayerName(row && row.username);
      if (key) activeNames.add(key);
    }
    if (state.activeBodyguard) {
      const key = normalisePlayerName(state.activeBodyguard.name);
      if (key) activeNames.add(key);
    }
    const activeCount = activeNames.size;
    const passSeconds = Math.ceil(activeCount * 120 / 1000);
    return Math.max(PLAYER_SEARCH_MIN_RENEW_LEAD_SECONDS, passSeconds + PLAYER_SEARCH_RENEW_SAFETY_SECONDS);
  }

  function nextSearchRenewalTarget(data, now) {
    const ownKey = normalisePlayerName(state.viewerUsername);
    const beamKey = normalisePlayerName(activeBeamName());
    const bodyguardKey = normalisePlayerName(state.activeBodyguard && state.activeBodyguard.name);
    const renewLeadSeconds = playerSearchRenewLeadSeconds(data);
    return (Array.isArray(data.found) ? data.found : [])
      .map((row) => ({ row, name: validPlayerName(row && row.username) }))
      .filter(({ row, name }) => {
        const key = normalisePlayerName(name);
        const secondsRemaining = Number(row && row.secondsRemaining);
        if (!key || key === ownKey || !Number.isFinite(secondsRemaining)) return false;
        if ((state.playerSearchBackoff.get(key) || 0) > now) return false;
        const action = playerAction(name);
        const combatSearch = action.kill || action.beam || key === beamKey || key === bodyguardKey;
        return (state.settings.searchPlayers || combatSearch) && secondsRemaining <= renewLeadSeconds;
      })
      .sort((left, right) => Number(left.row.secondsRemaining) - Number(right.row.secondsRemaining))[0]?.name || '';
  }

  function killMaps(data) {
    return {
      pending: new Map((Array.isArray(data.pending) ? data.pending : [])
        .map((row) => [normalisePlayerName(row.username), row])),
      found: new Map((Array.isArray(data.found) ? data.found : [])
        .map((row) => [normalisePlayerName(row.username), row])),
    };
  }

  function setActiveBodyguard(primary, bodyguard) {
    const name = validPlayerName(bodyguard);
    if (!name) {
      state.activeBodyguard = null;
      return;
    }
    const existing = state.activeBodyguard;
    state.activeBodyguard = {
      primary,
      name,
      confirmedAt: existing && normalisePlayerName(existing.name) === normalisePlayerName(name)
        ? existing.confirmedAt
        : 0,
    };
  }

  function shootWaitMs() {
    return requestRateWait('shoot');
  }

  function nextBeamPollAt() {
    // The shared request limiter and the kill-shoot rolling window now provide
    // all pacing. A scheduler pulse may therefore run the next Beam step.
    return Date.now();
  }

  async function shootPlayer(username, bullets) {
    const wait = shootWaitMs();
    if (wait > 0) {
      state.combatStatus = `Shoot limit: ${username} in ${Math.max(1, Math.ceil(wait / 1000))}s`;
      state.combatDueAt = Date.now() + wait;
      return null;
    }
    const revision = state.killDataRevision;
    try {
      const result = await queueAction('/api/kill/shoot', `Shooting ${username} with ${bullets.toLocaleString('en-GB')} bullet${bullets === 1 ? '' : 's'}`, {
        // The current shoot transaction is allowed to wait for life locks and
        // run for up to 120 seconds. Do not abort it at the generic 15-second
        // timeout and accidentally turn a committed shot into a retry.
        timeoutMs: 130_000,
        body: {
          username,
          bullets,
          showName: false,
          message: '',
        },
        validate: () => validateCombatTarget(username),
      });
      if (result && result.processed === true) {
        log(`Shot at ${username} was processed, but its final response failed — refreshing before any retry`, 'warn');
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatDueAt = Date.now() + 5_000;
        return null;
      }
      if (revision === state.killDataRevision && result && result.data && typeof result.data === 'object') {
        // /api/kill/shoot already returns fresh kill-page data. Reusing it
        // avoids wasting one GET before every Beam bullet.
        state.killData = result.data;
        state.killDataLoadedAt = Date.now();
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.body && error.body.processed === true) {
        log(`Shot at ${username} was processed, but its final response failed — refreshing before any retry`, 'warn');
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatDueAt = Date.now() + 5_000;
        return null;
      }
      throw error;
    }
  }

  async function travelToKillTarget(row) {
    const primary = activeBeamName();
    const validate = () => {
      if (!primary || activeBeamName() !== primary) throw new ActionCancelledError('Beam target changed');
    };
    const targetLocation = normaliseDrugLabel(row && row.location);
    const currentLocation = normaliseDrugLabel(state.killData && state.killData.player && state.killData.player.location);
    if (!targetLocation || targetLocation === currentLocation) return false;

    const mode = state.settings.beamTravelMode;
    let driveData = null;
    if (mode !== 'airport') {
      driveData = await api('/api/drugs?page=1', { priority: REQUEST_PRIORITY.ACTION });
      const destination = findDrugLocation(driveData, targetLocation);
      const favouriteCar = driveData.favouriteCar && typeof driveData.favouriteCar === 'object'
        ? driveData.favouriteCar
        : null;
      if (destination && favouriteCar && driveData.driveAvailable === true) {
        if (Number(favouriteCar.damage || 0) >= state.settings.drugRepairDamage) {
          const publicId = Number(favouriteCar.publicId);
          if (Number.isSafeInteger(publicId) && publicId > 0) {
            await queueAction(`/api/gta/cars/${encodeURIComponent(String(publicId))}/repair`, `Repairing beam car ${favouriteCar.name || ''}`.trim(), { validate });
            state.beamTravelRefreshPending = true;
            state.combatDueAt = Date.now();
            return true;
          }
        }
        await queueAction('/api/drugs/drive', `Driving to ${destination.name} for Beam`, {
          body: { location: Number(destination.id) },
          validate,
        });
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.beamTravelRefreshPending = true;
        state.combatDueAt = Date.now();
        return true;
      }
      if (mode === 'car') {
        state.combatStatus = favouriteCar
          ? `Waiting for favourite car to reach ${row.location}`
          : 'Beam needs a favourited car';
        state.combatDueAt = driveData ? nextDrugDriveCheck(driveData) : Date.now() + 10_000;
        return true;
      }
    }

    if (mode !== 'car') {
      const airport = await api('/api/airport', { priority: REQUEST_PRIORITY.ACTION });
      const destination = (Array.isArray(airport.destinations) ? airport.destinations : [])
        .find((entry) => normaliseDrugLabel(entry && entry.name) === targetLocation);
      if (destination && airport.available === true) {
        await queueAction('/api/airport/fly', `Flying to ${destination.name} for Beam`, {
          body: { location: Number(destination.id) },
          validate,
        });
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.beamTravelRefreshPending = true;
        state.combatDueAt = Date.now();
        return true;
      }
      const airportWait = Number(airport.secondsRemaining);
      const driveWait = Number(driveData && driveData.driveSecondsRemaining);
      const waits = [airportWait, driveWait].filter((seconds) => Number.isFinite(seconds) && seconds > 0);
      state.combatStatus = `Waiting to travel to ${row.location}`;
      state.combatDueAt = Date.now() + (waits.length ? Math.min(...waits) * 1000 + 100 : 10_000);
      return true;
    }
    return false;
  }

  async function searchKillName(username, label = 'Searching') {
    const key = normalisePlayerName(username);
    // A Beam bodyguard search and the maintenance lane may discover the same
    // need concurrently. Share the in-flight operation instead of posting twice.
    if (state.searchesInFlight.has(key)) return state.searchesInFlight.get(key);
    const operation = performKillSearch(username, label);
    state.searchesInFlight.set(key, operation);
    try { return await operation; }
    finally { state.searchesInFlight.delete(key); }
  }

  async function performKillSearch(username, label) {
    try {
      const result = await queueAction('/api/kill/search', `${label} ${username} on the kill page`, {
        body: { username },
        priority: REQUEST_PRIORITY.NORMAL,
        validate: () => {
          if (!state.settings.searchPlayers) validateCombatTarget(username);
        },
      });
      state.searchData = result && result.data && typeof result.data === 'object' ? result.data : null;
      state.searchDataLoadedAt = Date.now();
      // Don't allow an older, concurrently fetched kill snapshot to overwrite
      // this new search. The combat lane obtains a fresh snapshot as needed.
      state.killDataRevision += 1;
      state.killData = null;
      state.killDataLoadedAt = 0;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && /player not found/i.test(error.message)) {
        removeNonLivingPlayer(username);
        // A dead/replaced bodyguard is removed by removeNonLivingPlayer().
        // Continue immediately so Beam rechecks the primary without relying
        // on a background-tab timer to fire 50 ms later.
        state.playerSearchDueAt = Date.now();
        return false;
      }
      throw error;
    }
    state.playerSearchBackoff.delete(normalisePlayerName(username));
    state.playerSearchStatus = `Last searched: ${username}`;
    state.playerSearchDueAt = Date.now();
    return true;
  }

  async function attemptKillSearch(username, label = 'Searching') {
    try {
      return await searchKillName(username, label);
    } catch (error) {
      if (error instanceof ActionCancelledError) throw error;
      if (!(error instanceof ApiError) || error.status === 429 || error.status === 401 || error.status === 408 || error.status >= 500 || error.body?.dead || error.body?.inJail) throw error;
      const message = error && error.message ? error.message : String(error);
      const longBackoff = error instanceof ApiError && (
        error.status === 404 || /dead|cannot be killed|protected from death|yourself/i.test(message)
      );
      state.playerSearchBackoff.set(
        normalisePlayerName(username),
        Date.now() + (longBackoff ? 6 * 60 * 60_000 : 15 * 60_000),
      );
      state.playerSearchStatus = `${username} temporarily skipped`;
      log(`Kill search ${username}: ${message}`, 'warn');
      state.playerSearchDueAt = Date.now();
      return false;
    }
  }

  async function runBeam(data, pending, found) {
    const primary = activeBeamName();
    if (!primary) {
      state.activeBodyguard = null;
      return false;
    }
    const primaryKey = normalisePlayerName(primary);
    const primaryPending = pending.get(primaryKey);
    const primaryFound = found.get(primaryKey);
    state.combatStatus = `Beam: ${primary}`;

    if (!primaryPending && !primaryFound) {
      await searchKillName(primary, 'Starting Beam search for');
      state.combatDueAt = Date.now();
      return true;
    }
    if (!primaryFound) {
      state.combatStatus = `Beam: finding ${primary} in ${Math.max(0, Number(primaryPending.secondsUntilFound) || 0)}s`;
      state.combatDueAt = nextTimeFromSeconds(Math.min(60, Number(primaryPending.secondsUntilFound) || 60), 60);
      return true;
    }

    const blocker = state.activeBodyguard && normalisePlayerName(state.activeBodyguard.primary) === primaryKey
      ? state.activeBodyguard
      : null;
    if (blocker) {
      const blockerKey = normalisePlayerName(blocker.name);
      const blockerFound = found.get(blockerKey);
      const blockerPending = pending.get(blockerKey);
      if (!blockerFound && !blockerPending) {
        await searchKillName(blocker.name, 'Searching bodyguard');
        state.combatDueAt = Date.now();
        return true;
      }

      // Keep hitting the primary while its bodyguard search is pending. Once
      // found, one more primary shot confirms the current outer bodyguard.
      if (!blockerFound || blocker.confirmedAt === 0) {
        if (await travelToKillTarget(primaryFound)) return true;
        const result = await shootPlayer(primary, 1);
        if (!result) return true;
        if (result.blockingBodyguard) {
          const same = normalisePlayerName(result.blockingBodyguard) === blockerKey;
          setActiveBodyguard(primary, result.blockingBodyguard);
          if (same && blockerFound) state.activeBodyguard.confirmedAt = Date.now();
        } else {
          state.activeBodyguard = null;
          if (result.killed === true) {
            const action = playerAction(primary);
            state.playerActions[primaryKey] = { ...action, beam: false, kill: false };
            savePlayerActions();
          }
        }
        state.combatDueAt = nextBeamPollAt();
        return true;
      }

      if (await travelToKillTarget(blockerFound)) return true;
      const prepared = await prepareKillTarget(blocker.name);
      const required = Number(prepared.bullets);
      const available = Number(data.player && data.player.bullets);
      if (!Number.isSafeInteger(required) || required < 1) throw new Error(`Invalid prepared bullet count for ${blocker.name}`);
      if (!Number.isFinite(available) || available < required) {
        state.combatStatus = `Beam: need ${required.toLocaleString('en-GB')} bullets for bodyguard ${blocker.name}`;
        state.combatDueAt = Date.now() + 30_000;
        return true;
      }
      try {
        const result = await shootPlayer(blocker.name, required);
        if (!result) return true;
        if (result && result.killed === true) {
          log(`Bodyguard ${blocker.name} removed — returning to ${primary}`, 'ok');
          state.activeBodyguard = null;
        }
      } catch (error) {
        if (error instanceof ApiError && /bodyguard assignment changed/i.test(error.message)) {
          state.activeBodyguard = null;
          state.combatStatus = `Beam: ${primary}'s bodyguard changed — refreshing`;
          log(state.combatStatus, 'warn');
        } else {
          throw error;
        }
      }
      state.combatDueAt = Date.now();
      return true;
    }

    if (await travelToKillTarget(primaryFound)) return true;
    const action = playerAction(primary);
    let bullets = 1;
    if (action.beamMode === 'kill') {
      const prepared = await prepareKillTarget(primary);
      bullets = Number(prepared.bullets);
      const available = Number(data.player && data.player.bullets);
      if (!Number.isSafeInteger(bullets) || bullets < 1) throw new Error(`Invalid prepared bullet count for ${primary}`);
      if (!Number.isFinite(available) || available < bullets) {
        state.combatStatus = `Beam: need ${bullets.toLocaleString('en-GB')} bullets for ${primary}`;
        state.combatDueAt = Date.now() + 30_000;
        return true;
      }
    }
    const result = await shootPlayer(primary, bullets);
    if (!result) return true;
    if (result && result.blockingBodyguard) {
      setActiveBodyguard(primary, result.blockingBodyguard);
      state.combatStatus = `Beam: searching bodyguard ${result.blockingBodyguard}`;
    } else if (result && result.killed === true) {
      state.playerActions[primaryKey] = { ...action, beam: false, kill: false };
      savePlayerActions();
      state.combatStatus = `Beam target ${primary} killed`;
    }
    state.combatDueAt = nextBeamPollAt();
    return true;
  }

  async function runPassiveKill(data, found) {
    const target = state.playerNames.find((name) => {
      const row = found.get(normalisePlayerName(name));
      return playerAction(name).kill && row && row.canShootHere === true;
    });
    if (!target) return false;
    const prepared = await prepareKillTarget(target);
    const required = Number(prepared.bullets);
    const available = Number(data.player && data.player.bullets);
    if (!Number.isSafeInteger(required) || required < 1) throw new Error(`Invalid prepared bullet count for ${target}`);
    if (!Number.isFinite(available) || available < required) {
      state.combatStatus = `Kill: need ${required.toLocaleString('en-GB')} bullets for ${target}`;
      return false;
    }
    const result = await shootPlayer(target, required);
    if (!result) return true;
    if (result && result.killed === true) {
      const key = normalisePlayerName(target);
      state.playerActions[key] = { ...playerAction(target), kill: false };
      savePlayerActions();
      state.combatStatus = `Kill target ${target} killed`;
    } else if (result && result.blockingBodyguard) {
      state.combatStatus = `Kill: ${target} is protected by ${result.blockingBodyguard}`;
    }
    state.combatDueAt = Date.now() + 5_000;
    return true;
  }

  function validateCombatTarget(username) {
    const action = playerAction(username);
    const blocker = state.activeBodyguard;
    const currentGuard = blocker && normalisePlayerName(blocker.name) === normalisePlayerName(username)
      && normalisePlayerName(blocker.primary) === normalisePlayerName(activeBeamName());
    if (state.inJail || (!action.kill && !action.beam && !currentGuard)) {
      throw new ActionCancelledError('Combat target is no longer selected');
    }
  }

  function prepareKillTarget(username) {
    return api('/api/kill/prepare', { method: 'POST', body: { username },
      validate: () => validateCombatTarget(username) });
  }

  async function runPlayerSearch() {
    if (state.playerSearchRunning) return;
    state.playerSearchRunning = true;
    try {
      // Successful search POSTs already return the full list. Reuse it while
      // draining new names instead of adding a GET between every two searches.
      const revision = state.killDataRevision;
      const useCache = state.searchData && Date.now() - state.searchDataLoadedAt < 5_000;
      const data = useCache
        ? state.searchData : await api('/api/kill', { priority: REQUEST_PRIORITY.NORMAL });
      if (revision !== state.killDataRevision) { state.playerSearchDueAt = Date.now(); return; }
      state.searchData = data;
      // Retain the original cache age; repeated reads must not extend it.
      if (!useCache) state.searchDataLoadedAt = Date.now();
      if (data.player?.alive === false) { stopAutomationForDeath(); return; }
      if (data.player?.username) setViewerUsername(data.player.username);
      const now = Date.now();
      const { pending, found } = killMaps(data);
      const renewal = nextSearchRenewalTarget(data, now);
      const ownKey = normalisePlayerName(state.viewerUsername);
      const target = renewal || state.playerNames.find((name) => {
        const key = normalisePlayerName(name);
        return key && key !== ownKey
          && (state.settings.searchPlayers || playerAction(name).kill || playerAction(name).beam)
          && !state.searchesInFlight.has(key)
          && (state.playerSearchBackoff.get(key) || 0) <= now
          && !pending.has(key) && !found.has(key);
      });
      if (target) {
        await attemptKillSearch(target, renewal ? 'Renewing search for' : 'Searching');
      } else {
        state.playerSearchStatus = `${pending.size} pending · ${found.size} found`;
        const retries = [...state.playerSearchBackoff.values()].filter((at) => at > now);
        state.playerSearchDueAt = Math.min(nextPlayerSearchCheck(data), ...retries);
      }
    } catch (error) {
      handleTaskError('Player search', error);
      state.searchData = null;
      state.playerSearchDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.playerSearchRunning = false;
      refreshIdleStatus();
    }
  }

  async function runCombat() {
    if (state.combatRunning) return;
    state.combatRunning = true;
    state.currentAction = 'Checking kill-page searches';
    render();
    try {
      const canReuseBeamData = Boolean(
        activeBeamName() &&
        state.killData &&
        Date.now() - state.killDataLoadedAt <= 1_500
      );
      const data = canReuseBeamData
        ? state.killData
        : await api('/api/kill', { priority: REQUEST_PRIORITY.RAPID });
      if (!canReuseBeamData) {
        state.killData = data;
        state.killDataLoadedAt = Date.now();
      }
      const viewer = validPlayerName(data.player && data.player.username);
      if (viewer) setViewerUsername(viewer);
      if (data.player && data.player.alive === false) {
        stopAutomationForDeath();
        return;
      }

      state.beamTravelRefreshPending = false;
      const { pending, found } = killMaps(data);
      const wait = shootWaitMs();
      if (wait > 0) { state.combatDueAt = Date.now() + wait; return; }
      if (await runBeam(data, pending, found)) return;
      if (await runPassiveKill(data, found)) return;
      state.combatDueAt = Math.min(nextPlayerSearchCheck(data), Date.now() + 1_000);
    } catch (error) {
      if (error instanceof ApiError && /currently in|travel to|has not been found/i.test(error.message)) {
        // Location/search state changed between the cached shot response and
        // this action. Refresh immediately so Beam can travel or re-search.
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatDueAt = Date.now();
      } else {
        if (!(error instanceof ActionCancelledError)) handleTaskError('Combat', error);
        state.combatDueAt = Date.now() + errorBackoff(error);
      }
    } finally {
      state.combatRunning = false;
      refreshIdleStatus();
      requestSchedulerWake();
    }
  }

  function jailInmateIdentifier(inmate) {
    return String((inmate && (inmate.id || inmate.username)) || '').trim();
  }

  function chooseJailBustCandidate(data) {
    if (!state.settings.jailBust || data.inJail === true) return null;
    // Older/local builds expose internal player IDs. The current live API
    // intentionally exposes usernames instead, so support both contracts.
    const viewerIdentifier = String(data.playerId || data.viewerUsername || '').trim().toLocaleLowerCase();
    const inmates = (Array.isArray(data.inmates) ? data.inmates : [])
      .filter((inmate) => {
        const identifier = jailInmateIdentifier(inmate);
        return identifier && identifier.toLocaleLowerCase() !== viewerIdentifier;
      });

    inmates.sort((left, right) => {
      const leftReward = bigintOrZero(left.bustReward);
      const rightReward = bigintOrZero(right.bustReward);
      if (leftReward !== rightReward) return leftReward > rightReward ? -1 : 1;
      return Number(left.secondsRemaining || 0) - Number(right.secondsRemaining || 0);
    });
    return inmates[0] || null;
  }

  async function runJailBust() {
    const inmate = state.jailBustCandidate;
    if (!inmate || state.jailBustRunning || state.inJail) return false;
    const inmateIdentifier = jailInmateIdentifier(inmate);
    if (!inmateIdentifier) return false;

    state.jailBustCandidate = null;
    state.jailBustRunning = true;
    state.currentAction = `Preparing to bust ${inmate.username || 'player'}`;
    render();
    try {
      await queueAction(
        `/api/jail/bust/${encodeURIComponent(inmateIdentifier)}`,
        `Busting ${inmate.username || 'player'}`
      );
      state.jailBustCandidate = null;
      state.jailBustDueAt = Date.now();
      state.jailDueAt = 0;
      return true;
    } catch (error) {
      if (error instanceof ApiError && (
        (error.body && error.body.success === false) ||
        /cannot bust players while you are in jail|got caught trying to bust/i.test(error.message)
      )) {
        log(error.message, 'warn');
        markJailed();
      } else if (error instanceof ApiError && error.status === 400 && /not in jail|no longer in jail/i.test(error.message)) {
        // Another player beat us to this inmate. Refresh immediately instead of
        // applying the normal error backoff, so the next inmate can be attempted.
        state.jailBustDueAt = Date.now();
      } else if (!(error instanceof ActionCancelledError)) {
        handleTaskError('Jailbust', error);
        state.jailBustDueAt = Date.now() + errorBackoff(error);
      }
      state.jailDueAt = 0;
      return false;
    } finally {
      state.jailBustRunning = false;
      refreshIdleStatus();
    }
  }

  async function checkJail() {
    state.jailRunning = true;
    state.jailBustCandidate = null;
    const requestStartedAt = Date.now();
    let bustImmediately = false;
    let checkedSuccessfully = false;
    try {
      // /api/jail is the inmate-list contract provided by the current game.
      // Keep this bot compatible with the deployed game instead of depending
      // on an additional bot-only endpoint.
      const data = await api('/api/jail', { priority: REQUEST_PRIORITY.RAPID });
      checkedSuccessfully = true;
      discoverJailInmates(data);
      const wasInJail = state.inJail;
      if (data.inJail === true) {
        markJailed();
      } else if (requestStartedAt >= state.jailMarkedAt) {
        state.inJail = false;
        state.jailMarkedAt = 0;
      }
      state.jailBustCandidate = chooseJailBustCandidate(data);
      bustImmediately = state.jailBustCandidate !== null
        && !state.jailBustRunning
        && state.jailBustDueAt <= Date.now();
      if (state.settings.jailBust && !state.inJail) {
        // The request-driven monitor starts the next read as soon as this one
        // and any resulting bust attempt have settled. The shared limiter still
        // keeps action POSTs ahead of inmate scans.
        state.jailDueAt = Date.now();
      } else {
        state.jailDueAt = nextTimeFromSeconds(
          state.inJail ? Math.min(Number(data.secondsRemaining) || 3, 3) : 3,
          3,
        );
      }

      if (wasInJail && !state.inJail) {
        log('Released from jail — resuming actions', 'ok');
        state.crimesDueAt = 0;
        state.gtaDueAt = 0;
        state.meltDueAt = 0;
      } else if (!wasInJail && state.inJail) {
        log(`In jail${data.secondsRemaining ? ` for ${data.secondsRemaining}s` : ''} — actions paused`, 'warn');
      }
    } catch (error) {
      handleTaskError('Jail check', error);
      state.jailDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.jailRunning = false;
      // Do not wait for the ordinary feature scheduler. The POST is chained
      // directly from the inmate response so no page-timer pulse is required.
      if (bustImmediately) await runJailBust();
      refreshIdleStatus();
    }
    return checkedSuccessfully;
  }

  function jailMonitorReady() {
    const now = Date.now();
    return state.botTab
      && state.controller
      && state.settings.enabled
      && state.settings.jailBust
      && !state.stoppedForDeath
      && !state.authRequired
      && !state.inJail
      && state.jailDueAt <= now
      && state.jailBustDueAt <= now;
  }

  function ensureJailMonitor() {
    if (state.jailMonitorRunning || state.jailRunning || state.jailBustRunning || !jailMonitorReady()) return;
    state.jailMonitorRunning = true;

    void (async () => {
      try {
        // Each completed /api/jail request starts the next check directly.
        // This makes inmate discovery request-driven, so minimized-tab timer
        // throttling cannot add a delay between a response and the next scan.
        while (jailMonitorReady()) {
          const checkedSuccessfully = await checkJail();
          requestSchedulerWake();
          if (!checkedSuccessfully || state.inJail) break;
        }
      } finally {
        state.jailMonitorRunning = false;
        refreshIdleStatus();
        requestSchedulerWake();
      }
    })();
  }

  function errorBackoff(error) {
    if (error instanceof ApiError && error.status === 429) {
      return error.retryAfter > 0 ? error.retryAfter * 1000 + 50 : 250;
    }
    if (error instanceof ApiError && error.status === 401) return 10_000;
    return 5_000;
  }

  function handleTaskError(task, error) {
    if (error instanceof ActionCancelledError) return;
    if (error instanceof ApiError && error.body && error.body.dead === true) {
      stopAutomationForDeath();
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      beginLoginRecovery();
      return;
    }
    if (error instanceof ApiError && error.body && error.body.inJail === true) {
      markJailed();
      return;
    }
    log(`${task}: ${error && error.message ? error.message : error}`, 'error');
  }

  function refreshIdleStatus() {
    if (state.restartProgress.active) state.currentAction = state.restartProgress.message || 'Restart in progress';
    else if (state.stoppedForDeath) state.currentAction = 'Character dead — stopped';
    else if (!state.botTab) state.currentAction = 'Play tab — automation inactive';
    else if (!state.settings.enabled) state.currentAction = 'Stopped';
    else if (state.authRequired) {
      const preserveLoginError = /^(?:Auto-login failed|Auto-login rate-limited|Auto-login request failed|Email verification required)/.test(state.currentAction);
      if (!preserveLoginError) {
        const savedAutoLogin = state.loginCredentials.autoLogin && hasSavedLoginCredentials();
        state.currentAction = state.loginRecovery
          ? (isLoginPage()
            ? (savedAutoLogin ? 'Login required — automatic recovery active' : 'Login required — check Login tab or log in manually')
            : 'Login required — opening login')
          : 'Log in to Underworld Legacy';
      }
    }
    else if (!state.controller) state.currentAction = 'Standby — another tab is active';
    else if (state.inJail) state.currentAction = 'Paused while in jail';
    else if (autoRankIsActiveNow() && !state.jailBustRunning && !state.drugsRunning && !state.playerSearchRunning && !state.combatRunning) state.currentAction = 'Auto Rank active — server-controlled actions paused locally';
    else if (!state.crimesRunning && !state.gtaRunning && !state.jailBustRunning && !state.meltRunning && !state.drugsRunning && !state.autoRankRunning && !state.playerDiscoveryRunning && !state.gangDiscoveryRunning && !state.playerSearchRunning && !state.combatRunning && !state.jailRunning) state.currentAction = 'Waiting for next action';
    render();
  }

  function scheduledTasks() {
    const now = Date.now();
    const combat = hasCombatActions();
    const beam = Boolean(activeBeamName());
    const serverRanking = autoRankIsActiveNow();
    const rankBusy = state.crimesRunning || state.gtaRunning || state.meltRunning;
    const rankTransition = state.autoRankRunning || (state.settings.autoRank && state.autoRankDueAt <= now);
    const canRank = !state.inJail && !rankTransition;
    const monitor = state.settings.jailBust && !state.inJail;
    const tasks = [];
    const add = (enabled, running, dueAt, run) => {
      if (enabled && !running) tasks.push({ dueAt, run });
    };
    add(true, state.jailMonitorRunning || state.jailRunning || state.jailBustRunning,
      monitor ? Math.max(state.jailDueAt, state.jailBustDueAt) : state.jailDueAt,
      monitor ? ensureJailMonitor : checkJail);
    add(state.settings.autoRank && !rankBusy, state.autoRankRunning, state.autoRankDueAt, runAutoRank);
    add(canRank && state.settings.crimes && !(serverRanking && state.autoRankControls.crimes), state.crimesRunning, state.crimesDueAt, runCrimes);
    add(canRank && state.settings.gta && !(serverRanking && state.autoRankControls.gta), state.gtaRunning, state.gtaDueAt, runGta);
    // Only melting needs the favourite-car guard loaded first. Crimes/GTA
    // and jail need not wait for drug inventory or repairs to load.
    add(canRank && state.settings.melt && !(serverRanking && state.autoRankControls.melt)
      && (!state.settings.drugs || state.drugContextLoaded), state.meltRunning, state.meltDueAt, runMelt);
    // Let a drug workflow settle before Beam may change country.
    add(!state.inJail && combat && !state.drugsRunning, state.combatRunning, state.combatDueAt, runCombat);
    add(!state.inJail && (state.settings.searchPlayers || combat), state.playerSearchRunning, state.playerSearchDueAt, runPlayerSearch);
    add(!state.inJail && state.settings.drugs && ((!beam && !state.combatRunning) || !state.drugContextLoaded), state.drugsRunning, state.drugsDueAt, runDrugs);
    add(state.settings.discoverPlayers, state.playerDiscoveryRunning, state.playerDiscoveryDueAt, runPlayerDiscovery);
    add(state.settings.discoverPlayers, state.gangDiscoveryRunning, state.gangDiscoveryDueAt, discoverGangPlayers);
    add(!state.inJail && qtReady(), state.qtRunning, state.qtDueAt, runQuicktrade);
    return tasks;
  }

  function launchTask(run) {
    // Task functions mark themselves running synchronously, before their first
    // await. No second copy of the same module can be launched by another wake.
    Promise.resolve(run()).catch((error) => handleTaskError('Scheduler', error))
      .finally(requestSchedulerWake);
  }

  function tick() {
    if (!actionAllowed() || state.authRequired) { refreshIdleStatus(); return; }
    const now = Date.now();
    if (state.globalRateLimitedUntil > now) {
      state.currentAction = `Server rate limit · resuming in ${Math.ceil((state.globalRateLimitedUntil - now) / 1000)}s`;
      render();
      return;
    }
    // Start every eligible lane, not just the first due item in a checklist.
    for (const task of scheduledTasks()) {
      if (task.dueAt <= now) launchTask(task.run);
    }
  }

  function armScheduler() {
    if (schedulerTimer !== null) clearTimeout(schedulerTimer);
    schedulerTimer = null;
    if (!actionAllowed() || state.authRequired) return;
    const now = Date.now();
    const due = state.globalRateLimitedUntil > now ? state.globalRateLimitedUntil
      : Math.min(...scheduledTasks().map((task) => task.dueAt));
    if (Number.isFinite(due)) {
      schedulerTimer = setTimeout(requestSchedulerWake, Math.max(1, due - now));
    }
  }

  function requestSchedulerWake() {
    if (!schedulerStarted || schedulerWakeQueued) return;
    schedulerWakeQueued = true;
    queueMicrotask(() => {
      schedulerWakeQueued = false;
      pumpRequestQueue();
      tick();
      armScheduler();
    });
  }

  function startSchedulerClock() {
    schedulerStarted = true;
    requestSchedulerWake();
    // Exact due-time wakeups + response-driven continuation do the work.
    // This watchdog only recovers from UI edits or missed browser callbacks.
    // Browsers/OS sleep can still suspend a userscript; no timing guarantee
    // is possible while the tab or computer is suspended.
    setInterval(requestSchedulerWake, 1_000);
  }

  function createPanel() {
    // Clear a stale panel left by a previous script copy before binding this
    // instance. The metadata name is now permanent so future installs update
    // this script rather than creating another Tampermonkey entry.
    for (const existingPanel of document.querySelectorAll('#ul-simple-bot')) {
      existingPanel.remove();
    }
    const host = document.createElement('section');
    host.id = 'ul-simple-bot';
    host.innerHTML = `
      <div class="ul-simple-header">
        <strong>${SCRIPT_NAME}</strong>
        <span class="ul-simple-header-actions">
          <button type="button" id="ul-simple-tab-mode" title="Choose whether automation may run in this tab">Use as bot tab</button>
          <button type="button" id="ul-simple-collapse" title="Collapse">−</button>
        </span>
      </div>
      <div id="ul-simple-body">
        <div class="ul-simple-runtime-row">
          <div id="ul-simple-status">Loading…</div>
          <button type="button" id="ul-simple-toggle">Start</button>
        </div>
        <div id="ul-simple-login-recovery" hidden>
          <div id="ul-simple-login-recovery-text">Login required. Check the Login tab or log in manually.</div>
          <div class="ul-simple-login-actions">
            <button type="button" id="ul-simple-open-login-tab">Login settings</button>
            <button type="button" id="ul-simple-cancel-login">Stop bot</button>
          </div>
        </div>
        <nav class="ul-simple-tabs" role="tablist" aria-label="Bot sections">
          <button type="button" class="ul-simple-tab" data-tab="actions" role="tab">Actions</button>
          <button type="button" class="ul-simple-tab" data-tab="cars" role="tab">Cars</button>
          <button type="button" class="ul-simple-tab" data-tab="players" role="tab">Players</button>
          <button type="button" class="ul-simple-tab" data-tab="quicktrade" role="tab">Quicktrade</button>
          <button type="button" class="ul-simple-tab" data-tab="restart" role="tab">Restart</button>
          <button type="button" class="ul-simple-tab" data-tab="login" role="tab">Login</button>
          <button type="button" class="ul-simple-tab" data-tab="logs" role="tab">Logs</button>
        </nav>

        <section class="ul-simple-tab-panel" data-tab-panel="actions" role="tabpanel">
          <div class="ul-simple-section-title">Core actions</div>
          <div class="ul-simple-option-grid">
            <label><input type="checkbox" id="ul-simple-crimes"> Crimes</label>
            <label><input type="checkbox" id="ul-simple-gta"> GTA</label>
            <label title="Failed attempts can send your character to jail"><input type="checkbox" id="ul-simple-jailbust"> Jailbust</label>
            <label title="Starts a new server-side Auto Rank session after its activity timer genuinely expires"><input type="checkbox" id="ul-simple-auto-rank"> Auto-renew rank</label>
          </div>
          <div id="ul-simple-auto-rank-status">Auto Rank not checked</div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="cars" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Melting</div>
          <div class="ul-simple-option-row">
            <label><input type="checkbox" id="ul-simple-melt"> Enable melt</label>
          </div>
          <div class="ul-simple-melt-filter">
            <span>Filter:</span>
            <label><input type="checkbox" id="ul-simple-melt-common"> Common</label>
            <label><input type="checkbox" id="ul-simple-melt-rare"> Rare</label>
            <label title="Allow the exact standard Tuner car to be melted; RS Tuners remain protected"><input type="checkbox" id="ul-simple-melt-tuners"> Tuners</label>
            <label><input type="checkbox" id="ul-simple-repair-before-melt"> Repair first</label>
          </div>
          <div class="ul-simple-protected" title="These types and every other API-reported very rare car are always blocked from melting.">
            Always protected: RS Tuner, Mythic, Hyper, Black or Orange. Standard Tuners require the toggle.
          </div>
          <div class="ul-simple-section-title">Drug run</div>
          <div class="ul-simple-option-row">
            <label><input type="checkbox" id="ul-simple-drugs"> Enable drugs</label>
          </div>
          <div class="ul-simple-drug-settings">
            Repair favourite car at
            <input type="number" id="ul-simple-drug-repair-damage" min="1" max="99" step="1" aria-label="Drug car repair damage">
            % damage
          </div>
          <div id="ul-simple-drug-status">Drugs not checked</div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="players" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Player discovery and kill search</div>
          <div class="ul-simple-player-controls">
            <label title="Collect visible Players Online, public jail inmates, living gang members and successful player-steal victims"><input type="checkbox" id="ul-simple-discover-players"> Discover players</label>
            <label title="Search saved players and renew every active kill-page search, including manual and bodyguard searches"><input type="checkbox" id="ul-simple-search-players"> Search players</label>
          </div>
          <div class="ul-simple-beam-settings">
            Beam travel
            <select id="ul-simple-beam-travel" aria-label="Beam travel method">
              <option value="auto">Auto</option>
              <option value="car">Favourite car</option>
              <option value="airport">Airport</option>
            </select>
          </div>
          <div class="ul-simple-player-list-wrap">
            <div id="ul-simple-player-status">Player discovery disabled</div>
            <textarea id="ul-simple-player-list" rows="6" spellcheck="false" placeholder="Player names, one per line"></textarea>
            <div class="ul-simple-player-list-actions">
              <button type="button" id="ul-simple-save-player-list">Save player list</button>
              <span id="ul-simple-player-search-status">Player searching disabled</span>
            </div>
            <div class="ul-simple-search-warning">Kill-page searches remove death protection.</div>
          </div>
          <div id="ul-simple-combat-status">Kill and Beam idle</div>
          <div class="ul-simple-player-actions-head"><span>Player / search</span><span>Kill</span><span>Beam</span><span>Mode</span></div>
          <div id="ul-simple-player-actions"></div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="quicktrade" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Buy points</div>
          <label><input type="checkbox" id="ul-simple-qt-points"> Enable points purchasing</label>
          <label class="ul-simple-qt-label">Maximum cash per point
            <input id="ul-simple-qt-point-price" type="text" inputmode="numeric" placeholder="e.g. 1,000,000">
          </label>
          <label class="ul-simple-qt-label">Points still to buy
            <input id="ul-simple-qt-point-quantity" type="text" inputmode="numeric" placeholder="e.g. 1,000">
          </label>
          <button type="button" id="ul-simple-qt-save-points">Save points limits</button>
          <div id="ul-simple-qt-point-summary" class="ul-simple-qt-note"></div>
          <div class="ul-simple-qt-note">Buys whole offer lots at or below your price. Lots larger than the remaining quantity are skipped. Zero remaining stops buying. Automatically withdraws only the cash shortfall from Swiss.</div>
          <div class="ul-simple-section-title">Buy perks</div>
          <label><input type="checkbox" id="ul-simple-qt-perks"> Enable perk purchasing</label>
          <button type="button" id="ul-simple-qt-refresh">Load perk names</button>
          <label class="ul-simple-qt-label">Exact perk name
            <input id="ul-simple-qt-perk-name" list="ul-simple-qt-catalog" type="text" placeholder="Select or type a full perk name" maxlength="250">
          </label>
          <datalist id="ul-simple-qt-catalog"></datalist>
          <label class="ul-simple-qt-label">Pay with
            <select id="ul-simple-qt-currency"><option value="money">Cash</option><option value="points">Points</option></select>
          </label>
          <label class="ul-simple-qt-label">Maximum price for one whole perk listing
            <input id="ul-simple-qt-perk-price" type="text" inputmode="numeric" placeholder="Whole listing price">
          </label>
          <label class="ul-simple-qt-label">Number of listings still to buy
            <input id="ul-simple-qt-perk-quantity" type="text" inputmode="numeric" value="1">
          </label>
          <button type="button" id="ul-simple-qt-save-rule">Save perk rule</button>
          <div id="ul-simple-qt-rules"></div>
          <div class="ul-simple-qt-note">Perk rules match the exact name, including its amount. Prices are per listing, not per minute. Cash purchases automatically withdraw only the shortfall from Swiss. Perks priced in points use your points balance. Consumables and car perks are included.</div>
          <div class="ul-simple-qt-note">Listings are rechecked before buying. The game cannot lock a perk's quoted price against a last-moment seller change.</div>
          <div id="ul-simple-qt-status" role="status"></div>
          <button type="button" id="ul-simple-qt-clear-pending" hidden>I've checked the transaction — resume Quicktrade</button>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="restart" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Restart after death</div>
          <label class="ul-simple-restart-option"><input type="checkbox" id="ul-simple-restart-enabled"> Automatically create my next character</label>
          <label class="ul-simple-restart-option"><input type="checkbox" id="ul-simple-restart-retrieve"> Retrieve archived Swiss, points and eligible cars</label>
          <div class="ul-simple-restart-note">Uses your existing account. Save your email/password and enable Auto-login in the Login tab if you want it to log in when needed. Normal retrieval tax and car fees apply; staff roles are not retrieved.</div>
          <label class="ul-simple-restart-option" for="ul-simple-restart-names">Username queue — one name per line</label>
          <textarea id="ul-simple-restart-names" rows="7" spellcheck="false" placeholder="YourNextName&#10;AnotherName"></textarea>
          <div class="ul-simple-restart-buttons">
            <button type="button" id="ul-simple-restart-generate">Generate 100 usernames</button>
            <button type="button" id="ul-simple-restart-save">Save username list</button>
          </div>
          <div class="ul-simple-restart-note">Names are used from the top. Taken names are skipped. Generate adds suggestions to this editable list; save it when ready. Names need 2–20 letters, numbers, spaces, underscores or hyphens.</div>
          <div id="ul-simple-restart-status" role="status"></div>
          <button type="button" id="ul-simple-restart-retry">Retry after checking</button>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="login" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Automatic login</div>
          <div class="ul-simple-login-note">
            Saved only in this userscript's Tampermonkey storage on this browser profile. It is not the Chrome/Firefox password vault, so anyone with access to this browser profile/userscript storage may be able to read it. The password is never written into the script source, logs, URLs, page storage or the bot's normal settings.
          </div>
          <label class="ul-simple-login-label" for="ul-simple-login-email">Email</label>
          <input id="ul-simple-login-email" class="ul-simple-login-input" type="email" autocomplete="off" spellcheck="false" placeholder="you@example.com">
          <label class="ul-simple-login-label" for="ul-simple-login-password">Password</label>
          <input id="ul-simple-login-password" class="ul-simple-login-input" type="password" autocomplete="off" placeholder="Enter password to save/change">
          <label class="ul-simple-login-auto"><input type="checkbox" id="ul-simple-login-auto"> Auto-login when the session expires</label>
          <div class="ul-simple-login-settings-actions">
            <button type="button" id="ul-simple-login-save">Save locally</button>
            <button type="button" id="ul-simple-login-clear">Clear saved login</button>
            <button type="button" id="ul-simple-login-retry">Retry now</button>
          </div>
          <div id="ul-simple-login-status">No login saved</div>
        </section>

        <section class="ul-simple-tab-panel" data-tab-panel="logs" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Timing</div>
          <div class="ul-simple-pacing">
            Independent due-time actions · 18 requests/sec shared budget with play-tab headroom.
            Shoot: 49/10s · Search and Prepare: 98/10s each. Server Retry-After is always honoured.
          </div>
          <div class="ul-simple-section-title">Recent activity</div>
          <div id="ul-simple-last">None yet</div>
          <div id="ul-simple-logs"></div>
        </section>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #ul-simple-bot { position:fixed; right:12px; bottom:12px; z-index:2147483647; width:300px; color:#eee; background:#111; border:1px solid #4d4d4d; box-shadow:0 4px 18px #000a; font:12px/1.35 Arial,sans-serif; }
      #ul-simple-bot * { box-sizing:border-box; }
      #ul-simple-bot .ul-simple-header { display:flex; align-items:center; justify-content:space-between; padding:7px 9px; background:#242424; border-bottom:1px solid #444; color:#9fd5ff; }
      #ul-simple-bot .ul-simple-header-actions { display:flex; gap:5px; align-items:center; }
      #ul-simple-bot button { color:#eee; background:#343434; border:1px solid #666; padding:4px 8px; cursor:pointer; }
      #ul-simple-bot button:hover { background:#454545; }
      #ul-simple-bot #ul-simple-collapse { width:24px; height:22px; padding:0; }
      #ul-simple-bot #ul-simple-tab-mode { padding:2px 6px; font-size:11px; }
      #ul-simple-bot #ul-simple-tab-mode.active { color:#a9f5a9; border-color:#4d8d4d; }
      #ul-simple-bot #ul-simple-body { padding:0; }
      #ul-simple-bot .ul-simple-runtime-row { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; min-height:43px; padding:7px 8px; }
      #ul-simple-bot #ul-simple-status { color:#ffd36b; }
      #ul-simple-bot #ul-simple-login-recovery { margin:0 8px 8px; padding:7px; border:1px solid #5b4b2c; background:#211c12; color:#ffdca0; }
      #ul-simple-bot .ul-simple-login-actions { display:flex; gap:6px; margin-top:6px; }
      #ul-simple-bot .ul-simple-tabs { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid #3b3b3b; border-bottom:1px solid #3b3b3b; background:#181818; }
      #ul-simple-bot .ul-simple-tab { min-width:0; padding:6px 2px; border:0; border-right:1px solid #3b3b3b; font-size:11px; }
      #ul-simple-bot .ul-simple-tab:last-child { border-right:0; }
      #ul-simple-bot .ul-simple-tab.active { color:#a9dcff; background:#303030; box-shadow:inset 0 -2px #69a9d2; }
      #ul-simple-bot .ul-simple-tab-panel { min-height:150px; padding:8px; }
      #ul-simple-bot .ul-simple-tab-panel[hidden] { display:none !important; }
      #ul-simple-bot .ul-simple-section-title { margin:0 0 7px; padding-bottom:3px; border-bottom:1px solid #383838; color:#9fd5ff; font-weight:bold; }
      #ul-simple-bot .ul-simple-option-grid { display:grid; grid-template-columns:1fr 1fr; gap:9px 12px; margin-bottom:12px; }
      #ul-simple-bot .ul-simple-option-grid label, #ul-simple-bot .ul-simple-option-row label { display:flex; gap:5px; align-items:center; }
      #ul-simple-bot .ul-simple-option-row { margin-bottom:9px; }
      #ul-simple-bot .ul-simple-player-controls { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:8px; padding:6px; border:1px solid #36506a; background:#111b24; }
      #ul-simple-bot .ul-simple-player-controls label { display:flex; gap:4px; align-items:center; }
      #ul-simple-bot .ul-simple-beam-settings { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; color:#bbb; }
      #ul-simple-bot .ul-simple-beam-settings select, #ul-simple-bot .ul-simple-player-mode { color:#eee; background:#1b1b1b; border:1px solid #555; padding:2px; }
      #ul-simple-bot #ul-simple-toggle.running { color:#ffb1b1; border-color:#a44; }
      #ul-simple-bot .ul-simple-melt-filter { display:flex; flex-wrap:wrap; gap:9px; align-items:center; margin-bottom:5px; color:#ccc; }
      #ul-simple-bot .ul-simple-melt-filter label { display:flex; gap:4px; align-items:center; }
      #ul-simple-bot .ul-simple-protected { margin-bottom:8px; padding:5px 6px; border:1px solid #5b4b2c; background:#211c12; color:#ffd36b; }
      #ul-simple-bot .ul-simple-drug-settings { display:flex; gap:4px; align-items:center; color:#bbb; margin-bottom:5px; }
      #ul-simple-bot .ul-simple-drug-settings input { width:48px; padding:3px; color:#eee; background:#1b1b1b; border:1px solid #555; }
      #ul-simple-bot #ul-simple-drug-status { margin-bottom:8px; color:#9fd5ff; }
      #ul-simple-bot #ul-simple-auto-rank-status { margin-bottom:8px; color:#b8e3b8; }
      #ul-simple-bot .ul-simple-player-list-wrap { padding:6px; border:1px solid #333; background:#151515; }
      #ul-simple-bot #ul-simple-player-status { margin-bottom:5px; color:#9fd5ff; }
      #ul-simple-bot #ul-simple-player-list { display:block; width:100%; resize:vertical; padding:4px; color:#eee; background:#0d0d0d; border:1px solid #555; font:11px/1.3 monospace; }
      #ul-simple-bot .ul-simple-player-list-actions { display:flex; gap:7px; align-items:center; margin-top:5px; }
      #ul-simple-bot #ul-simple-player-search-status { flex:1; color:#bbb; }
      #ul-simple-bot .ul-simple-search-warning { margin-top:5px; color:#ffcb70; }
      #ul-simple-bot #ul-simple-combat-status { margin:7px 0 4px; color:#ffb7b7; }
      #ul-simple-bot .ul-simple-player-actions-head, #ul-simple-bot .ul-simple-player-action-row { display:grid; grid-template-columns:minmax(0,1fr) 30px 34px 54px; gap:3px; align-items:center; }
      #ul-simple-bot .ul-simple-player-actions-head { padding:3px; color:#999; font-size:10px; text-align:center; }
      #ul-simple-bot .ul-simple-player-actions-head span:first-child { text-align:left; }
      #ul-simple-bot #ul-simple-player-actions { max-height:150px; overflow:auto; border:1px solid #333; }
      #ul-simple-bot .ul-simple-player-action-row { padding:4px; border-bottom:1px solid #292929; }
      #ul-simple-bot .ul-simple-player-action-row:last-child { border-bottom:0; }
      #ul-simple-bot .ul-simple-player-action-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #ul-simple-bot .ul-simple-player-action-name small { display:block; color:#888; }
      #ul-simple-bot .ul-simple-player-action-row input { justify-self:center; }
      #ul-simple-bot .ul-simple-player-mode { width:54px; font-size:10px; }
      #ul-simple-bot .ul-simple-login-note { margin-bottom:8px; padding:6px; border:1px solid #3a4c5d; background:#111a22; color:#b9cedd; }
      #ul-simple-bot .ul-simple-login-label { display:block; margin:6px 0 3px; color:#bbb; }
      #ul-simple-bot .ul-simple-login-input { display:block; width:100%; padding:5px; color:#eee; background:#0d0d0d; border:1px solid #555; }
      #ul-simple-bot .ul-simple-login-auto { display:flex; gap:5px; align-items:center; margin:8px 0; color:#ddd; }
      #ul-simple-bot .ul-simple-login-settings-actions { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:7px; }
      #ul-simple-bot #ul-simple-login-status { padding:5px; border:1px solid #333; background:#171717; color:#9fd5ff; }
      #ul-simple-bot .ul-simple-pacing { color:#bbb; margin-bottom:12px; }
      #ul-simple-bot [data-tab-panel="quicktrade"] { max-height:min(500px,65vh); overflow-y:auto; }
      #ul-simple-bot [data-tab-panel="restart"] { max-height:min(500px,65vh); overflow-y:auto; }
      #ul-simple-bot .ul-simple-restart-option { display:block; margin:7px 0; }
      #ul-simple-bot .ul-simple-restart-note { color:#bbb; font-size:11px; line-height:1.4; margin:7px 0; }
      #ul-simple-bot #ul-simple-restart-names { box-sizing:border-box; width:100%; color:#eee; background:#181818; border:1px solid #555; resize:vertical; }
      #ul-simple-bot .ul-simple-restart-buttons { display:flex; flex-wrap:wrap; gap:5px; }
      #ul-simple-bot #ul-simple-restart-status { margin:7px 0; overflow-wrap:anywhere; }
      #ul-simple-bot .ul-simple-qt-label { display:block; margin:6px 0; color:#bbb; }
      #ul-simple-bot .ul-simple-qt-label input, #ul-simple-bot .ul-simple-qt-label select { display:block; width:100%; box-sizing:border-box; padding:5px; color:#eee; background:#0d0d0d; border:1px solid #555; }
      #ul-simple-bot .ul-simple-qt-note { color:#aaa; font-size:11px; margin:7px 0; }
      #ul-simple-bot .ul-simple-qt-rule { padding:7px 0; border-bottom:1px solid #444; overflow-wrap:anywhere; }
      #ul-simple-bot .ul-simple-qt-rule small { display:block; margin:4px 0; }
      #ul-simple-bot .ul-simple-qt-rule button { margin-right:5px; }
      #ul-simple-bot #ul-simple-qt-status { color:#ffd36b; margin:8px 0; overflow-wrap:anywhere; }
      #ul-simple-bot #ul-simple-last { padding:6px; background:#191919; border:1px solid #333; color:#ddd; }
      #ul-simple-bot #ul-simple-logs { max-height:86px; overflow:auto; margin-top:5px; color:#aaa; }
      #ul-simple-bot .ul-simple-log { padding:2px 0; border-bottom:1px dotted #333; }
      #ul-simple-bot .ul-simple-log.ok { color:#91df91; }
      #ul-simple-bot .ul-simple-log.warn { color:#ffd36b; }
      #ul-simple-bot .ul-simple-log.error { color:#ff9090; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(host);

    const toggle = host.querySelector('#ul-simple-toggle');
    const crimes = host.querySelector('#ul-simple-crimes');
    const gta = host.querySelector('#ul-simple-gta');
    const jailBust = host.querySelector('#ul-simple-jailbust');
    const melt = host.querySelector('#ul-simple-melt');
    const drugs = host.querySelector('#ul-simple-drugs');
    const autoRank = host.querySelector('#ul-simple-auto-rank');
    const discoverPlayers = host.querySelector('#ul-simple-discover-players');
    const searchPlayers = host.querySelector('#ul-simple-search-players');
    const beamTravel = host.querySelector('#ul-simple-beam-travel');
    const playerList = host.querySelector('#ul-simple-player-list');
    const savePlayerList = host.querySelector('#ul-simple-save-player-list');
    const meltCommon = host.querySelector('#ul-simple-melt-common');
    const meltRare = host.querySelector('#ul-simple-melt-rare');
    const meltTuners = host.querySelector('#ul-simple-melt-tuners');
    const repairBeforeMelt = host.querySelector('#ul-simple-repair-before-melt');
    const drugRepairDamage = host.querySelector('#ul-simple-drug-repair-damage');
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    const collapse = host.querySelector('#ul-simple-collapse');
    const body = host.querySelector('#ul-simple-body');
    const openLoginTab = host.querySelector('#ul-simple-open-login-tab');
    const loginEmail = host.querySelector('#ul-simple-login-email');
    const loginPassword = host.querySelector('#ul-simple-login-password');
    const loginAuto = host.querySelector('#ul-simple-login-auto');
    const loginSave = host.querySelector('#ul-simple-login-save');
    const loginClear = host.querySelector('#ul-simple-login-clear');
    const loginRetry = host.querySelector('#ul-simple-login-retry');
    const cancelLogin = host.querySelector('#ul-simple-cancel-login');

    for (const tab of host.querySelectorAll('.ul-simple-tab')) {
      tab.addEventListener('click', () => {
        const nextTab = String(tab.dataset.tab || '');
        if (!['actions', 'cars', 'players', 'quicktrade', 'restart', 'login', 'logs'].includes(nextTab)) return;
        state.uiTab = nextTab;
        sessionStorage.setItem(UI_TAB_KEY, nextTab);
        render();
      });
    }

    bindQuicktradePanel(host);
    bindRestartPanel(host);
    toggle.addEventListener('click', () => saveSettings({ enabled: state.restartProgress.active ? false : !state.settings.enabled }));
    crimes.addEventListener('change', () => {
      saveSettings({ crimes: crimes.checked });
      state.crimesDueAt = 0;
    });
    gta.addEventListener('change', () => {
      saveSettings({ gta: gta.checked });
      state.gtaDueAt = 0;
    });
    jailBust.addEventListener('change', () => {
      saveSettings({ jailBust: jailBust.checked });
      state.jailBustCandidate = null;
      state.jailBustDueAt = 0;
      state.jailDueAt = 0;
    });
    melt.addEventListener('change', () => {
      saveSettings({ melt: melt.checked });
      state.meltDueAt = 0;
    });
    drugs.addEventListener('change', () => {
      saveSettings({ drugs: drugs.checked });
      state.drugContextLoaded = false;
      state.drugFavouriteCarId = null;
      state.drugsDueAt = 0;
    });
    autoRank.addEventListener('change', () => {
      saveSettings({ autoRank: autoRank.checked });
      state.autoRankDueAt = 0;
      if (!autoRank.checked) state.autoRankStatus = 'Auto-renew disabled';
    });
    discoverPlayers.addEventListener('change', () => {
      saveSettings({ discoverPlayers: discoverPlayers.checked });
      state.playerDiscoveryDueAt = 0;
      state.gangDiscoveryDueAt = 0;
      state.jailDueAt = 0;
      state.playerDiscoveryStatus = discoverPlayers.checked
        ? `${state.playerNames.length.toLocaleString('en-GB')} players collected`
        : 'Player discovery disabled';
    });
    searchPlayers.addEventListener('change', () => {
      saveSettings({ searchPlayers: searchPlayers.checked });
      state.playerSearchDueAt = 0;
      state.playerSearchStatus = searchPlayers.checked ? 'Waiting to check kill-page searches' : 'Player searching disabled';
    });
    beamTravel.addEventListener('change', () => {
      saveSettings({ beamTravelMode: beamTravel.value });
      state.combatDueAt = 0;
    });
    savePlayerList.addEventListener('click', () => {
      replacePlayerNames(String(playerList.value || '').split(/\r?\n|,/), 'Player list saved');
    });
    host.querySelector('#ul-simple-player-actions').addEventListener('change', (event) => {
      const control = event.target;
      const row = control && control.closest ? control.closest('.ul-simple-player-action-row') : null;
      const name = row && row.dataset ? row.dataset.player : '';
      const key = normalisePlayerName(name);
      if (!key) return;
      const current = playerAction(name);
      if (control.classList.contains('ul-simple-player-kill')) {
        state.playerActions[key] = { ...current, kill: control.checked };
      } else if (control.classList.contains('ul-simple-player-beam')) {
        for (const [otherKey, action] of Object.entries(state.playerActions)) {
          if (action.beam) state.playerActions[otherKey] = { ...action, beam: false };
        }
        state.playerActions[key] = { ...current, beam: control.checked };
        state.activeBodyguard = null;
        state.drugContextLoaded = false;
        state.beamTravelRefreshPending = false;
      } else if (control.classList.contains('ul-simple-player-mode')) {
        state.playerActions[key] = { ...current, beamMode: control.value === 'kill' ? 'kill' : 'one' };
      }
      savePlayerActions();
    });
    meltCommon.addEventListener('change', () => {
      saveSettings({ meltCommon: meltCommon.checked });
      state.meltDueAt = 0;
    });
    meltRare.addEventListener('change', () => {
      saveSettings({ meltRare: meltRare.checked });
      state.meltDueAt = 0;
    });
    meltTuners.addEventListener('change', () => {
      saveSettings({ meltTuners: meltTuners.checked });
      state.meltDueAt = 0;
    });
    repairBeforeMelt.addEventListener('change', () => {
      saveSettings({ repairBeforeMelt: repairBeforeMelt.checked });
      state.meltDueAt = 0;
    });
    drugRepairDamage.addEventListener('change', () => {
      saveSettings({ drugRepairDamage: drugRepairDamage.value });
      state.drugsDueAt = 0;
    });
    tabMode.addEventListener('click', () => setBotTab(!state.botTab));
    openLoginTab.addEventListener('click', () => {
      state.uiTab = 'login';
      sessionStorage.setItem(UI_TAB_KEY, 'login');
      render();
      loginEmail.focus();
    });
    loginSave.addEventListener('click', () => {
      const emailValue = String(loginEmail.value || '').trim();
      const enteredPassword = String(loginPassword.value || '');
      const current = loadLoginCredentials();
      const sameEmail = current.email && current.email.toLocaleLowerCase() === emailValue.toLocaleLowerCase();
      const passwordValue = enteredPassword || (sameEmail ? current.password : '');
      if (!emailValue || !passwordValue) {
        state.loginCredentialStatus = emailValue
          ? 'Enter the password before saving this email'
          : 'Enter an email and password';
        render();
        return;
      }
      saveLocalLoginCredentials(emailValue, passwordValue, loginAuto.checked);
      loginPassword.value = '';
      if (state.authRequired && loginAuto.checked) {
        const recovery = loadLoginRecovery() || state.loginRecovery || saveLoginRecovery('/home');
        const next = updateLoginRecovery({ submittedAt: 0, attemptBlocked: false }) || recovery;
        if (isLoginPage()) void submitSavedLoginOnce(next);
        else ensureLoginRecoveryPage(next);
      }
      render();
    });
    loginClear.addEventListener('click', () => {
      clearLocalLoginCredentials();
      loginEmail.value = '';
      loginPassword.value = '';
      render();
    });
    loginRetry.addEventListener('click', () => {
      if (!retrySavedLogin()) {
        state.loginCredentialStatus = state.authRequired
          ? 'Save a login and enable Auto-login first'
          : 'Retry is only available while login is required';
        render();
      }
    });
    cancelLogin.addEventListener('click', () => {
      saveSettings({ enabled: false });
      state.currentAction = 'Stopped';
      render();
    });
    collapse.addEventListener('click', () => {
      const hidden = body.hidden;
      body.hidden = !hidden;
      collapse.textContent = hidden ? '−' : '+';
    });

    render();
  }

  function render() {
    const host = document.querySelector('#ul-simple-bot');
    if (!host) return;
    renderQuicktradePanel(host);
    renderRestartPanel(host);

    const toggle = host.querySelector('#ul-simple-toggle');
    const loginRecovery = host.querySelector('#ul-simple-login-recovery');
    loginRecovery.hidden = !(state.authRequired && state.loginRecovery && isLoginPage());
    const loginRecoveryText = host.querySelector('#ul-simple-login-recovery-text');
    if (loginRecoveryText) {
      loginRecoveryText.textContent = state.loginCredentials.autoLogin && hasSavedLoginCredentials()
        ? 'Automatic login is configured. If it did not succeed, check the Login tab to update the saved details or retry.'
        : 'Login required. Save credentials in the Login tab for automatic recovery, or use the normal game login form manually.';
    }
    const loginEmail = host.querySelector('#ul-simple-login-email');
    const loginPassword = host.querySelector('#ul-simple-login-password');
    const loginAuto = host.querySelector('#ul-simple-login-auto');
    const loginStatus = host.querySelector('#ul-simple-login-status');
    if (document.activeElement !== loginEmail) loginEmail.value = state.loginCredentials.email || '';
    loginPassword.placeholder = state.loginCredentials.password ? 'Saved locally — enter a new password to change it' : 'Enter password to save/change';
    loginAuto.checked = state.loginCredentials.autoLogin === true;
    loginStatus.textContent = state.loginCredentialStatus || (hasSavedLoginCredentials()
      ? `${state.loginCredentials.autoLogin ? 'Auto-login enabled' : 'Login saved; auto-login disabled'} · password stored locally in Tampermonkey`
      : 'No login saved');
    const loginRetryBlockedUntil = Number(state.loginRecovery && state.loginRecovery.retryAfterUntil) || 0;
    host.querySelector('#ul-simple-login-retry').disabled = !(state.authRequired && state.loginCredentials.autoLogin && hasSavedLoginCredentials()) || loginRetryBlockedUntil > Date.now();
    toggle.textContent = state.restartProgress.active ? 'Stop' : state.stoppedForDeath ? 'Restart bot' : state.settings.enabled ? 'Stop' : 'Start';
    toggle.title = state.stoppedForDeath
      ? 'After restarting your character, press here to recheck and resume the saved modules'
      : '';
    toggle.classList.toggle('running', state.settings.enabled && !state.stoppedForDeath);
    for (const tab of host.querySelectorAll('.ul-simple-tab')) {
      const active = tab.dataset.tab === state.uiTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of host.querySelectorAll('.ul-simple-tab-panel')) {
      panel.hidden = panel.dataset.tabPanel !== state.uiTab;
    }
    const showActiveSelections = !state.stoppedForDeath;
    host.querySelector('#ul-simple-crimes').checked = showActiveSelections && state.settings.crimes;
    host.querySelector('#ul-simple-gta').checked = showActiveSelections && state.settings.gta;
    host.querySelector('#ul-simple-jailbust').checked = showActiveSelections && state.settings.jailBust;
    host.querySelector('#ul-simple-melt').checked = showActiveSelections && state.settings.melt;
    host.querySelector('#ul-simple-drugs').checked = showActiveSelections && state.settings.drugs;
    host.querySelector('#ul-simple-auto-rank').checked = showActiveSelections && state.settings.autoRank;
    host.querySelector('#ul-simple-discover-players').checked = showActiveSelections && state.settings.discoverPlayers;
    host.querySelector('#ul-simple-search-players').checked = showActiveSelections && state.settings.searchPlayers;
    host.querySelector('#ul-simple-beam-travel').value = state.settings.beamTravelMode;
    host.querySelector('#ul-simple-melt-common').checked = state.settings.meltCommon;
    host.querySelector('#ul-simple-melt-common').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-melt-rare').checked = state.settings.meltRare;
    host.querySelector('#ul-simple-melt-rare').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-melt-tuners').checked = state.settings.meltTuners;
    host.querySelector('#ul-simple-melt-tuners').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-repair-before-melt').checked = state.settings.repairBeforeMelt;
    host.querySelector('#ul-simple-repair-before-melt').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-drug-repair-damage').value = String(state.settings.drugRepairDamage);
    host.querySelector('#ul-simple-drug-repair-damage').disabled = !state.settings.drugs;
    host.querySelector('#ul-simple-drug-status').textContent = state.settings.drugs ? state.drugStatus : 'Drug run disabled';
    host.querySelector('#ul-simple-auto-rank-status').textContent = state.settings.autoRank || /Tier 1 is not unlocked/.test(state.autoRankStatus)
      ? state.autoRankStatus
      : 'Auto-renew disabled';
    host.querySelector('#ul-simple-player-status').textContent = state.settings.discoverPlayers
      ? state.playerDiscoveryStatus
      : `Discovery disabled · ${state.playerNames.length.toLocaleString('en-GB')} saved`;
    host.querySelector('#ul-simple-player-search-status').textContent = state.settings.searchPlayers
      ? state.playerSearchStatus
      : 'Player searching disabled';
    host.querySelector('#ul-simple-combat-status').textContent = state.combatStatus;
    const playerList = host.querySelector('#ul-simple-player-list');
    if (document.activeElement !== playerList) playerList.value = state.playerNames.join('\n');
    renderPlayerActions(host.querySelector('#ul-simple-player-actions'));
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    tabMode.textContent = state.botTab ? 'Release bot tab' : 'Use as bot tab';
    tabMode.classList.toggle('active', state.botTab);
    for (const control of host.querySelectorAll('#ul-simple-body button:not(.ul-simple-tab), #ul-simple-body input, #ul-simple-body textarea, #ul-simple-body select')) {
      control.disabled = !state.botTab;
    }
    host.querySelector('#ul-simple-login-retry').disabled = !state.botTab
      || !(state.authRequired && state.loginCredentials.autoLogin && hasSavedLoginCredentials())
      || loginRetryBlockedUntil > Date.now();
    host.querySelector('#ul-simple-qt-clear-pending').disabled = !state.botTab || state.qtRunning || !state.qt.pending;
    host.querySelector('#ul-simple-qt-refresh').disabled = !state.botTab || state.qtCatalogRunning;
    host.querySelector('#ul-simple-restart-retry').disabled = !state.botTab || !state.restart.enabled || state.restartRunning
      || !(state.restartProgress.active || state.stoppedForDeath || state.restartProgress.pending);
    for (const id of [
      '#ul-simple-crimes',
      '#ul-simple-gta',
      '#ul-simple-jailbust',
      '#ul-simple-melt',
      '#ul-simple-drugs',
      '#ul-simple-auto-rank',
      '#ul-simple-discover-players',
      '#ul-simple-search-players',
    ]) {
      host.querySelector(id).disabled = !state.botTab || state.stoppedForDeath;
    }
    for (const mode of host.querySelectorAll('.ul-simple-player-mode')) {
      const row = mode.closest('.ul-simple-player-action-row');
      mode.disabled = !state.botTab || state.stoppedForDeath || !row || !playerAction(row.dataset.player).beam;
    }
    if (state.botTab) {
      host.querySelector('#ul-simple-melt-common').disabled = state.stoppedForDeath || !state.settings.melt;
      host.querySelector('#ul-simple-melt-rare').disabled = state.stoppedForDeath || !state.settings.melt;
      host.querySelector('#ul-simple-melt-tuners').disabled = state.stoppedForDeath || !state.settings.melt;
      host.querySelector('#ul-simple-repair-before-melt').disabled = state.stoppedForDeath || !state.settings.melt;
      host.querySelector('#ul-simple-drug-repair-damage').disabled = state.stoppedForDeath || !state.settings.drugs;
    }
    host.querySelector('#ul-simple-status').textContent = state.currentAction;
    host.querySelector('#ul-simple-last').textContent = `Last: ${state.lastAction}`;

    const logs = host.querySelector('#ul-simple-logs');
    logs.textContent = '';
    for (const row of state.logs) {
      const line = document.createElement('div');
      line.className = `ul-simple-log ${row.level}`;
      line.textContent = `${new Date(row.at).toLocaleTimeString('en-GB')} · ${row.text}`;
      logs.appendChild(line);
    }
  }

  function bindRestartPanel(host) {
    const get = (name) => host.querySelector(`#ul-simple-restart-${name}`);
    get('names').addEventListener('input', () => { get('names').dataset.dirty = 'true'; });
    get('enabled').addEventListener('change', () => {
      saveRestart({ enabled: get('enabled').checked });
      if (state.restart.enabled && state.stoppedForDeath && !state.restartProgress.active) armRestart();
      restartTick();
    });
    get('retrieve').addEventListener('change', () => { saveRestart({ retrieveAssets: get('retrieve').checked }); restartTick(); });
    get('generate').addEventListener('click', () => {
      const existing = get('names').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const count = Math.min(100, Math.max(0, 1000 - existing.length));
      get('names').value = [...existing, ...generateRestartNames(existing, count)].join('\n');
      get('names').dataset.dirty = 'true';
      get('status').textContent = `Added ${count} suggestions. Edit if you wish, then save the list.`;
    });
    get('save').addEventListener('click', () => {
      const usernames = get('names').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const bad = usernames.find((name) => !validRestartName(name));
      if (bad || usernames.length > 1000) {
        get('status').textContent = bad ? `Invalid username: ${bad}. Use 2–20 allowed characters.` : 'Maximum 1,000 usernames.';
        return;
      }
      get('names').dataset.dirty = '';
      saveRestart({ usernames }); restartTick();
    });
    get('retry').addEventListener('click', retryRestart);
  }

  function renderRestartPanel(host) {
    const get = (name) => host.querySelector(`#ul-simple-restart-${name}`);
    get('enabled').checked = state.restart.enabled;
    get('retrieve').checked = state.restart.retrieveAssets;
    if (get('names').dataset.dirty !== 'true' && document.activeElement !== get('names')) get('names').value = state.restart.usernames.join('\n');
    const p = state.restartProgress;
    get('status').textContent = p.active ? p.message || 'Checking restart'
      : `${state.restart.enabled ? 'Automatic restart enabled' : 'Automatic restart disabled'} · ${state.restart.usernames.length} names saved${p.message ? ` · ${p.message}` : ''}`;
  }

  function bindQuicktradePanel(host) {
    const get = (name) => host.querySelector(`#ul-simple-qt-${name}`);
    for (const name of ['point-price', 'point-quantity']) {
      get(name).addEventListener('input', () => { get(name).dataset.dirty = 'true'; });
    }
    get('points').addEventListener('change', () => saveQuicktrade({ pointsEnabled: get('points').checked }));
    get('perks').addEventListener('change', () => saveQuicktrade({ perksEnabled: get('perks').checked }));
    get('refresh').addEventListener('click', () => { void refreshQtCatalog(); });
    get('save-points').addEventListener('click', () => {
      const price = qtInteger(get('point-price').value);
      const quantity = qtInteger(get('point-quantity').value);
      if (price === '0' || (quantity === '0' && get('point-quantity').value.trim() !== '0')) {
        state.qtStatus = 'Enter a positive whole cash price and a whole quantity (0 stops purchases). Commas are allowed.';
        render(); return;
      }
      get('point-price').dataset.dirty = '';
      get('point-quantity').dataset.dirty = '';
      state.qtStatus = 'Points limits saved';
      saveQuicktrade({ pointsMaxPrice: price, pointsRemaining: quantity }, 'points');
    });
    get('save-rule').addEventListener('click', () => {
      const label = get('perk-name').value.trim();
      const currency = get('currency').value;
      const price = qtInteger(get('perk-price').value);
      const quantity = qtInteger(get('perk-quantity').value);
      if (!label || price === '0' || quantity === '0' || !['money', 'points'].includes(currency)) {
        state.qtStatus = 'Enter an exact perk name, a positive whole listing price and a positive quantity.';
        render(); return;
      }
      const existing = state.qt.rules.find((r) => r.label === label && r.currency === currency);
      if (!existing && state.qt.rules.length >= 100) {
        state.qtStatus = 'Remove an old rule before adding more (100 maximum).'; render(); return;
      }
      const rule = { id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label, currency, maxPrice: price, remaining: quantity, enabled: true };
      const rules = existing ? state.qt.rules.map((r) => r.id === existing.id ? rule : r) : [...state.qt.rules, rule];
      state.qtStatus = 'Perk rule saved';
      saveQuicktrade({ rules }, rule.id);
    });
    get('clear-pending').addEventListener('click', () => {
      if (state.qtRunning) return;
      state.qtStatus = state.qt.pending?.kind === 'swiss'
        ? 'Quicktrade resumed. Cash/Swiss balances will be read again; no purchase quantity was deducted.'
        : 'Quicktrade resumed. Reserved quantity remains deducted; adjust it if the purchase failed.';
      saveQuicktrade({ pending: null });
    });
  }

  function renderQuicktradePanel(host) {
    const get = (name) => host.querySelector(`#ul-simple-qt-${name}`);
    get('points').checked = state.qt.pointsEnabled;
    get('perks').checked = state.qt.perksEnabled;
    for (const [name, value] of [['point-price', state.qt.pointsMaxPrice], ['point-quantity', state.qt.pointsRemaining]]) {
      if (get(name).dataset.dirty !== 'true' && document.activeElement !== get(name)) get(name).value = value;
    }
    get('point-summary').textContent = `Saved: up to $${BigInt(state.qt.pointsMaxPrice).toLocaleString('en-GB')}/point · ${BigInt(state.qt.pointsRemaining).toLocaleString('en-GB')} points remaining`;
    const catalog = [...new Set([...state.qtCatalog, ...state.qt.rules.map((r) => r.label)])];
    const catalogSignature = JSON.stringify(catalog);
    if (get('catalog').dataset.signature !== catalogSignature) {
      get('catalog').replaceChildren(...catalog.map((label) => {
        const option = document.createElement('option'); option.value = label; return option;
      }));
      get('catalog').dataset.signature = catalogSignature;
    }
    const rulesSignature = JSON.stringify(state.qt.rules);
    if (get('rules').dataset.signature !== rulesSignature) {
      get('rules').replaceChildren(...state.qt.rules.map((rule) => {
        const row = document.createElement('div'); row.className = 'ul-simple-qt-rule';
        const label = document.createElement('label');
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = rule.enabled;
        toggle.addEventListener('change', () => saveQuicktrade({ rules: state.qt.rules.map((r) => r.id === rule.id ? { ...r, enabled: toggle.checked } : r) }));
        label.append(toggle, ` ${rule.label}`);
        const details = document.createElement('small');
        details.textContent = `${rule.currency === 'money' ? '$' : ''}${BigInt(rule.maxPrice).toLocaleString('en-GB')}${rule.currency === 'points' ? ' points' : ''} max/listing · ${rule.remaining} remaining`;
        const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
        edit.addEventListener('click', () => {
          get('perk-name').value = rule.label; get('currency').value = rule.currency;
          get('perk-price').value = rule.maxPrice; get('perk-quantity').value = rule.remaining;
          get('perk-price').focus();
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove';
        remove.addEventListener('click', () => saveQuicktrade({ rules: state.qt.rules.filter((r) => r.id !== rule.id) }));
        row.append(label, details, edit, remove); return row;
      }));
      get('rules').dataset.signature = rulesSignature;
    }
    get('status').textContent = state.qt.pending
      ? (state.qt.pending.kind === 'swiss'
        ? (state.qtRunning ? 'Withdrawing purchase shortfall from Swiss…' : 'Swiss withdrawal unconfirmed. Check your bank before resuming; no purchase quantity was deducted.')
        : (state.qtRunning ? 'Purchase in progress…' : 'Purchase unconfirmed. Check your game transactions and remaining quantities before resuming.'))
      : state.qtStatus;
    get('clear-pending').hidden = !state.qt.pending || state.qtRunning;
  }

  function renderPlayerActions(container) {
    const data = state.killData && state.killDataLoadedAt >= state.searchDataLoadedAt ? state.killData : state.searchData || state.killData;
    const killRows = data
      ? [...(Array.isArray(data.pending) ? data.pending : []), ...(Array.isArray(data.found) ? data.found : [])]
      : [];
    const signature = JSON.stringify([
      state.botTab,
      state.playerNames,
      state.playerActions,
      killRows.map((row) => [row.username, row.secondsUntilFound, row.secondsRemaining, row.location]),
    ]);
    if (container.dataset.renderSignature === signature) return;
    container.dataset.renderSignature = signature;
    const focused = document.activeElement;
    const focusedKey = focused && focused.closest && focused.closest('.ul-simple-player-action-row')
      ? normalisePlayerName(focused.closest('.ul-simple-player-action-row').dataset.player)
      : '';
    const fragment = document.createDocumentFragment();
    const { pending, found } = killMaps(data || {});
    for (const name of state.playerNames) {
      const key = normalisePlayerName(name);
      const action = playerAction(name);
      const pendingRow = pending.get(key);
      const foundRow = found.get(key);
      const status = foundRow
        ? `${Math.max(0, Number(foundRow.secondsRemaining) || 0)}s · ${foundRow.location || '?'}`
        : pendingRow
          ? `Finding · ${Math.max(0, Number(pendingRow.secondsUntilFound) || 0)}s`
          : 'Not searched';
      const row = document.createElement('div');
      row.className = 'ul-simple-player-action-row';
      row.dataset.player = name;

      const label = document.createElement('span');
      label.className = 'ul-simple-player-action-name';
      label.textContent = name;
      const small = document.createElement('small');
      small.textContent = status;
      label.appendChild(small);

      const kill = document.createElement('input');
      kill.type = 'checkbox';
      kill.className = 'ul-simple-player-kill';
      kill.checked = action.kill;
      kill.title = `Kill ${name} when found here and enough bullets are held`;

      const beam = document.createElement('input');
      beam.type = 'checkbox';
      beam.className = 'ul-simple-player-beam';
      beam.checked = action.beam;
      beam.title = `Actively follow and Beam ${name}; only one Beam target can be selected`;

      const mode = document.createElement('select');
      mode.className = 'ul-simple-player-mode';
      mode.title = 'Beam shot size';
      for (const [value, text] of [['one', '1 bullet'], ['kill', 'Full kill']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        mode.appendChild(option);
      }
      mode.value = action.beamMode;
      mode.disabled = !state.botTab || !action.beam;
      row.append(label, kill, beam, mode);
      fragment.appendChild(row);
    }
    if (!state.playerNames.length) {
      const empty = document.createElement('div');
      empty.className = 'ul-simple-player-action-row';
      empty.textContent = 'No players saved';
      fragment.appendChild(empty);
    }
    container.replaceChildren(fragment);
    if (focusedKey) {
      const matching = [...container.querySelectorAll('.ul-simple-player-action-row')]
        .find((row) => normalisePlayerName(row.dataset.player) === focusedKey);
      const selector = focused && focused.classList.contains('ul-simple-player-mode')
        ? '.ul-simple-player-mode'
        : focused && focused.classList.contains('ul-simple-player-beam')
          ? '.ul-simple-player-beam'
          : '.ul-simple-player-kill';
      if (matching) matching.querySelector(selector)?.focus();
    }
  }

  function setBotTab(enabled) {
    if (!enabled) { state.generation += 1; clearLoginRecovery(); cancelRestart(); }
    state.botTab = enabled;
    sessionStorage.setItem(BOT_TAB_KEY, enabled ? 'true' : 'false');
    savePerTabState();
    if (enabled) {
      state.currentAction = 'Waiting for controller lock';
      startControllerElection();
    } else {
      if (state.releaseController) state.releaseController();
      state.controller = false;
      state.currentAction = 'Play tab — automation inactive';
    }
    render();
    requestSchedulerWake();
  }

  async function becomeController() {
    if (!state.botTab) return;
    state.controller = true;
    state.currentAction = state.settings.enabled ? 'Controller active' : 'Stopped';
    wakeAll();
    render();
    await new Promise((resolve) => {
      state.releaseController = resolve;
    });
    state.releaseController = null;
    state.controller = false;
    state.generation += 1;
    refreshIdleStatus();
  }

  function startControllerElection() {
    if (!state.botTab || state.controllerLockRequested || state.controller) return;
    state.controllerLockRequested = true;
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      void navigator.locks.request(
        CONTROLLER_LOCK,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            state.botTab = false;
            sessionStorage.setItem(BOT_TAB_KEY, 'false');
            savePerTabState();
            state.currentAction = 'Play tab — another bot tab is active';
            render();
            return;
          }
          await becomeController();
        },
      ).catch((error) => {
        if (!error || error.name !== 'AbortError') log(`Controller lock: ${error.message || error}`, 'error');
      }).finally(() => {
        state.controllerLockRequested = false;
      });
      return;
    }

    // The selected-tab mode still keeps ordinary play tabs inactive in older
    // browsers. Web Locks additionally prevent two tabs being selected at once.
    state.currentAction = 'Controller active (single-tab mode)';
    void becomeController().finally(() => {
      state.controllerLockRequested = false;
    });
  }

  GM_addValueChangeListener(SETTINGS_KEY, (_name, _oldValue, newValue, remote) => {
    if (!remote) return;
    const nextSettings = sanitiseSettings({ ...DEFAULT_SETTINGS, ...(newValue || {}) });
    const starting = nextSettings.enabled && !state.settings.enabled;
    if (!nextSettings.enabled && state.settings.enabled) state.generation += 1;
    const wasStoppedForDeath = state.stoppedForDeath;
    state.settings = nextSettings;
    if (starting) prepareRuntimeForStart(wasStoppedForDeath);
    else if (state.settings.enabled) wakeAll();
    render();
    requestSchedulerWake();
  });

  GM_addValueChangeListener(QT_KEY, (_name, _oldValue, newValue, remote) => {
    if (!remote) return;
    state.qt = sanitiseQuicktrade(newValue);
    state.qtRevision += 1;
    state.qtDueAt = 0;
    render();
    requestSchedulerWake();
  });

  GM_addValueChangeListener(RESTART_KEY, (_name, _oldValue, newValue, remote) => {
    if (!remote) return;
    state.restart = sanitiseRestart(newValue);
    state.restartRevision += 1;
    if (!state.restart.enabled) state.generation += 1;
    render();
  });

  GM_addValueChangeListener(RESTART_PROGRESS_KEY, (_name, _oldValue, newValue, remote) => {
    if (!remote) return;
    state.restartProgress = sanitiseRestartProgress(newValue);
    if (!state.restartProgress.active) state.generation += 1;
    render(); requestSchedulerWake();
  });

  GM_addValueChangeListener(LOGIN_CREDENTIALS_KEY, (_name, _oldValue, newValue) => {
    state.loginCredentials = sanitiseLoginCredentials(newValue && typeof newValue === 'object' ? newValue : null);
    state.loginCredentialStatus = '';
    render();
  });

  GM_addValueChangeListener(DEATH_STOP_KEY, (_name, _oldValue, newValue, remote) => {
    if (!remote) return;
    state.stoppedForDeath = newValue === true;
    if (state.stoppedForDeath) {
      state.generation += 1;
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
      state.autoRankControls = { crimes: false, gta: false, melt: false };
      state.autoRankMeltCarNames = [];
      state.autoRankMeltNotice = '';
    }
    render();
    requestSchedulerWake();
  });

  GM_addValueChangeListener(PLAYER_LIST_KEY, (_name, _oldValue, newValue) => {
    state.playerNames = sanitisePlayerNames(newValue);
    state.playerDiscoveryStatus = `${state.playerNames.length.toLocaleString('en-GB')} player${state.playerNames.length === 1 ? '' : 's'} collected`;
    if (state.settings.searchPlayers) state.playerSearchDueAt = 0;
    render();
    requestSchedulerWake();
  });

  GM_addValueChangeListener(PLAYER_ACTIONS_KEY, (_name, _oldValue, newValue) => {
    state.playerActions = sanitisePlayerActions(newValue);
    state.playerSearchDueAt = 0;
    state.combatDueAt = 0;
    render();
    requestSchedulerWake();
  });

  restorePerTabState(() => {
    createPanel();
    startLoginRecoveryWatcher();
    if (state.botTab) startControllerElection();
    startRestartWatcher();
    startSchedulerClock();
  });
})();
