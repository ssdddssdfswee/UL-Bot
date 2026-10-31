// LOCAL CANDIDATE BUILD: 2.2.37 licensed BG defence access and neutral UI labels; not production-tested.
// ==UserScript==
// @name         Underworld Legacy Bot - Licensed Loader
// @namespace    https://underworldlegacy.com/
// @version      2.2.37
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
// @connect      underworldlegacy.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = 'Underworld Legacy Bot';
  const SCRIPT_VERSION = '2.2.37';
  const WORKER_URL = 'https://ul-bot-license.ugarchive.workers.dev';
  const LOADER_UPDATE_URL = 'https://raw.githubusercontent.com/ssdddssdfswee/UL-Bot/main/ul-simple-crimes-gta-v1.0.0.user.js';
  const PLANNER_SOCKET_URL = WORKER_URL.replace(/^http/, 'ws') + '/api/v2/socket';
  const LICENCE_FEATURE = Object.freeze({
    // This capability remains exclusive to the owner's fast-jail licence.
    FAST_JAIL_STREAM: 'fast-jail-stream',
  });
  // Robot bodyguard defence. Values verified against the game source.
  const DEFENCE_REQUEST_TOKEN = Symbol('ul-bg-defence-request');
  const DEFENCE_ROBOT_MAX = 4;                       // BODYGUARD_ROBOT_ACTIVE_MAX / BODYGUARD_SLOT_MAX
  const DEFENCE_ROBOT_PRICES = Object.freeze([250, 400, 550, 700]); // progressive points price
  const DEFENCE_FALLBACK_ROBOT_PRICE = 700;
  const DEFENCE_ROBOT_SHOP_ITEM = 'Special#4';
  const DEFENCE_BASE_ROBOT_RANK = 'Assassin';
  const DEFENCE_BASE_ROBOT_ARMOUR = 'Kevlar Vest';
  const DEFENCE_ARMOUR_FACTORS = Object.freeze({
    None:1, 'Kevlar Vest':1.05, 'Ballistic Vest':1.1, 'Tactical Vest':1.15, 'Plate Carrier':1.2,
    'Heavy Plate Carrier':1.25, 'Level IV Armor':1.35, Juggernaut:1.5,
  });
  const DEFENCE_PERKS_KEPT_FOR_BATCHES = 4;
  const DEFENCE_POLL_MS = 5_000;
  const DEFENCE_IDENTITY_TTL_MS = 60_000;
  const DEFENCE_ROTATION_CHECK_MS = 60_000;
  const DEFENCE_ROTATION_COOLDOWN_MS = 10 * 60_000;
  const DEFENCE_ROTATION_FAILURE_BACKOFF_MS = 30 * 60_000;
  const DEFENCE_SEARCH_RETRY_MS = 15 * 60_000;
  const DEFENCE_SEARCH_RENEW_SECONDS = 2 * 60 * 60;
  const DEFENCE_ENEMY_SEARCH_MS = 150 * 60_000;
  const DEFENCE_HYBRID_LEAD_MS = 15 * 60_000;
  const DEFENCE_JAIL_PAUSE_LEAD_MS = 8 * 60_000;
  const DEFENCE_HYBRID_ALERT_MS = 48 * 60 * 60_000;
  // Prevent duplicate rotations from stale reads. There is deliberately no
  // hourly self-kill budget: survival, not resource conservation, is the goal.
  const DEFENCE_HYBRID_MIN_ROTATION_GAP_MS = 5_000;
  const DEFENCE_HYBRID_COMBAT_SETTLE_MS = 12_000;
  const DEFENCE_MIN_SEARCH_SECONDS = 10 * 60;
  const DEFENCE_REPLACEMENT_COOLDOWN_SECONDS = 30;   // enemy-kill-only replacement cooldown
  // Flights left in the hourly airport quota that Beam may not use, so a
  // concealment rebuild can always reach every robot's country.
  const DEFENCE_FLIGHT_RESERVE = 3;
  // How long a deferred urgent rebuild keeps Beam/Drugs travel paused.
  const DEFENCE_URGENT_LOCK_MS = 60_000;
  // Most own robots killed in one rebuild; the outer guard always survives.
  const DEFENCE_REBUILD_MAX_TARGETS = 3;
  // Upgrades give no protection against unlimited bullets, and the hybrid
  // path always shoots the prepared (maximum-armour) bullet count.
  const DEFENCE_ROTATE_UPGRADED = true;
  const DEFENCE_ROTATION_ROUTES = new Set(['/api/kill/search', '/api/kill/prepare', '/api/kill/shoot', '/api/airport/fly', '/api/drugs/drive']);
  const DEFENCE_REPLACEMENT_ROUTES = new Set(['/api/points/buy', '/api/perks/redeem']);
  const PLANNER_KEEPALIVE_MS = 30_000;
  const PLANNER_REQUEST_TIMEOUT_MS = 15_000;
  const PLANNER_RECONNECT_MAX_MS = 15_000;
  const SESSION_REFRESH_MARGIN_MS = 6 * 60_000;
  const LICENCE_RETRY_MAX_MS = 60_000;
  const CONTROLLER_LOCK = 'ul-cloud-bot-controller-v1';
  const CRIME_JAIL_POLL_MS = 5_000;
  const JAIL_BUST_MIN_INTERVAL_MS = 205;
  // Owner fast-stream lane does not impose even spacing. The existing
  // jailBust request bucket remains capped at 5 requests per rolling second,
  // matching the game's flood ceiling while allowing short legal bursts.
  const FAST_JAIL_BUST_MIN_INTERVAL_MS = 0;
  const JAIL_RELEASE_POLL_MS = 3_000;
  const JAIL_RELEASE_CONFIRM_DELAY_MS = 3_000;
  const JAIL_STREAM_FALLBACK_POLL_MS = 2_000;
  const JAIL_POLL_FALLBACK_MS = 1_000;
  // Secondary-session recovery is deliberately conservative because every
  // /api/auth/login call consumes the game's account login-attempt budget.
  // A broken saved credential/session must never spin once per watchdog tick.
  const SECONDARY_LOGIN_WINDOW_MS = 15 * 60_000;
  const SECONDARY_LOGIN_LIMIT = 3;
  const SECONDARY_LOGIN_BACKOFF_BASE_MS = 30_000;
  const SECONDARY_LOGIN_BACKOFF_MAX_MS = 15 * 60_000;
  const SECONDARY_FRESH_SESSION_GRACE_MS = 10_000;
  const ONLINE_DISCOVERY_MS = 2 * 60_000;
  const GANG_DISCOVERY_MS = 10 * 60_000;
  const PRESTIGE_CHECK_MS = 3 * 60_000;
  const SEARCH_MIN_RENEW_LEAD_SECONDS = 30 * 60;
  const SHOOT_WINDOW_MS = 10_000;
  const SHOOT_WINDOW_LIMIT = 49;
  // Beam probes are timed locally, not by one remote planner decision per shot.
  // 215ms is deliberately below 49/10s, and every request still uses the
  // existing route/global limiters. This is a ceiling, not a guaranteed rate.
  const BEAM_PRESSURE_SPACING_MS = 215;
  const BEAM_PRESSURE_BATCH_MS = 8_000;
  // A continuous Beam burst yields whenever other game actions need capacity.
  // Includes locally-dispatched jailbusts (which bypass the global token bucket).
  const BEAM_PRESSURE_TOTAL_HEADROOM_PER_SEC = 11;
  const LOG_HISTORY_LIMIT = 300;
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
    logs: 'ul_cloud_full_logs_v1',
    jailDiagnostics: 'ul_cloud_full_jail_diagnostics_v1',
    secondaryJail: 'ul_cloud_full_secondary_jail_v1',
    defenceRoster: 'ul_cloud_bg_defence_roster_v1',
    defenceAutoRankRestore: 'ul_cloud_bg_defence_auto_rank_restore_v1',
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
    robotDefence: false,
    robotDefenceRotate: false,
    robotDefenceHybridConsent: false,
    robotDefenceHardeningConsent: '',
    robotDefencePointReserve: 1400,
    robotDefenceAccount: '',
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
  // Fast-owner collision avoidance state. The SSE payload is a full snapshot;
  // remember which real inmates were already present so a newly jailed player
  // can be attacked before we fall back to older, more contested inmates.
  let jailLiveSnapshotPrimed = false;
  let jailLivePreviousTargets = new Set();
  let jailLiveFreshTargets = [];
  // Optional owner-only second authenticated stream. This stays entirely in the
  // userscript: it creates one extra normal game session and asks Tampermonkey
  // to attach that session cookie only to the second SSE request. Because nginx
  // hashes ug_session, the second token can land on a different API replica.
  const persistedSecondaryJail = loadSecondaryJailState();
  let jailSecondaryEnabled = persistedSecondaryJail.enabled;
  let jailSecondaryToken = persistedSecondaryJail.token;
  let jailSecondaryUserId = persistedSecondaryJail.userId;
  let jailSecondaryTokenCreatedAt = persistedSecondaryJail.tokenCreatedAt;
  let jailSecondaryLoginAttemptTimes = persistedSecondaryJail.loginAttemptTimes;
  let jailSecondaryLoginBackoffUntil = persistedSecondaryJail.loginBackoffUntil;
  let jailSecondaryLoginBackoffMs = persistedSecondaryJail.loginBackoffMs;
  let jailSecondaryVerifiedMainUserId = '';
  let jailSecondaryRestoreTimer = null;
  let jailSecondaryRequest = null;
  let jailSecondaryReconnectTimer = null;
  let jailSecondaryReconnectDelayMs = 1_000;
  let jailSecondaryReady = false;
  let jailPageExiting = false;
  let jailSecondaryConnectionGeneration = 0;
  let jailRoutingRecent = { primary:[], secondary:[] };
  let jailRoutingFirstSnapshot = { primary:false, secondary:false };
  let jailRoutingMatchedKeys = new Set();
  let jailRoutingCurrentPair = {epoch:0, bothReadyEvents:0, exactMatches:0, nearbySameVersion:0};
  let jailSecondaryLatestInmates = [];
  let jailSecondarySnapshotPrimed = false;
  let jailSecondaryPreviousTargets = new Set();
  let jailRecentAttemptedTargets = new Map();
  // Stale target cooldown is separate from the shared action/request limiters.
  // It never authorises an extra request; fresh jail episodes can re-arm safely.
  const jailStaleTargetBackoff = new Map();
  // Only one real-player bust can be in flight; this is diagnostic context, not a second lane.
  let jailActiveBustSelectedStream = 'none';
  let jailTargetSightings = new Map();
  // Diagnostic-only, anonymous local history. No usernames/tokens or session
  // cookies are exported. Absences are observations, not proof of a bust.
  const JAIL_DIAG_REMOVAL_WINDOW_MS = 10_000;
  const JAIL_DIAG_HISTORY_TTL_MS = 120_000;
  const JAIL_DIAG_HISTORY_MAX = 1_500;
  let jailIndependentStreamEvents = 0;
  let jailIndependentHistory = new Map();
  // v2.2.21: ephemeral per-stream episode metadata; no identities exported.
  let jailCauseEpisodes = { primary:new Map(), secondary:new Map() };
  let jailIndependentMeta = {
    primary: { primed:false, targets:new Set(), receivedAt:0, serverAt:0, version:'', seq:0, lastServerAt:0 },
    secondary: { primed:false, targets:new Set(), receivedAt:0, serverAt:0, version:'', seq:0, lastServerAt:0 },
  };

  // v2.2.22: passive comparison of existing GET /api/jail and existing SSE
  // snapshots. No new HTTP requests, no target-selection influence, no
  // identifying values are persisted or included in copied diagnostics.
  const JAIL_POLL_COMPARE_FRESH_MS = 3_000;
  const JAIL_POLL_COMPARE_PAIR_MS = 15_000;
  const jailPollCompare = {
    poll:{ primed:false, targets:new Set(), receivedAt:0 },
    primary:{ primed:false, targets:new Set(), receivedAt:0 },
    secondary:{ primed:false, targets:new Set(), receivedAt:0 },
  };
  let jailPollCompareSightings = new Map();
  let jailPollCompareEvents = 0;
  let jailPollCompareEpoch = 0;
  let jailSecondarySessionPromise = null;
  let runtimePersistTimer = null;
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
    defenceRunning: false,
    defenceDueAt: 0,
    defenceTravelLock: false,
    defenceTravelLockUntil: 0,
    defenceIdentity: null,
    defenceBindPending: false,
    defenceRotationCheckedAt: 0,
    defenceRotationNote: '',
    defenceJailRiskPauseUntil: 0,
    defenceRestoreRetryAt: 0,
    defenceStatus: 'BG defence disabled',
    defenceRoster: loadDefenceRoster(),

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
    beamPressureLease: null,
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

    logs: loadLogs(),
  };

  const jailDiagnostics = {
    startedAt: Date.now(),
    streamConnectAttempts: 0,
    streamReady: 0,
    streamSuperseded: 0,
    streamErrors: 0,
    inmateEvents: 0,
    inmateEventServerAgeSamples: 0,
    inmateEventServerAgeTotalMs: 0,
    inmateEventServerAgeMaxMs: 0,
    inmateServerGapSamples: 0,
    inmateServerGapTotalMs: 0,
    inmateServerGapMinMs: 0,
    inmateServerGapMaxMs: 0,
    inmateGapLt250: 0,
    inmateGap250To749: 0,
    inmateGap750To1249: 0,
    inmateGap1250To2249: 0,
    inmateGap2250Plus: 0,
    inmateGapNearWholeSecond: 0,
    attemptNearCadence: 0,
    successNearCadence: 0,
    staleNearCadence: 0,
    attemptOffCadence: 0,
    successOffCadence: 0,
    staleOffCadence: 0,
    inmateSourceInitial: 0,
    inmateSourceSignal: 0,
    inmateSourceWatch: 0,
    inmateSourceUnknown: 0,
    attemptSourceInitial: 0,
    successSourceInitial: 0,
    staleSourceInitial: 0,
    attemptSourceSignal: 0,
    successSourceSignal: 0,
    staleSourceSignal: 0,
    attemptSourceWatch: 0,
    successSourceWatch: 0,
    staleSourceWatch: 0,
    attemptSourceUnknown: 0,
    successSourceUnknown: 0,
    staleSourceUnknown: 0,
    eventSequence: 0,
    lastInmateServerAtMs: 0,
    attemptTrace: [],
    liveSnapshotsNoCandidate: 0,
    liveSnapshotsBlockedBusy: 0,
    liveSnapshotsBlockedInJail: 0,
    liveSnapshotsRateDeferred: 0,
    liveBustAttempts: 0,
    liveBustSuccess: 0,
    liveBustStale: 0,
    liveBust429: 0,
    liveBustCaught: 0,
    liveBustOtherErrors: 0,
    liveBustRoundTripSamples: 0,
    liveBustRoundTripTotalMs: 0,
    liveBustRoundTripMaxMs: 0,
    liveFreshTargetsSeen: 0,
    liveFreshSelections: 0,
    liveFallbackSelections: 0,
    liveMultiCandidateSelections: 0,
    liveDispatchPrepSamples: 0,
    liveDispatchPrepTotalMs: 0,
    liveDispatchPrepMaxMs: 0,
    liveQueuedTargetDropped: 0,
    liveStaleBackoffApplied: 0,
    liveNewEpisodeRearmed: 0,
    liveDisconnectedSnapshotDrops: 0,
    liveBurstContinuations: 0,
    liveBusyPrimaryFreshTargets: 0,
    liveBusySecondaryFreshTargets: 0,
    liveSecondaryFreshDuringPrimary: 0,
    liveSecondaryPreferenceOverrides: 0,
    liveEventToDispatchSamples: 0,
    liveEventToDispatchTotalMs: 0,
    liveEventToDispatchMaxMs: 0,
    attemptVisible: 0,
    successVisible: 0,
    staleVisible: 0,
    attemptHidden: 0,
    successHidden: 0,
    staleHidden: 0,
    secondarySessionLoginAttempts: 0,
    secondarySessionLoginSuccess: 0,
    secondarySessionLoginErrors: 0,
    secondaryStreamConnectAttempts: 0,
    secondaryStreamReady: 0,
    secondaryStreamErrors: 0,
    secondaryInmateEvents: 0,
    secondaryFreshTargetsSeen: 0,
    secondaryOnlyFreshTargetsSeen: 0,
    secondaryOnlySelections: 0,
    secondaryOnlySuccess: 0,
    secondaryOnlyStale: 0,
    primaryOnlySelections: 0,
    primaryOnlySuccess: 0,
    primaryOnlyStale: 0,
    bothSeenSelections: 0,
    bothSeenSuccess: 0,
    bothSeenStale: 0,
    firstSeenPrimarySelections: 0,
    firstSeenSecondarySelections: 0,
    firstSeenPrimarySuccess: 0,
    firstSeenSecondarySuccess: 0,
    firstSeenPrimaryStale: 0,
    firstSeenSecondaryStale: 0,
    primaryLeadSamples: 0,
    primaryLeadTotalMs: 0,
    primaryLeadMaxMs: 0,
    secondaryLeadSamples: 0,
    secondaryLeadTotalMs: 0,
    secondaryLeadMaxMs: 0,
    streamLeadTies: 0,
    runtimeReloadRestores: 0,
    jailBustQueueSamples: 0,
    jailBustQueueTotalMs: 0,
    jailBustQueueMaxMs: 0,
    jailBustNetworkSamples: 0,
    jailBustNetworkTotalMs: 0,
    jailBustNetworkMaxMs: 0,
    jailReadSamples: 0,
    jailReadTotalMs: 0,
    jailReadMaxMs: 0,
    streamDiagPrimaryEvents: 0,
    streamDiagSecondaryEvents: 0,
    streamDiagPrimaryServerAgeSamples: 0,
    streamDiagPrimaryServerAgeTotalMs: 0,
    streamDiagPrimaryServerAgeMaxMs: 0,
    streamDiagSecondaryServerAgeSamples: 0,
    streamDiagSecondaryServerAgeTotalMs: 0,
    streamDiagSecondaryServerAgeMaxMs: 0,
    streamDiagPrimaryServerGapSamples: 0,
    streamDiagPrimaryServerGapTotalMs: 0,
    streamDiagPrimaryServerGapMaxMs: 0,
    streamDiagSecondaryServerGapSamples: 0,
    streamDiagSecondaryServerGapTotalMs: 0,
    streamDiagSecondaryServerGapMaxMs: 0,
    streamDiagPrimaryInvalidServerTime: 0,
    streamDiagSecondaryInvalidServerTime: 0,
    streamDiagPrimaryAdditions: 0,
    streamDiagPrimaryRemovals: 0,
    streamDiagSecondaryAdditions: 0,
    streamDiagSecondaryRemovals: 0,
    streamDiagPrimaryReappearAfterSecondaryRemoval: 0,
    streamDiagSecondaryReappearAfterPrimaryRemoval: 0,
    streamDiagPrimarySameStreamReappear: 0,
    streamDiagSecondarySameStreamReappear: 0,
    streamDiagPrimaryDisappearedWhileSecondaryVisible: 0,
    streamDiagSecondaryDisappearedWhilePrimaryVisible: 0,
    streamDiagVersionsEqualAtPrimaryEvent: 0,
    streamDiagVersionsEqualAtSecondaryEvent: 0,
    streamDiagPrimaryOnlyAfterSecondaryRemovalAttempts: 0,
    streamDiagPrimaryOnlyAfterSecondaryRemovalSuccess: 0,
    streamDiagPrimaryOnlyAfterSecondaryRemovalStale: 0,
    streamDiagSecondaryOnlyAfterPrimaryRemovalAttempts: 0,
    streamDiagSecondaryOnlyAfterPrimaryRemovalSuccess: 0,
    streamDiagSecondaryOnlyAfterPrimaryRemovalStale: 0,
    streamDiagTriggeredPrimaryAttempts: 0,
    streamDiagTriggeredSecondaryAttempts: 0,
    streamDiagTriggeredContinuationAttempts: 0,
    streamDiagTriggeredOtherAttempts: 0,
    streamDiagTriggeredPrimarySuccess: 0,
    streamDiagTriggeredSecondarySuccess: 0,
    streamDiagTriggeredContinuationSuccess: 0,
    streamDiagTriggeredOtherSuccess: 0,
    streamDiagTriggeredPrimaryStale: 0,
    streamDiagTriggeredSecondaryStale: 0,
    streamDiagTriggeredContinuationStale: 0,
    streamDiagTriggeredOtherStale: 0,
    streamDiagPrimaryOnlyNoCrossRemovalStale: 0,
    streamDiagSecondaryOnlyNoCrossRemovalStale: 0,
    streamDiagPollBotAttempts: 0,
    streamDiagPollBotSuccess: 0,
    streamDiagPollBotStale: 0,
    streamDiagPollRealAttempts: 0,
    streamDiagPollRealSuccess: 0,
    streamDiagPollRealStale: 0,
    causeDiagPrimaryAttempts: 0,
    causeDiagPrimarySuccess: 0,
    causeDiagPrimaryStale: 0,
    causeDiagPrimaryReportedSecondsTotal: 0,
    causeDiagPrimaryReportedSecondsSamples: 0,
    causeDiagPrimaryFirstSeenAgeTotalMs: 0,
    causeDiagPrimaryFirstSeenAgeSamples: 0,
    causeDiagPrimaryS0to5Attempts: 0,
    causeDiagPrimaryS0to5Success: 0,
    causeDiagPrimaryS0to5Stale: 0,
    causeDiagPrimaryS6to15Attempts: 0,
    causeDiagPrimaryS6to15Success: 0,
    causeDiagPrimaryS6to15Stale: 0,
    causeDiagPrimaryS16to45Attempts: 0,
    causeDiagPrimaryS16to45Success: 0,
    causeDiagPrimaryS16to45Stale: 0,
    causeDiagPrimaryS46to120Attempts: 0,
    causeDiagPrimaryS46to120Success: 0,
    causeDiagPrimaryS46to120Stale: 0,
    causeDiagPrimaryS121plusAttempts: 0,
    causeDiagPrimaryS121plusSuccess: 0,
    causeDiagPrimaryS121plusStale: 0,
    causeDiagPrimarySUnknownAttempts: 0,
    causeDiagPrimarySUnknownSuccess: 0,
    causeDiagPrimarySUnknownStale: 0,
    causeDiagPrimaryFirstSnapshotAttempts: 0,
    causeDiagPrimaryFirstSnapshotSuccess: 0,
    causeDiagPrimaryFirstSnapshotStale: 0,
    causeDiagPrimaryRepeatSnapshotAttempts: 0,
    causeDiagPrimaryRepeatSnapshotSuccess: 0,
    causeDiagPrimaryRepeatSnapshotStale: 0,
    causeDiagPrimaryNoHistoryAttempts: 0,
    causeDiagPrimaryNoHistorySuccess: 0,
    causeDiagPrimaryNoHistoryStale: 0,
    causeDiagPrimaryNotInJailCount: 0,
    causeDiagPrimaryNotFoundCount: 0,
    causeDiagPrimaryDeadCount: 0,
    causeDiagPrimaryOtherStaleCount: 0,
    causeDiagPrimaryOtherErrorCount: 0,
    causeDiagPrimaryCaughtCount: 0,
    causeDiagPrimaryRateLimitCount: 0,
    causeDiagPrimarySuccessCount: 0,
    causeDiagSecondaryAttempts: 0,
    causeDiagSecondarySuccess: 0,
    causeDiagSecondaryStale: 0,
    causeDiagSecondaryReportedSecondsTotal: 0,
    causeDiagSecondaryReportedSecondsSamples: 0,
    causeDiagSecondaryFirstSeenAgeTotalMs: 0,
    causeDiagSecondaryFirstSeenAgeSamples: 0,
    causeDiagSecondaryS0to5Attempts: 0,
    causeDiagSecondaryS0to5Success: 0,
    causeDiagSecondaryS0to5Stale: 0,
    causeDiagSecondaryS6to15Attempts: 0,
    causeDiagSecondaryS6to15Success: 0,
    causeDiagSecondaryS6to15Stale: 0,
    causeDiagSecondaryS16to45Attempts: 0,
    causeDiagSecondaryS16to45Success: 0,
    causeDiagSecondaryS16to45Stale: 0,
    causeDiagSecondaryS46to120Attempts: 0,
    causeDiagSecondaryS46to120Success: 0,
    causeDiagSecondaryS46to120Stale: 0,
    causeDiagSecondaryS121plusAttempts: 0,
    causeDiagSecondaryS121plusSuccess: 0,
    causeDiagSecondaryS121plusStale: 0,
    causeDiagSecondarySUnknownAttempts: 0,
    causeDiagSecondarySUnknownSuccess: 0,
    causeDiagSecondarySUnknownStale: 0,
    causeDiagSecondaryFirstSnapshotAttempts: 0,
    causeDiagSecondaryFirstSnapshotSuccess: 0,
    causeDiagSecondaryFirstSnapshotStale: 0,
    causeDiagSecondaryRepeatSnapshotAttempts: 0,
    causeDiagSecondaryRepeatSnapshotSuccess: 0,
    causeDiagSecondaryRepeatSnapshotStale: 0,
    causeDiagSecondaryNoHistoryAttempts: 0,
    causeDiagSecondaryNoHistorySuccess: 0,
    causeDiagSecondaryNoHistoryStale: 0,
    causeDiagSecondaryNotInJailCount: 0,
    causeDiagSecondaryNotFoundCount: 0,
    causeDiagSecondaryDeadCount: 0,
    causeDiagSecondaryOtherStaleCount: 0,
    causeDiagSecondaryOtherErrorCount: 0,
    causeDiagSecondaryCaughtCount: 0,
    causeDiagSecondaryRateLimitCount: 0,
    causeDiagSecondarySuccessCount: 0,
    causeDiagBothAttempts: 0,
    causeDiagBothSuccess: 0,
    causeDiagBothStale: 0,
    causeDiagBothReportedSecondsTotal: 0,
    causeDiagBothReportedSecondsSamples: 0,
    causeDiagBothFirstSeenAgeTotalMs: 0,
    causeDiagBothFirstSeenAgeSamples: 0,
    causeDiagBothS0to5Attempts: 0,
    causeDiagBothS0to5Success: 0,
    causeDiagBothS0to5Stale: 0,
    causeDiagBothS6to15Attempts: 0,
    causeDiagBothS6to15Success: 0,
    causeDiagBothS6to15Stale: 0,
    causeDiagBothS16to45Attempts: 0,
    causeDiagBothS16to45Success: 0,
    causeDiagBothS16to45Stale: 0,
    causeDiagBothS46to120Attempts: 0,
    causeDiagBothS46to120Success: 0,
    causeDiagBothS46to120Stale: 0,
    causeDiagBothS121plusAttempts: 0,
    causeDiagBothS121plusSuccess: 0,
    causeDiagBothS121plusStale: 0,
    causeDiagBothSUnknownAttempts: 0,
    causeDiagBothSUnknownSuccess: 0,
    causeDiagBothSUnknownStale: 0,
    causeDiagBothFirstSnapshotAttempts: 0,
    causeDiagBothFirstSnapshotSuccess: 0,
    causeDiagBothFirstSnapshotStale: 0,
    causeDiagBothRepeatSnapshotAttempts: 0,
    causeDiagBothRepeatSnapshotSuccess: 0,
    causeDiagBothRepeatSnapshotStale: 0,
    causeDiagBothNoHistoryAttempts: 0,
    causeDiagBothNoHistorySuccess: 0,
    causeDiagBothNoHistoryStale: 0,
    causeDiagBothNotInJailCount: 0,
    causeDiagBothNotFoundCount: 0,
    causeDiagBothDeadCount: 0,
    causeDiagBothOtherStaleCount: 0,
    causeDiagBothOtherErrorCount: 0,
    causeDiagBothCaughtCount: 0,
    causeDiagBothRateLimitCount: 0,
    causeDiagBothSuccessCount: 0,
    causeDiagUnknownAttempts: 0,
    causeDiagUnknownSuccess: 0,
    causeDiagUnknownStale: 0,
    causeDiagUnknownReportedSecondsTotal: 0,
    causeDiagUnknownReportedSecondsSamples: 0,
    causeDiagUnknownFirstSeenAgeTotalMs: 0,
    causeDiagUnknownFirstSeenAgeSamples: 0,
    causeDiagUnknownS0to5Attempts: 0,
    causeDiagUnknownS0to5Success: 0,
    causeDiagUnknownS0to5Stale: 0,
    causeDiagUnknownS6to15Attempts: 0,
    causeDiagUnknownS6to15Success: 0,
    causeDiagUnknownS6to15Stale: 0,
    causeDiagUnknownS16to45Attempts: 0,
    causeDiagUnknownS16to45Success: 0,
    causeDiagUnknownS16to45Stale: 0,
    causeDiagUnknownS46to120Attempts: 0,
    causeDiagUnknownS46to120Success: 0,
    causeDiagUnknownS46to120Stale: 0,
    causeDiagUnknownS121plusAttempts: 0,
    causeDiagUnknownS121plusSuccess: 0,
    causeDiagUnknownS121plusStale: 0,
    causeDiagUnknownSUnknownAttempts: 0,
    causeDiagUnknownSUnknownSuccess: 0,
    causeDiagUnknownSUnknownStale: 0,
    causeDiagUnknownFirstSnapshotAttempts: 0,
    causeDiagUnknownFirstSnapshotSuccess: 0,
    causeDiagUnknownFirstSnapshotStale: 0,
    causeDiagUnknownRepeatSnapshotAttempts: 0,
    causeDiagUnknownRepeatSnapshotSuccess: 0,
    causeDiagUnknownRepeatSnapshotStale: 0,
    causeDiagUnknownNoHistoryAttempts: 0,
    causeDiagUnknownNoHistorySuccess: 0,
    causeDiagUnknownNoHistoryStale: 0,
    causeDiagUnknownNotInJailCount: 0,
    causeDiagUnknownNotFoundCount: 0,
    causeDiagUnknownDeadCount: 0,
    causeDiagUnknownOtherStaleCount: 0,
    causeDiagUnknownOtherErrorCount: 0,
    causeDiagUnknownCaughtCount: 0,
    causeDiagUnknownRateLimitCount: 0,
    causeDiagUnknownSuccessCount: 0,
    pollDiagReads: 0,
    pollDiagRealTargetsTotal: 0,
    pollDiagPrimaryComparableReads: 0,
    pollDiagPrimaryNonComparableReads: 0,
    pollDiagPrimaryBothTargets: 0,
    pollDiagPrimaryPollOnlyTargets: 0,
    pollDiagPrimaryStreamOnlyTargets: 0,
    pollDiagSecondaryComparableReads: 0,
    pollDiagSecondaryNonComparableReads: 0,
    pollDiagSecondaryBothTargets: 0,
    pollDiagSecondaryPollOnlyTargets: 0,
    pollDiagSecondaryStreamOnlyTargets: 0,
    pollDiagPollBeforePrimary: 0,
    pollDiagPrimaryBeforePoll: 0,
    pollDiagPollPrimaryTies: 0,
    pollDiagPollBeforePrimaryLagTotalMs: 0,
    pollDiagPrimaryBeforePollLagTotalMs: 0,
    pollDiagPollBeforeSecondary: 0,
    pollDiagSecondaryBeforePoll: 0,
    pollDiagPollSecondaryTies: 0,
    pollDiagPollBeforeSecondaryLagTotalMs: 0,
    pollDiagSecondaryBeforePollLagTotalMs: 0,
    pollDiagMetricsErrors: 0,
    pollDiagPrimaryPollPresentAttempts: 0,
    pollDiagPrimaryPollPresentSuccess: 0,
    pollDiagPrimaryPollPresentStale: 0,
    pollDiagPrimaryPollAbsentAttempts: 0,
    pollDiagPrimaryPollAbsentSuccess: 0,
    pollDiagPrimaryPollAbsentStale: 0,
    pollDiagPrimaryNoRecentPollAttempts: 0,
    pollDiagPrimaryNoRecentPollSuccess: 0,
    pollDiagPrimaryNoRecentPollStale: 0,
    pollDiagSecondaryPollPresentAttempts: 0,
    pollDiagSecondaryPollPresentSuccess: 0,
    pollDiagSecondaryPollPresentStale: 0,
    pollDiagSecondaryPollAbsentAttempts: 0,
    pollDiagSecondaryPollAbsentSuccess: 0,
    pollDiagSecondaryPollAbsentStale: 0,
    pollDiagSecondaryNoRecentPollAttempts: 0,
    pollDiagSecondaryNoRecentPollSuccess: 0,
    pollDiagSecondaryNoRecentPollStale: 0,
    pollDiagBothPollPresentAttempts: 0,
    pollDiagBothPollPresentSuccess: 0,
    pollDiagBothPollPresentStale: 0,
    pollDiagBothPollAbsentAttempts: 0,
    pollDiagBothPollAbsentSuccess: 0,
    pollDiagBothPollAbsentStale: 0,
    pollDiagBothNoRecentPollAttempts: 0,
    pollDiagBothNoRecentPollSuccess: 0,
    pollDiagBothNoRecentPollStale: 0,
    causeDiagHistoryMissing: 0,
    causeDiagMetricsErrors: 0,
    lastInmateEventAt: 0,
    lastInmateServerTime: '',
    lastBustAt: 0,
    lastBustStatus: '',
    pagehideObserved: 0,
    pagehidePrimaryClosed: 0,
    pagehideSecondaryAborted: 0,
    bfcacheReconnections: 0,
    primaryStreamClosedOnStop: 0,
    secondaryStreamAbortedOnStop: 0,
    primaryStreamReadyAfterRestore: 0,
    secondaryStreamReadyAfterRestore: 0,
    primarySseSupersededLifecycle: 0,
    secondarySseSupersededLifecycle: 0,
    secondaryGmAbortEvents: 0,
    secondaryCookieSetObserved: 0,
    secondaryLoginSameAccountVerified: 0,
    secondarySessionRestoreVerified: 0,
    secondarySessionNewLogin: 0,
    secondaryTokenReusedAcrossReload: 0,
    secondaryLoginTokenRotationObserved: 0,
    routingBothReadySnapshotEvents: 0,
    routingExactBroadcastMatches: 0,
    routingNearbySameVersionEvents: 0,
    routingNearbyDifferentTimestampEvents: 0,
    routingMetricsErrors: 0,
    routingTrace: [],
  };
  restoreJailDiagnosticsFromStorage(jailDiagnostics);
  if (persistedSecondaryJail.enabled && persistedSecondaryJail.token) {
    jailDiagnostics.secondaryTokenReusedAcrossReload += 1;
    jailDiagnostics.routingTrace.push({at:Date.now(), event:'secondary-token', detail:'loaded-saved-session'});
    jailDiagnostics.routingTrace = jailDiagnostics.routingTrace.slice(-48);
  }
  let jailLatestEventMeta = { seq: 0, serverAtMs: 0, serverGapMs: -1, serverAgeMs: -1, nearCadence: false, refreshSource: 'unknown', receivedPerf: 0, hidden: false };

  const requestLimiter = {
    tokens: REQUEST_BURST_CAPACITY,
    lastRefillAt: Date.now(),
    sequence: 0,
    queue: [],
    timer: null,
    buckets: new Map(),
    recentDispatches: [],
  };

  class ActionCancelledError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ActionCancelledError';
      this.cancelled = true;
    }
  }

  ensureDeviceIdentity();
  // pagehide is the reliable lifecycle boundary; beforeunload alone may be cancelled.
  window.addEventListener('pagehide', onJailPagehide, { capture: true });
  window.addEventListener('pageshow', onJailPageshow, { capture: true });
  window.addEventListener('beforeunload', persistReloadState, { capture: true });
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
    void stopSecondaryJailStream({ logout: true });
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
          <div class="ul-simple-card" id="ul-simple-bg-defence-panel" hidden>
            <div class="ul-simple-section-title">Robot Bodyguard Defence</div>
            <div class="ul-simple-option-row"><label><input type="checkbox" id="ul-simple-bg-defence"> Auto-replace with points and batch perks</label></div>
            <div class="ul-simple-option-row"><label><input type="checkbox" id="ul-simple-bg-rotate"> Enable adaptive hybrid defence (searches, selective self-shooting)</label></div>
            <div class="ul-simple-drug-settings">Reserve points <input type="number" id="ul-simple-bg-reserve" min="0" step="100"></div>
            <div class="ul-simple-note">Binds to the game account logged in when you tick Auto-replace. Hybrid mode is off by default. It can shoot selected known inner robots and spend points or perk batches when threatened; it does not promise immortality. Self-searches remove death protection. The bot may travel and pause local Crimes/GTA shortly before a critical defensive action. Auto Rank server Crimes/GTA are NOT automatically paused.</div>
            <div class="ul-simple-option-row"><button type="button" id="ul-simple-bg-trust-inner">Confirm my current slots 1 and 2 have never been exposed</button></div>
            <div class="ul-simple-note">Only click the confirmation if both names have genuinely never been revealed. An incorrect confirmation makes the defence less safe. Requires four robot guards and the bound account.</div>
            <div id="ul-simple-bg-status" class="ul-simple-note">BG defence disabled</div>
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
          <div id="ul-simple-jail-diag-wrap" hidden>
            <div class="ul-simple-section-title">Jail diagnostics</div>
            <div class="ul-simple-login-settings-actions"><button type="button" id="ul-simple-jail-diag-copy">Copy jail diagnostics</button><button type="button" id="ul-simple-jail-diag-reset">Reset diagnostics</button><button type="button" id="ul-simple-jail-secondary-toggle">Start secondary jail stream</button></div>
            <div id="ul-simple-jail-secondary-status" class="ul-simple-note">Secondary stream off · optional owner-only test using one additional normal game session.</div>
            <div class="ul-simple-note">Private fast-jail troubleshooting counters. No licence capabilities are shown to standard users.</div>
          </div>
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
    if (state.collapsed) host.classList.add('collapsed');
    const initialBody = host.querySelector('#ul-simple-body');
    if (initialBody) initialBody.hidden = state.collapsed;
    const initialCollapse = host.querySelector('#ul-simple-collapse');
    if (initialCollapse) initialCollapse.textContent = state.collapsed ? '+' : '−';
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
      'ul-simple-bg-defence':'robotDefence',
      'ul-simple-bg-rotate':'robotDefenceRotate',
    };
    for (const [id,key] of Object.entries(map)) {
      host.querySelector(`#${id}`).addEventListener('change', (event) => {
        if ((key === 'robotDefence' || key === 'robotDefenceRotate') && !hasDefenceLicence()) return;
        state.settings[key] = event.target.checked;
        if (key === 'crimes') state.crimesDueAt = 0;
        if (key === 'gta') state.gtaDueAt = 0;
        if (key === 'jailBust') { state.jailBustDueAt = 0; syncJailStream(); }
        if (['melt','meltCommon','meltRare','meltTuners','repairBeforeMelt'].includes(key)) state.meltDueAt = 0;
        if (key === 'drugs') state.drugsDueAt = 0;
        if (key === 'autoRank') state.autoRankDueAt = 0;
        if (key === 'autoPrestige') { state.prestigeDueAt = 0; state.prestigeComplete = false; }
        if (key === 'autoBuyGun') state.autoGunDueAt = 0;
        if (key === 'robotDefence') {
          // Ticking binds BG defence to the account confirmed on the next run;
          // unticking clears the binding so a re-tick always re-binds.
          state.settings.robotDefenceAccount = '';
          state.defenceBindPending = event.target.checked === true;
          state.defenceIdentity = null;
          state.defenceStatus = event.target.checked ? 'Binding to the logged-in account…' : 'BG defence disabled';
        }
        if (key === 'robotDefenceRotate') { state.settings.robotDefenceHybridConsent = event.target.checked === true; state.settings.robotDefenceHardeningConsent = event.target.checked === true ? SCRIPT_VERSION : ''; state.defenceRotationCheckedAt = 0; }
        if (key === 'robotDefence' || key === 'robotDefenceRotate') state.defenceDueAt = 0;
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
    host.querySelector('#ul-simple-bg-trust-inner').addEventListener('click', async () => {
      if (!automationAllowed() || !defenceEnabled() || !defenceBoundAccount()) {
        log('BG defence: start the bot and bind Auto-replace before confirming hidden guards', 'warn'); return;
      }
      if (!confirm('Confirm that your current robot slots 1 and 2 have NEVER been exposed to another player? This cannot be established automatically.')) return;
      try {
        const owner = await defenceVerifiedOwner(true);
        if (!owner) return;
        const page = await gameJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
        const rows = defenceSlots(page);
        if (rows.length !== 4 || rows[0]?.number !== 1 || rows[1]?.number !== 2 || defenceOccupiedSlots(page).length !== 4) {
          log('BG defence: hidden guard confirmation requires slots 1–4 filled with robots', 'warn'); return;
        }
        observeDefenceSlots(page, owner);
        for (const row of rows.slice(0, 2)) {
          state.defenceRoster.guards[row.name] = {...state.defenceRoster.guards[row.name],known:false,verifiedHidden:true,exposedAt:0,lastSeenAt:Date.now()};
        }
        saveDefenceRoster();
        state.defenceDueAt = 0;
        log('BG defence: marked current slots 1 and 2 as user-confirmed concealed robots', 'ok');
        wakeAutomation(); render();
      } catch (error) { log(`BG defence hidden confirmation: ${friendlyGameError(error)}`, 'error'); }
    });
    host.querySelector('#ul-simple-bg-reserve').addEventListener('change', (event) => {
      state.settings.robotDefencePointReserve = clampInt(event.target.value, 0, 2_147_483_647, 1400);
      saveSettings();
      state.defenceDueAt = 0;
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

    host.querySelector('#ul-simple-login-save').addEventListener('click', async () => {
      const email = String(host.querySelector('#ul-simple-login-email').value || '').trim();
      const entered = String(host.querySelector('#ul-simple-login-password').value || '');
      const old = state.login;
      const password = entered || (old.email.toLowerCase() === email.toLowerCase() ? old.password : '');
      if (!email || !password) {
        state.loginStatus = 'Enter an email and password.';
        renderLogin();
        return;
      }
      const credentialsChanged = old.email.toLowerCase() !== email.toLowerCase() || old.password !== password;
      if (credentialsChanged && (jailSecondaryEnabled || jailSecondaryToken)) {
        await stopSecondaryJailStream({ logout: true });
        log('Secondary jail stream stopped because the saved game login changed', 'info');
      }
      state.login = { email, password, autoLogin: host.querySelector('#ul-simple-login-auto').checked };
      GM_setValue(KEYS.login, state.login);
      host.querySelector('#ul-simple-login-password').value = '';
      state.loginStatus = 'Saved locally in Tampermonkey';
      renderLogin();
      log('Saved login locally in Tampermonkey', 'ok');
      if (state.authRequired && state.login.autoLogin) void attemptAutoLogin();
    });
    host.querySelector('#ul-simple-login-clear').addEventListener('click', async () => {
      if (jailSecondaryEnabled || jailSecondaryToken) {
        await stopSecondaryJailStream({ logout: true });
        log('Secondary jail stream stopped because the saved game login was cleared', 'info');
      }
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
      void stopSecondaryJailStream({ logout: true });
      state.licenceStatus='Licence cleared';
      state.licenceError=true;
      render();
    });

    host.querySelector('#ul-simple-jail-diag-copy').addEventListener('click', async () => {
      if (!hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) return;
      let text;
      try {
        text = formatJailDiagnostics();
      } catch (error) {
        log(`Jail diagnostics could not be generated: ${error?.message || String(error)}`, 'error');
        window.alert('Could not generate jail diagnostics. Check the bot Logs tab for the error.');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        log('Copied jail diagnostics', 'ok');
      } catch {
        window.prompt('Copy jail diagnostics', text);
      }
    });
    host.querySelector('#ul-simple-jail-diag-reset').addEventListener('click', () => {
      if (!hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) return;
      resetJailDiagnostics();
      log('Reset jail diagnostics', 'info');
      renderLogs();
    });
    host.querySelector('#ul-simple-jail-secondary-toggle').addEventListener('click', async () => {
      if (!hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) return;
      if (jailSecondaryEnabled) {
        await stopSecondaryJailStream({ logout: true });
        log('Secondary jail stream stopped', 'info');
      } else {
        const ok = window.confirm('Start a second authenticated Jail stream? This creates one additional normal game session. The game keeps at most two sessions per account, so an older session on another device could be signed out.');
        if (!ok) return;
        try {
          await startSecondaryJailStream();
          log('Secondary jail stream enabled', 'ok');
        } catch (error) {
          jailDiagnostics.secondarySessionLoginErrors += 1;
          log(`Secondary jail stream: ${friendlyGameError(error)}`, 'warn');
        }
      }
      renderLogs();
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
      'ul-simple-bg-defence':'robotDefence',
      'ul-simple-bg-rotate':'robotDefenceRotate',
    };
    for (const [id,key] of Object.entries(checks)) host.querySelector(`#${id}`).checked = state.settings[key] === true;

    host.querySelector('#ul-simple-drug-repair-damage').value = String(state.settings.drugRepairDamage);
    host.querySelector('#ul-simple-beam-travel').value = state.settings.beamTravelMode;
    host.querySelector('#ul-simple-auto-gun-choice').value = String(state.settings.autoGunId);
    host.querySelector('#ul-simple-bg-reserve').value = String(state.settings.robotDefencePointReserve);
    host.querySelector('#ul-simple-bg-defence-panel').hidden = !hasDefenceLicence();
    host.querySelector('#ul-simple-bg-status').textContent = !state.settings.robotDefence
      ? 'BG defence disabled'
      : state.settings.robotDefenceAccount || state.defenceBindPending
        ? state.defenceStatus
        : 'Not bound to an account · untick and tick "Auto-replace" while logged in to the account to protect';

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
    // A timed-out rotation must never silently leave the bot's activities paused.
    state.defenceTravelLock = false;
    state.defenceTravelLockUntil = 0;
    state.beamPressureLease = null;
    state.defenceJailRiskPauseUntil = 0;
    // The logged-in account is re-confirmed after any stop/start.
    state.defenceIdentity = null;
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
    state.defenceDueAt = 0;
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
    const canRank = !state.inJail && !rankTransition && !defenceJailRiskPaused(now);
    return { combat, beam, serverRanking, rankBusy, rankTransition, canRank };
  }

  function scheduledLanes(now = Date.now()) {
    const f = schedulerFlags(now);
    return [
      ['Crimes', f.canRank && state.settings.crimes && !(f.serverRanking && state.autoRankControls.crimes) && !state.crimesRunning ? state.crimesDueAt : Infinity, runCrimes],
      ['GTA', f.canRank && state.settings.gta && !(f.serverRanking && state.autoRankControls.gta) && !state.gtaRunning ? state.gtaDueAt : Infinity, runGta],
      ['Jail monitor', (state.settings.jailBust || state.inJail) && !state.jailBustRunning && !state.jailReadRunning ? state.jailBustDueAt : Infinity, runJailBust],
      ['Melt', f.canRank && state.settings.melt && !(f.serverRanking && state.autoRankControls.melt) && !state.meltRunning ? state.meltDueAt : Infinity, runMelt],
      ['Drugs', !defenceTravelLocked() && !state.inJail && state.settings.drugs && !(f.serverRanking && state.autoRankControls.drugs) && !f.beam && !state.combatRunning && !state.drugsRunning ? state.drugsDueAt : Infinity, runDrugs],
      ['Auto Rank', state.settings.autoRank && !f.rankBusy && !state.prestigeCommitting && !state.autoRankRunning ? state.autoRankDueAt : Infinity, runAutoRank],
      ['Prestige', !state.inJail && state.settings.autoPrestige && !state.prestigeRunning && !state.prestigeComplete ? state.prestigeDueAt : Infinity, runPrestige],
      ['Auto gun', !state.inJail && state.settings.autoBuyGun && !state.autoGunRunning ? state.autoGunDueAt : Infinity, runAutoGun],
      ['Player discovery', state.settings.discoverPlayers && !state.playerDiscoveryRunning ? state.playerDiscoveryDueAt : Infinity, runPlayerDiscovery],
      ['Gang discovery', state.settings.discoverPlayers && !state.gangDiscoveryRunning ? state.gangDiscoveryDueAt : Infinity, runGangDiscovery],
      ['Player search', !state.inJail && (state.settings.searchPlayers || f.combat) && !state.playerSearchRunning ? state.playerSearchDueAt : Infinity, runPlayerSearch],
      ['Combat', !defenceTravelLocked() && !state.inJail && f.combat && !state.drugsRunning && !state.autoGunRunning && !state.combatRunning ? state.combatDueAt : Infinity, runCombat],
      // Runs in jail too (replacement only; rotation waits for release).
      ['BG Defence', hasDefenceLicence() && state.settings.robotDefence && !state.defenceRunning ? state.defenceDueAt : Infinity, runBodyguardDefence],
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
      state.combatRunning || state.qtRunning || state.defenceRunning;
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

  // Defence is available to any currently authorised licence, independently
  // of the owner's exclusive FAST_JAIL_STREAM feature. Never trust a saved
  // licence string without an active, unexpired server-issued session.
  function hasDefenceLicence() {
    return Boolean(
      token &&
      !state.licenceError &&
      Number.isFinite(tokenExpiresAt) &&
      tokenExpiresAt > Date.now()
    );
  }

  function jailStreamShouldRun() {
    // Fast live-inmate SSE is a licence capability. Standard licences never
    // open /api/jail/stream and use the normal /api/jail polling lane instead.
    return Boolean(automationAllowed() && state.settings.jailBust && hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM));
  }

  function gmGameRequest(details) {
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = GM_xmlhttpRequest({
          ...details,
          onload: (response) => resolve(response),
          onerror: () => reject(new Error('Secondary game request failed.')),
          ontimeout: () => reject(new Error('Secondary game request timed out.')),
          onabort: () => reject(new Error('Secondary game request aborted.')),
        });
      } catch (error) {
        reject(error);
      }
      return request;
    });
  }

  // Passive evidence only. No session token, player name, account ID, server
  // address or other identifying material appears in exported diagnostics.
  // 'Same broadcast' is strong evidence of the SAME backend process because a
  // process sends the same serverTime payload to all of its current subscribers.
  // Matching content versions ALONE cannot identify a backend (version is a
  // non-monotonic fingerprint). No client-visible backend number is provided.
  function noteJailRoutingTrace(event, detail = '') {
    const safeEvent = String(event).replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
    const safeDetail = String(detail).replace(/[^a-z0-9_-]/gi, '').slice(0, 56);
    jailDiagnostics.routingTrace.push({at:Date.now(), event:safeEvent, detail:safeDetail});
    if (jailDiagnostics.routingTrace.length > 48) jailDiagnostics.routingTrace.splice(0, jailDiagnostics.routingTrace.length - 48);
    scheduleRuntimePersist();
  }

  function resetJailRoutingRecent(stream = '') {
    if (stream === 'primary' || stream === 'secondary') {
      jailRoutingRecent[stream] = [];
      jailRoutingFirstSnapshot[stream] = false;
      jailRoutingMatchedKeys.clear();
      jailRoutingCurrentPair = {epoch:jailRoutingCurrentPair.epoch + 1, bothReadyEvents:0, exactMatches:0, nearbySameVersion:0};
      return;
    }
    jailRoutingRecent = {primary:[], secondary:[]};
    jailRoutingFirstSnapshot = {primary:false, secondary:false};
    jailRoutingMatchedKeys.clear();
    jailRoutingCurrentPair = {epoch:jailRoutingCurrentPair.epoch + 1, bothReadyEvents:0, exactMatches:0, nearbySameVersion:0};
  }

  function noteJailRoutingEvidence(stream, payload, receivedAt = Date.now()) {
    if (stream !== 'primary' && stream !== 'secondary') return;
    const otherStream = stream === 'primary' ? 'secondary' : 'primary';
    const first = !jailRoutingFirstSnapshot[stream];
    jailRoutingFirstSnapshot[stream] = true;
    const bothReady = jailStreamReady && jailSecondaryReady && jailRoutingFirstSnapshot[otherStream];
    const serverTime = String(payload?.serverTime || '');
    const version = String(payload?.version || '');
    if (!serverTime || !Number.isFinite(Date.parse(serverTime)) || !version) return;
    const row = {serverTime, version, receivedAt, first};
    jailRoutingRecent[stream].push(row);
    jailRoutingRecent[stream] = jailRoutingRecent[stream].filter((e) => receivedAt - e.receivedAt < 2_500).slice(-16);
    if (!bothReady || first) return;
    jailDiagnostics.routingBothReadySnapshotEvents += 1;
    jailRoutingCurrentPair.bothReadyEvents += 1;
    for (const other of jailRoutingRecent[otherStream]) {
      if (other.first || Math.abs(receivedAt - other.receivedAt) > 1_000) continue;
      if (other.version !== version) continue;
      jailDiagnostics.routingNearbySameVersionEvents += 1;
      jailRoutingCurrentPair.nearbySameVersion += 1;
      if (other.serverTime === serverTime) {
        const key = serverTime + '|' + version;
        if (!jailRoutingMatchedKeys.has(key)) {
          jailRoutingMatchedKeys.add(key);
          if (jailRoutingMatchedKeys.size > 128) jailRoutingMatchedKeys.delete(jailRoutingMatchedKeys.values().next().value);
          jailDiagnostics.routingExactBroadcastMatches += 1;
          jailRoutingCurrentPair.exactMatches += 1;
          noteJailRoutingTrace('matched-broadcast', 'exact-server-time-and-version');
        }
      } else {
        jailDiagnostics.routingNearbyDifferentTimestampEvents += 1;
      }
    }
  }

  function onJailPagehide(event) {
    if (jailPageExiting) return;
    jailPageExiting = true;
    jailDiagnostics.pagehideObserved += 1;
    noteJailRoutingTrace('pagehide', event?.persisted ? 'bfcache' : 'unload');
    // Close transport only; NEVER log out or clear the persisted secondary
    // session. The next page reuses and verifies the same saved session.
    if (jailEventSource) {
      try { jailEventSource.close(); jailDiagnostics.pagehidePrimaryClosed += 1; } catch {}
      jailEventSource = null;
    }
    jailStreamReady = false;
    jailSecondaryConnectionGeneration += 1;
    if (jailSecondaryRequest?.abort) {
      try { jailSecondaryRequest.abort(); jailDiagnostics.pagehideSecondaryAborted += 1; } catch {}
      jailSecondaryRequest = null;
    }
    jailSecondaryReady = false;
    if (jailReconnectTimer) clearTimeout(jailReconnectTimer);
    jailReconnectTimer = null;
    if (jailSecondaryReconnectTimer) clearTimeout(jailSecondaryReconnectTimer);
    jailSecondaryReconnectTimer = null;
    resetJailRoutingRecent();
    persistReloadState();
  }

  function onJailPageshow(event) {
    if (!event?.persisted || !jailPageExiting) return;
    jailPageExiting = false;
    jailDiagnostics.bfcacheReconnections += 1;
    noteJailRoutingTrace('pageshow', 'bfcache-reconnect');
    syncJailStream();
  }

  function secondarySessionCookieFromHeaders(headers) {
    const text = String(headers || '');
    const match = text.match(/(?:^|\r?\n)set-cookie:\s*ug_session=([^;\r\n]+)/i);
    return match ? decodeURIComponent(match[1].trim()) : '';
  }

  function pruneSecondaryLoginAttempts(now = Date.now()) {
    jailSecondaryLoginAttemptTimes = jailSecondaryLoginAttemptTimes
      .map((value) => Number(value) || 0)
      .filter((at) => at > 0 && now - at < SECONDARY_LOGIN_WINDOW_MS)
      .slice(-SECONDARY_LOGIN_LIMIT);
  }

  function secondaryLoginBudgetWaitMs(now = Date.now()) {
    pruneSecondaryLoginAttempts(now);
    if (jailSecondaryLoginAttemptTimes.length < SECONDARY_LOGIN_LIMIT) return 0;
    return Math.max(1, jailSecondaryLoginAttemptTimes[0] + SECONDARY_LOGIN_WINDOW_MS - now);
  }

  function secondaryLoginRecoveryWaitMs(now = Date.now()) {
    return Math.max(secondaryLoginBudgetWaitMs(now), Math.max(0, jailSecondaryLoginBackoffUntil - now));
  }

  function scheduleSecondarySessionRestore(delayMs) {
    if (!jailSecondaryEnabled || !jailStreamShouldRun()) return;
    const delay = Math.max(250, Number(delayMs) || SECONDARY_LOGIN_BACKOFF_BASE_MS);
    if (jailSecondaryRestoreTimer) clearTimeout(jailSecondaryRestoreTimer);
    jailSecondaryRestoreTimer = setTimeout(() => {
      jailSecondaryRestoreTimer = null;
      if (jailSecondaryEnabled && jailStreamShouldRun()) syncJailStream();
    }, delay);
  }

  function reserveSecondaryLoginAttempt() {
    const now = Date.now();
    const budgetWait = secondaryLoginBudgetWaitMs(now);
    if (budgetWait > 0) {
      const error = new Error(`Secondary login safety limit reached. Try again in ${formatWait(budgetWait)}.`);
      error.code = 'secondary_login_budget';
      error.secondaryDisable = true;
      throw error;
    }
    jailSecondaryLoginAttemptTimes.push(now);
    pruneSecondaryLoginAttempts(now);
    persistSecondaryJailState();
  }

  function noteSecondaryLoginSuccess() {
    jailSecondaryLoginBackoffUntil = 0;
    jailSecondaryLoginBackoffMs = SECONDARY_LOGIN_BACKOFF_BASE_MS;
    pruneSecondaryLoginAttempts();
    persistSecondaryJailState();
  }

  function deferSecondaryLoginRestore() {
    const now = Date.now();
    const delay = Math.max(SECONDARY_LOGIN_BACKOFF_BASE_MS, jailSecondaryLoginBackoffMs || SECONDARY_LOGIN_BACKOFF_BASE_MS);
    jailSecondaryLoginBackoffUntil = Math.max(jailSecondaryLoginBackoffUntil, now + delay);
    jailSecondaryLoginBackoffMs = Math.min(SECONDARY_LOGIN_BACKOFF_MAX_MS, delay * 2);
    persistSecondaryJailState();
    scheduleSecondarySessionRestore(Math.max(250, jailSecondaryLoginBackoffUntil - now));
  }

  async function mainGameSessionUserId() {
    let me;
    try {
      me = await gameJson('/api/auth/me', { skipAuthHandling: true, priority: REQUEST_PRIORITY.RAPID });
    } catch (error) {
      error.secondaryAuthSource = 'main';
      throw error;
    }
    const userId = String(me?.user?.id || '').trim();
    if (!userId) {
      const error = new Error('Main browser game session could not be verified.');
      error.code = 'secondary_main_session_unverified';
      error.secondaryAuthSource = 'main';
      throw error;
    }
    return userId;
  }

  async function secondaryGameSessionUserId(sessionToken) {
    if (!sessionToken) {
      const error = new Error('Secondary game session token is missing.');
      error.status = 401;
      throw error;
    }
    const response = await gmGameRequest({
      method: 'GET',
      url: new URL('/api/auth/me', location.origin).href,
      anonymous: true,
      cookie: `ug_session=${sessionToken}`,
      headers: { Accept: 'application/json' },
      timeout: 10_000,
    });
    let body = {};
    try { body = JSON.parse(String(response.responseText || '{}')); } catch {}
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(body?.error || body?.message || `Secondary session check HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      error.secondaryAuthSource = 'secondary';
      throw error;
    }
    const userId = String(body?.user?.id || '').trim();
    if (!userId) {
      const error = new Error('Secondary game session identity could not be verified.');
      error.secondaryAuthSource = 'secondary';
      throw error;
    }
    return userId;
  }

  async function verifySecondaryGameSessionAgainstMain() {
    if (!jailSecondaryToken) return false;
    if (jailSecondaryVerifiedMainUserId && jailSecondaryUserId === jailSecondaryVerifiedMainUserId) return true;
    const [mainUserId, secondaryUserId] = await Promise.all([
      mainGameSessionUserId(),
      secondaryGameSessionUserId(jailSecondaryToken),
    ]);
    if (mainUserId !== secondaryUserId) {
      const error = new Error('Secondary game login belongs to a different account. Secondary jail stream was disabled.');
      error.code = 'secondary_account_mismatch';
      error.secondaryDisable = true;
      throw error;
    }
    jailSecondaryUserId = secondaryUserId;
    jailSecondaryVerifiedMainUserId = mainUserId;
    jailDiagnostics.secondarySessionRestoreVerified += 1;
    jailDiagnostics.secondaryLoginSameAccountVerified += 1;
    noteJailRoutingTrace('session-restore', 'verified-same-account');
    persistSecondaryJailState();
    return true;
  }

  async function createSecondaryGameSession() {
    if (!state.login.email || !state.login.password) {
      const error = new Error('Save your game login details first.');
      error.code = 'secondary_missing_credentials';
      error.secondaryDisable = true;
      throw error;
    }
    reserveSecondaryLoginAttempt();
    jailDiagnostics.secondarySessionLoginAttempts += 1;
    const response = await gmGameRequest({
      method: 'POST',
      url: new URL('/api/auth/login', location.origin).href,
      anonymous: true,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify({ email: state.login.email, password: state.login.password }),
      timeout: 15_000,
    });
    let body = {};
    try { body = JSON.parse(String(response.responseText || '{}')); } catch {}
    if (response.status < 200 || response.status >= 300) {
      const error = new Error(body?.error || body?.message || `Secondary login HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      if (response.status === 401 || response.status === 403 || response.status === 429) error.secondaryDisable = true;
      throw error;
    }
    const sessionToken = secondarySessionCookieFromHeaders(response.responseHeaders);
    if (!sessionToken) {
      const error = new Error('Secondary login succeeded but Tampermonkey did not expose the session cookie.');
      error.code = 'secondary_cookie_unavailable';
      error.secondaryDisable = true;
      throw error;
    }
    jailDiagnostics.secondaryCookieSetObserved += 1;
    jailDiagnostics.secondarySessionNewLogin += 1;
    if (jailSecondaryToken && jailSecondaryToken !== sessionToken) jailDiagnostics.secondaryLoginTokenRotationObserved += 1;
    noteJailRoutingTrace('secondary-cookie', 'new-httponly-session-issued');
    const secondaryUserId = String(body?.user?.id || '').trim();
    if (!secondaryUserId) {
      await logoutSecondaryGameSession(sessionToken);
      const error = new Error('Secondary login response did not identify the account.');
      error.code = 'secondary_identity_missing';
      error.secondaryDisable = true;
      throw error;
    }
    try {
      const mainUserId = await mainGameSessionUserId();
      if (mainUserId !== secondaryUserId) {
        const error = new Error('Saved game login belongs to a different account than the main browser session.');
        error.code = 'secondary_account_mismatch';
        error.secondaryDisable = true;
        throw error;
      }
      jailSecondaryVerifiedMainUserId = mainUserId;
      jailDiagnostics.secondaryLoginSameAccountVerified += 1;
      noteJailRoutingTrace('secondary-login', 'verified-same-account');
    } catch (error) {
      await logoutSecondaryGameSession(sessionToken);
      error.secondaryDisable = true;
      throw error;
    }
    jailDiagnostics.secondarySessionLoginSuccess += 1;
    noteSecondaryLoginSuccess();
    return { token: sessionToken, userId: secondaryUserId };
  }

  async function logoutSecondaryGameSession(sessionToken) {
    if (!sessionToken) return;
    try {
      await gmGameRequest({
        method: 'POST',
        url: new URL('/api/auth/logout', location.origin).href,
        anonymous: true,
        cookie: `ug_session=${sessionToken}`,
        headers: { Accept: 'application/json' },
        timeout: 10_000,
      });
    } catch {}
  }

  function scheduleSecondaryJailReconnect() {
    if (jailPageExiting || !jailSecondaryEnabled || !jailStreamShouldRun() || !jailSecondaryToken || jailSecondaryReconnectTimer) return;
    const delay = jailSecondaryReconnectDelayMs;
    jailSecondaryReconnectDelayMs = Math.min(15_000, jailSecondaryReconnectDelayMs * 2);
    jailSecondaryReconnectTimer = setTimeout(() => {
      jailSecondaryReconnectTimer = null;
      if (jailSecondaryEnabled && jailStreamShouldRun() && jailSecondaryToken) connectSecondaryJailStream();
    }, delay);
  }

  function liveTargetSet(inmates) {
    const targets = new Set();
    for (const inmate of Array.isArray(inmates) ? inmates : []) {
      const candidate = liveJailCandidateRecord(inmate);
      if (candidate) targets.add(candidate.target);
    }
    return targets;
  }

  function mergedLiveJailInmates() {
    const merged = new Map();
    // A disconnected backend must never supply candidates from its old cache.
    for (const inmates of [jailStreamReady ? jailLatestStreamInmates : [], jailSecondaryReady ? jailSecondaryLatestInmates : []]) {
      for (const inmate of Array.isArray(inmates) ? inmates : []) {
        const candidate = liveJailCandidateRecord(inmate);
        if (!candidate || merged.has(candidate.target)) continue;
        merged.set(candidate.target, inmate);
      }
    }
    return [...merged.values()];
  }



  function clearDisconnectedJailSnapshot(stream) {
    const discarded = stream === 'primary' ? jailLatestStreamInmates.length : jailSecondaryLatestInmates.length;
    if (stream === 'primary') {
      jailLatestStreamInmates = [];
      jailLivePreviousTargets = new Set();
      jailLiveSnapshotPrimed = false;
    } else if (stream === 'secondary') {
      jailSecondaryLatestInmates = [];
      jailSecondaryPreviousTargets = new Set();
      jailSecondarySnapshotPrimed = false;
    }
    const remaining = liveTargetSet(stream === 'primary'
      ? (jailSecondaryReady ? jailSecondaryLatestInmates : [])
      : (jailStreamReady ? jailLatestStreamInmates : []));
    jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => remaining.has(target));
    for (const target of jailTargetSightings.keys()) {
      if (!remaining.has(target)) jailTargetSightings.delete(target);
    }
    jailDiagnostics.liveDisconnectedSnapshotDrops += discarded;
  }

  function noteJailPollVsStreamSnapshot(source, inmates, receivedAt = Date.now()) {
    // "First" means first observed in this local measurement window, NOT
    // necessarily the inmate's actual jail-entry time. GET can be cached.
    if (!hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) return;
    const meta = jailPollCompare[source];
    const next = liveTargetSet(inmates);
    if (source === 'poll') {
      jailDiagnostics.pollDiagReads += 1;
      jailDiagnostics.pollDiagRealTargetsTotal += next.size;
      for (const stream of ['primary', 'secondary']) {
        const other = jailPollCompare[stream];
        const title = stream === 'primary' ? 'Primary' : 'Secondary';
        const age = receivedAt - other.receivedAt;
        if (!other.primed || age < 0 || age > JAIL_POLL_COMPARE_FRESH_MS) {
          jailDiagnostics[`pollDiag${title}NonComparableReads`] += 1;
          continue;
        }
        jailDiagnostics[`pollDiag${title}ComparableReads`] += 1;
        for (const target of next) {
          jailDiagnostics[`pollDiag${title}${other.targets.has(target) ? 'Both' : 'PollOnly'}Targets`] += 1;
        }
        for (const target of other.targets) {
          if (!next.has(target)) jailDiagnostics[`pollDiag${title}StreamOnlyTargets`] += 1;
        }
      }
    }
    if (meta.primed) {
      for (const target of next) {
        if (meta.targets.has(target)) continue;
        let record = jailPollCompareSightings.get(target);
        if (!record || receivedAt - record.lastNewAt > JAIL_POLL_COMPARE_PAIR_MS) {
          record = { poll:0, primary:0, secondary:0, matchedPrimary:false, matchedSecondary:false, lastNewAt:receivedAt };
          jailPollCompareSightings.set(target, record);
        }
        if (!record[source]) record[source] = receivedAt;
        record.lastNewAt = receivedAt;
        if (record.poll && record.primary && !record.matchedPrimary) {
          const lag = Math.abs(record.poll - record.primary);
          if (lag <= JAIL_POLL_COMPARE_PAIR_MS) {
            if (record.poll < record.primary) {
              jailDiagnostics.pollDiagPollBeforePrimary += 1;
              jailDiagnostics.pollDiagPollBeforePrimaryLagTotalMs += lag;
            } else if (record.primary < record.poll) {
              jailDiagnostics.pollDiagPrimaryBeforePoll += 1;
              jailDiagnostics.pollDiagPrimaryBeforePollLagTotalMs += lag;
            } else jailDiagnostics.pollDiagPollPrimaryTies += 1;
          }
          record.matchedPrimary = true;
        }
        if (record.poll && record.secondary && !record.matchedSecondary) {
          const lag = Math.abs(record.poll - record.secondary);
          if (lag <= JAIL_POLL_COMPARE_PAIR_MS) {
            if (record.poll < record.secondary) {
              jailDiagnostics.pollDiagPollBeforeSecondary += 1;
              jailDiagnostics.pollDiagPollBeforeSecondaryLagTotalMs += lag;
            } else if (record.secondary < record.poll) {
              jailDiagnostics.pollDiagSecondaryBeforePoll += 1;
              jailDiagnostics.pollDiagSecondaryBeforePollLagTotalMs += lag;
            } else jailDiagnostics.pollDiagPollSecondaryTies += 1;
          }
          record.matchedSecondary = true;
        }
      }
    }
    meta.targets = next;
    meta.primed = true;
    meta.receivedAt = receivedAt;
    jailPollCompareEvents += 1;
    if (jailPollCompareEvents % 64 === 0 || jailPollCompareSightings.size > 1_500) {
      for (const [target, record] of jailPollCompareSightings) {
        if (receivedAt - record.lastNewAt > 120_000 || jailPollCompareSightings.size > 1_500) {
          jailPollCompareSightings.delete(target);
        }
      }
    }
  }

  function jailPollSupportForBust(target, selectedStream) {
    // Capture BEFORE awaiting the bust POST. A previous cached GET may not
    // reflect current state: an absent target is evidence of disagreement only.
    const poll = jailPollCompare.poll;
    const age = Date.now() - poll.receivedAt;
    const stream = selectedStream === 'primary' ? 'Primary'
      : selectedStream === 'secondary' ? 'Secondary' : 'Both';
    return {
      stream,
      support: poll.primed && age >= 0 && age <= JAIL_POLL_COMPARE_FRESH_MS
        ? (poll.targets.has(target) ? 'PollPresent' : 'PollAbsent')
        : 'NoRecentPoll',
    };
  }

  function noteJailPollSupportOutcome(context, stage) {
    if (!context) return;
    const outcome = stage === 'attempt' ? 'Attempts' : stage === 'success' ? 'Success' : 'Stale';
    jailDiagnostics[`pollDiag${context.stream}${context.support}${outcome}`] += 1;
  }

  function resetJailPollComparison() {
    jailPollCompareEpoch += 1; // Discard SSE measurement callbacks queued pre-reset.
    jailPollCompareEvents = 0;
    jailPollCompareSightings.clear();
    for (const source of ['poll', 'primary', 'secondary']) {
      jailPollCompare[source] = {primed:false, targets:new Set(), receivedAt:0};
    }
  }

  function noteIndependentJailSnapshot(stream, payload, receivedAt = Date.now()) {
    try { noteJailRoutingEvidence(stream, payload, receivedAt); } catch { jailDiagnostics.routingMetricsErrors += 1; }
    // A hash fingerprint, NOT a monotonic revision: never order snapshots by it.
    const current = jailIndependentMeta[stream];
    const other = jailIndependentMeta[stream === 'primary' ? 'secondary' : 'primary'];
    const prefix = stream === 'primary' ? 'streamDiagPrimary' : 'streamDiagSecondary';
    const serverAt = Date.parse(String(payload.serverTime || ''));
    jailDiagnostics[`${prefix}Events`] += 1;
    if (Number.isFinite(serverAt)) {
      const age = Math.max(0, receivedAt - serverAt);
      jailDiagnostics[`${prefix}ServerAgeSamples`] += 1;
      jailDiagnostics[`${prefix}ServerAgeTotalMs`] += age;
      jailDiagnostics[`${prefix}ServerAgeMaxMs`] = Math.max(jailDiagnostics[`${prefix}ServerAgeMaxMs`], age);
      if (current.lastServerAt > 0) {
        const gap = Math.max(0, serverAt - current.lastServerAt);
        jailDiagnostics[`${prefix}ServerGapSamples`] += 1;
        jailDiagnostics[`${prefix}ServerGapTotalMs`] += gap;
        jailDiagnostics[`${prefix}ServerGapMaxMs`] = Math.max(jailDiagnostics[`${prefix}ServerGapMaxMs`], gap);
      }
      current.lastServerAt = serverAt;
    } else {
      jailDiagnostics[`${prefix}InvalidServerTime`] += 1;
    }
    const version = String(payload.version || '').slice(0, 64);
    if (version && other.version && version === other.version) {
      jailDiagnostics[`streamDiagVersionsEqualAt${stream === 'primary' ? 'Primary' : 'Secondary'}Event`] += 1;
    }
    current.version = version;
    current.serverAt = Number.isFinite(serverAt) ? serverAt : 0;
    current.receivedAt = receivedAt;
    current.seq += 1;
    const next = liveTargetSet(payload.inmates);
    if (current.primed) {
      for (const target of current.targets) {
        if (next.has(target)) continue;
        let history = jailIndependentHistory.get(target);
        if (!history) {
          history = { primaryRemovedAt:0, secondaryRemovedAt:0 };
          jailIndependentHistory.set(target, history);
        }
        history[`${stream}RemovedAt`] = receivedAt;
        jailDiagnostics[`${prefix}Removals`] += 1;
        if (other.targets.has(target)) jailDiagnostics[`${prefix}DisappearedWhile${stream === 'primary' ? 'Secondary' : 'Primary'}Visible`] += 1;
      }
      for (const target of next) {
        if (current.targets.has(target)) continue;
        jailDiagnostics[`${prefix}Additions`] += 1;
        const history = jailIndependentHistory.get(target);
        if (!history) continue;
        const ownRemoval = history[`${stream}RemovedAt`] || 0;
        const otherRemoval = history[`${stream === 'primary' ? 'secondary' : 'primary'}RemovedAt`] || 0;
        if (ownRemoval > 0 && receivedAt - ownRemoval <= JAIL_DIAG_REMOVAL_WINDOW_MS) {
          jailDiagnostics[`${prefix}SameStreamReappear`] += 1;
        }
        if (otherRemoval > 0 && receivedAt - otherRemoval <= JAIL_DIAG_REMOVAL_WINDOW_MS && !other.targets.has(target)) {
          jailDiagnostics[`${prefix}ReappearAfter${stream === 'primary' ? 'Secondary' : 'Primary'}Removal`] += 1;
        }
      }
    }
    current.targets = next;
    current.primed = true;
    jailIndependentStreamEvents += 1;
    // Bounded, ephemeral metadata; no user identity is written to GM storage.
    if (jailIndependentStreamEvents % 50 === 0 || jailIndependentHistory.size > JAIL_DIAG_HISTORY_MAX) {
      for (const [target, history] of jailIndependentHistory) {
        const latest = Math.max(history.primaryRemovedAt || 0, history.secondaryRemovedAt || 0);
        if (receivedAt - latest > JAIL_DIAG_HISTORY_TTL_MS || jailIndependentHistory.size > JAIL_DIAG_HISTORY_MAX) {
          jailIndependentHistory.delete(target);
        }
      }
    }
  }

  function independentBustContext(target, selectedStream, trigger) {
    const primary = jailIndependentMeta.primary;
    const secondary = jailIndependentMeta.secondary;
    const now = Date.now();
    const opposite = selectedStream === 'primary' ? 'secondary' : selectedStream === 'secondary' ? 'primary' : '';
    const oppositeSnapshot = jailIndependentMeta[opposite] || null;
    const history = jailIndependentHistory.get(target);
    const removedAt = opposite ? Number(history?.[`${opposite}RemovedAt`]) || 0 : 0;
    const crossRemoved = Boolean(opposite && oppositeSnapshot?.primed && !oppositeSnapshot.targets.has(target)
      && removedAt && now - removedAt >= 0 && now - removedAt <= JAIL_DIAG_REMOVAL_WINDOW_MS);
    const normalizedTrigger = trigger === 'primary' || trigger === 'secondary' || trigger === 'continuation' ? trigger : 'other';
    return {
      selectedStream,
      trigger: normalizedTrigger,
      crossRemoved: crossRemoved ? `${opposite}-removed` : 'none',
      oppositeRemovedAgoMs: crossRemoved ? now - removedAt : -1,
      primarySnapshotAgoMs: primary.receivedAt ? now - primary.receivedAt : -1,
      secondarySnapshotAgoMs: secondary.receivedAt ? now - secondary.receivedAt : -1,
      primarySeq: primary.seq,
      secondarySeq: secondary.seq,
      // Snapshot age is NOT inmate age. serverTime is send-time, not jail-entry time.
      primaryBroadcastAgeMs: primary.serverAt ? Math.max(0, now-primary.serverAt) : -1,
      secondaryBroadcastAgeMs: secondary.serverAt ? Math.max(0, now-secondary.serverAt) : -1,
    };
  }

  function noteIndependentBustOutcome(context, outcome) {
    const triggerTitle = context.trigger[0].toUpperCase() + context.trigger.slice(1);
    if (outcome === 'attempt') jailDiagnostics[`streamDiagTriggered${triggerTitle}Attempts`] += 1;
    if (outcome === 'success') jailDiagnostics[`streamDiagTriggered${triggerTitle}Success`] += 1;
    if (outcome === 'stale') jailDiagnostics[`streamDiagTriggered${triggerTitle}Stale`] += 1;
    if (context.crossRemoved === 'secondary-removed' && context.selectedStream === 'primary') {
      if (outcome === 'attempt') jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalAttempts += 1;
      if (outcome === 'success') jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalSuccess += 1;
      if (outcome === 'stale') jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalStale += 1;
    } else if (context.crossRemoved === 'primary-removed' && context.selectedStream === 'secondary') {
      if (outcome === 'attempt') jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalAttempts += 1;
      if (outcome === 'success') jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalSuccess += 1;
      if (outcome === 'stale') jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalStale += 1;
    } else if (outcome === 'stale' && context.crossRemoved === 'none') {
      if (context.selectedStream === 'primary') jailDiagnostics.streamDiagPrimaryOnlyNoCrossRemovalStale += 1;
      if (context.selectedStream === 'secondary') jailDiagnostics.streamDiagSecondaryOnlyNoCrossRemovalStale += 1;
    }
  }


  function noteJailCauseSnapshot(stream, inmates, receivedAt = Date.now()) {
    const episodes = jailCauseEpisodes[stream];
    if (!episodes) return;
    const next = new Map();
    for (const row of Array.isArray(inmates) ? inmates : []) {
      const record = liveJailCandidateRecord(row);
      if (!record) continue;
      const older = episodes.get(record.target);
      const secs = Number(row.secondsRemaining);
      next.set(record.target, {
        firstAt: older?.firstAt || receivedAt,
        snapshotCount: Math.min(1000000, (older?.snapshotCount || 0) + 1),
        reportedSeconds: Number.isFinite(secs) && secs >= 0 ? secs : -1,
      });
    }
    jailCauseEpisodes[stream] = next;
  }

  function jailCauseSecondsBucket(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'SUnknown';
    if (seconds <= 5) return 'S0to5';
    if (seconds <= 15) return 'S6to15';
    if (seconds <= 45) return 'S16to45';
    if (seconds <= 120) return 'S46to120';
    return 'S121plus';
  }

  function jailCauseContext(candidate, primaryOnly, secondaryOnly, bothSeen) {
    const stream = primaryOnly ? 'Primary' : secondaryOnly ? 'Secondary' : bothSeen ? 'Both' : 'Unknown';
    const primary = jailCauseEpisodes.primary.get(candidate.target);
    const secondary = jailCauseEpisodes.secondary.get(candidate.target);
    const entry = stream === 'Secondary' ? secondary : stream === 'Primary' ? primary : (primary || secondary);
    const reportedSeconds = Number(candidate.inmate?.secondsRemaining);
    const seconds = Number.isFinite(reportedSeconds) && reportedSeconds >= 0 ? reportedSeconds : -1;
    const firstSeenAge = entry?.firstAt ? Math.max(0, Date.now() - entry.firstAt) : -1;
    return {
      stream,
      reportedSeconds: seconds,
      secondsBucket: jailCauseSecondsBucket(seconds),
      seenCategory: !entry ? 'NoHistory' : entry.snapshotCount === 1 ? 'FirstSnapshot' : 'RepeatSnapshot',
      seenCount: Number(entry?.snapshotCount) || 0,
      firstSeenAge,
      reason: 'pending',
    };
  }

  function jailCauseFailureReason(error) {
    const status = Number(error?.status) || 0;
    // The game returns fixed error categories. Never put raw response text in diagnostics.
    const message = String(error?.body?.html || error?.body?.error || error?.body?.message || error?.message || '').toLowerCase();
    if (status === 400 && /(?:not in jail|no longer in jail)/.test(message)) return 'NotInJail';
    if (status === 404 && /(?:player not found|not found)/.test(message)) return 'NotFound';
    if (status === 400 && /(?:player is dead|player is dead\.|that player is dead)/.test(message)) return 'Dead';
    if (status === 404 || (status === 400 && /(?:not in jail|not found|dead)/.test(message))) return 'OtherStale';
    if (status === 429) return 'RateLimit';
    if (error?.body?.success === false || /got caught|cannot bust players while you are in jail/.test(message)) return 'Caught';
    return 'OtherError';
  }

  function noteJailCauseOutcome(context, stage, error) {
    if (!context) return;
    const p = `causeDiag${context.stream}`;
    if (stage === 'attempt' || stage === 'success' || stage === 'stale') {
      const suffix = stage === 'attempt' ? 'Attempts' : stage === 'success' ? 'Success' : 'Stale';
      jailDiagnostics[p + suffix] += 1;
      jailDiagnostics[p + context.secondsBucket + suffix] += 1;
      jailDiagnostics[p + context.seenCategory + suffix] += 1;
      if (stage === 'attempt') {
        if (context.reportedSeconds >= 0) {
          jailDiagnostics[p + 'ReportedSecondsTotal'] += context.reportedSeconds;
          jailDiagnostics[p + 'ReportedSecondsSamples'] += 1;
        }
        if (context.firstSeenAge >= 0) {
          jailDiagnostics[p + 'FirstSeenAgeTotalMs'] += context.firstSeenAge;
          jailDiagnostics[p + 'FirstSeenAgeSamples'] += 1;
        } else jailDiagnostics.causeDiagHistoryMissing += 1;
      }
    }
    if (stage === 'success') context.reason = 'Success';
    else if (stage === 'failure') context.reason = jailCauseFailureReason(error);
    if (stage === 'success' || stage === 'failure') jailDiagnostics[p + context.reason + 'Count'] += 1;
  }

  function recentJailAttempt(target, now = Date.now()) {
    for (const [key, at] of jailRecentAttemptedTargets) {
      if (now - at > 15_000) jailRecentAttemptedTargets.delete(key);
    }
    for (const [key, info] of jailStaleTargetBackoff) {
      if (now > info.until + 15_000) jailStaleTargetBackoff.delete(key);
    }
    const at = jailRecentAttemptedTargets.get(target) || 0;
    const until = jailStaleTargetBackoff.get(target)?.until || 0;
    return (at > 0 && now - at < 2_500) || until > now;
  }

  function rearmNewJailEpisode(target) {
    if (!jailRecentAttemptedTargets.has(target) && !jailStaleTargetBackoff.has(target)) return;
    jailRecentAttemptedTargets.delete(target);
    jailStaleTargetBackoff.delete(target);
    jailDiagnostics.liveNewEpisodeRearmed += 1;
  }

  function backoffStaleJailTarget(target) {
    const previous = jailStaleTargetBackoff.get(target);
    const count = Math.min(6, (previous?.count || 0) + 1);
    // Repeated unchanged snapshots should not consume the 5/sec claim budget.
    // Cap the extra wait so visible players repeatedly re-jailed without a
    // detectable disappearance are eventually retried.
    jailStaleTargetBackoff.set(target, { count, until: Date.now() + Math.min(7_000, 2_500 + count * 750) });
    jailDiagnostics.liveStaleBackoffApplied += 1;
  }

  function pruneJailTargetSightings(nowPerf = performance.now()) {
    for (const [target, sighting] of jailTargetSightings) {
      const lastAt = Math.max(Number(sighting?.primaryAt) || 0, Number(sighting?.secondaryAt) || 0, Number(sighting?.firstAt) || 0);
      if (!lastAt || nowPerf - lastAt > 60_000) jailTargetSightings.delete(target);
    }
  }

  function noteJailTargetSightings(streamName, inmates, receivedPerf = performance.now()) {
    if (streamName !== 'primary' && streamName !== 'secondary') return;
    pruneJailTargetSightings(receivedPerf);

    // A bust token/username can appear in jail again later. v2.2.16 kept the
    // old first-seen timestamp for up to 60 seconds, which made a later jail
    // episode look tens of seconds old. Retire a sighting as soon as the target
    // is absent from BOTH current stream snapshots, then treat a later return as
    // a brand-new episode.
    const currentTargets = liveTargetSet(inmates);
    const otherTargets = streamName === 'primary'
      ? liveTargetSet(jailSecondaryLatestInmates)
      : liveTargetSet(jailLatestStreamInmates);
    for (const target of jailTargetSightings.keys()) {
      if (!currentTargets.has(target) && !otherTargets.has(target)) jailTargetSightings.delete(target);
    }

    for (const inmate of Array.isArray(inmates) ? inmates : []) {
      const candidate = liveJailCandidateRecord(inmate);
      if (!candidate) continue;
      let sighting = jailTargetSightings.get(candidate.target);
      if (!sighting) {
        sighting = {
          firstStream: streamName,
          firstAt: receivedPerf,
          firstHidden: document.visibilityState === 'hidden',
          primaryAt: 0,
          secondaryAt: 0,
        };
        jailTargetSightings.set(candidate.target, sighting);
      }
      if (streamName === 'primary' && !sighting.primaryAt) sighting.primaryAt = receivedPerf;
      if (streamName === 'secondary' && !sighting.secondaryAt) sighting.secondaryAt = receivedPerf;
    }
  }

  function streamSightingForTarget(target) {
    const sighting = jailTargetSightings.get(target);
    if (!sighting) return { firstStream: 'unknown', firstAt: 0, firstHidden: false, primaryAt: 0, secondaryAt: 0, leadMs: -1, leadStream: 'unknown' };
    const primaryAt = Number(sighting.primaryAt) || 0;
    const secondaryAt = Number(sighting.secondaryAt) || 0;
    let leadMs = -1;
    let leadStream = 'unknown';
    if (primaryAt > 0 && secondaryAt > 0) {
      leadMs = Math.abs(primaryAt - secondaryAt);
      if (leadMs <= 5) leadStream = 'tie';
      else leadStream = primaryAt < secondaryAt ? 'primary' : 'secondary';
    }
    return {
      firstStream: sighting.firstStream || 'unknown',
      firstAt: Number(sighting.firstAt) || 0,
      firstHidden: sighting.firstHidden === true,
      primaryAt,
      secondaryAt,
      leadMs,
      leadStream,
    };
  }

  function noteSecondaryLiveJailSnapshot(inmates) {
    const nextTargets = liveTargetSet(inmates);
    const primaryTargets = liveTargetSet(jailStreamReady ? jailLatestStreamInmates : []);
    const newlySeen = [];
    for (const target of nextTargets) {
      const isNew = jailSecondarySnapshotPrimed
        ? !jailSecondaryPreviousTargets.has(target)
        : !primaryTargets.has(target);
      if (!isNew) continue;
      if (jailSecondarySnapshotPrimed && !primaryTargets.has(target)) rearmNewJailEpisode(target);
      if (recentJailAttempt(target)) continue;
      newlySeen.push(target);
      jailDiagnostics.secondaryFreshTargetsSeen += 1;
      if (!primaryTargets.has(target)) jailDiagnostics.secondaryOnlyFreshTargetsSeen += 1;
    }
    if (newlySeen.length && state.jailBustRunning) {
      jailDiagnostics.liveBusySecondaryFreshTargets += newlySeen.length;
      if (jailActiveBustSelectedStream === 'primary') {
        jailDiagnostics.liveSecondaryFreshDuringPrimary += newlySeen.filter((target) => !primaryTargets.has(target)).length;
      }
    }
    if (newlySeen.length) {
      const queued = new Set(jailLiveFreshTargets);
      for (const target of newlySeen) {
        if (!queued.has(target)) {
          jailLiveFreshTargets.push(target);
          queued.add(target);
        }
      }
    }
    jailSecondarySnapshotPrimed = true;
    jailSecondaryPreviousTargets = nextTargets;
    const allTargets = new Set([...nextTargets, ...primaryTargets]);
    jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => allTargets.has(target) && !recentJailAttempt(target));
  }

  function handleSecondaryJailSseEvent(eventName, dataText) {
    if (!jailSecondaryEnabled || !jailStreamShouldRun()) return;
    if (jailPageExiting) return;
    if (eventName === 'ready') {
      jailSecondaryReady = true;
      jailDiagnostics.secondaryStreamReadyAfterRestore += 1;
      noteJailRoutingTrace('secondary-ready', 'connected');
      jailSecondaryReconnectDelayMs = 1_000;
      jailDiagnostics.secondaryStreamReady += 1;
      scheduleRuntimePersist();
      renderLogs();
      return;
    }
    if (eventName === 'superseded') {
      jailDiagnostics.secondarySseSupersededLifecycle += 1;
      noteJailRoutingTrace('secondary-superseded', 'server-closed');
      jailDiagnostics.secondaryStreamErrors += 1;
      if (jailSecondaryRequest?.abort) try { jailSecondaryRequest.abort(); } catch {}
      jailSecondaryRequest = null;
      jailSecondaryReady = false;
      clearDisconnectedJailSnapshot('secondary');
      scheduleSecondaryJailReconnect();
      return;
    }
    if (eventName !== 'inmates') return;
    const eventReceivedPerf = performance.now();
    try {
      const payload = JSON.parse(String(dataText || '{}'));
      if (!Array.isArray(payload.inmates)) return;
      jailDiagnostics.secondaryInmateEvents += 1;
      noteJailTargetSightings('secondary', payload.inmates, eventReceivedPerf);
      jailSecondaryLatestInmates = payload.inmates;
      noteSecondaryLiveJailSnapshot(payload.inmates);
      try { noteIndependentJailSnapshot('secondary', payload); } catch {} // Metrics must never interrupt live busting.
      try { noteJailCauseSnapshot('secondary', payload.inmates); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
      scheduleRuntimePersist();
      void processLiveJailSnapshot('secondary');
      const pollCompareEpoch = jailPollCompareEpoch;
      const pollCompareReceivedAt = Date.now();
      queueMicrotask(() => {
        if (pollCompareEpoch !== jailPollCompareEpoch) return;
        try { noteJailPollVsStreamSnapshot('secondary', payload.inmates, pollCompareReceivedAt); }
        catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
      });
    } catch {}
  }

  async function consumeSecondaryJailStream(stream, generation) {
    if (!stream || typeof stream.getReader !== 'function') throw new Error('Tampermonkey stream API unavailable.');
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';
    let dataLines = [];
    const dispatch = () => {
      if (generation === jailSecondaryConnectionGeneration && (dataLines.length || eventName !== 'message')) handleSecondaryJailSseEvent(eventName, dataLines.join('\n'));
      eventName = 'message';
      dataLines = [];
    };
    while (!jailPageExiting && generation === jailSecondaryConnectionGeneration && jailSecondaryEnabled && jailStreamShouldRun()) {
      const { value, done } = await reader.read();
      if (done || jailPageExiting || generation !== jailSecondaryConnectionGeneration) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, split);
        const newlineLength = buffer[split] === '\r' && buffer[split + 1] === '\n' ? 2 : 1;
        buffer = buffer.slice(split + newlineLength);
        if (line === '') { dispatch(); continue; }
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message';
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    try { reader.cancel(); } catch {}
  }

  async function handleSecondaryLoginFailure(error) {
    const fatal = error?.secondaryDisable === true || [401, 403, 429].includes(Number(error?.status));
    if (fatal) {
      await stopSecondaryJailStream({ logout: true });
      error.secondaryHandled = true;
      return;
    }
    deferSecondaryLoginRestore();
    error.secondaryHandled = true;
  }

  async function ensureSecondaryGameSession() {
    if (!jailSecondaryEnabled) return '';

    // Cross-tab stop/revoke/login changes are persisted immediately. Treat the
    // saved enabled flag as the shared source of truth before this tab verifies
    // or creates a secondary session, so a stale bot tab cannot bring it back.
    const sharedSecondaryState = loadSecondaryJailState();
    if (!sharedSecondaryState.enabled) {
      await stopSecondaryJailStream({ logout: false });
      return '';
    }

    if (jailSecondarySessionPromise) return jailSecondarySessionPromise;

    jailSecondarySessionPromise = (async () => {
      try {
        if (jailSecondaryToken) {
          // A transient saved-token verification failure already established a
          // restore backoff. Honour it here instead of re-running /api/auth/me
          // on every watchdog tick while the underlying problem persists.
          const verificationWaitMs = Math.max(0, jailSecondaryLoginBackoffUntil - Date.now());
          if (verificationWaitMs > 0) {
            scheduleSecondarySessionRestore(verificationWaitMs);
            return '';
          }
          try {
            await verifySecondaryGameSessionAgainstMain();
            return jailSecondaryToken;
          } catch (error) {
            if (error?.code === 'secondary_account_mismatch') {
              await stopSecondaryJailStream({ logout: true });
              error.secondaryHandled = true;
              throw error;
            }
            if (Number(error?.status) === 401 && error?.secondaryAuthSource === 'secondary') {
              await invalidateSecondaryGameSession({ reason: 'saved secondary session expired' });
              return '';
            }
            // A main-session/auth check or transient verification failure must
            // not destroy a valid secondary token or spin once per watchdog.
            deferSecondaryLoginRestore();
            error.secondaryHandled = true;
            throw error;
          }
        }

        const waitMs = secondaryLoginRecoveryWaitMs();
        if (waitMs > 0) {
          scheduleSecondarySessionRestore(waitMs);
          return '';
        }

        let session;
        try {
          session = await createSecondaryGameSession();
        } catch (error) {
          await handleSecondaryLoginFailure(error);
          throw error;
        }
        if (!jailSecondaryEnabled) {
          await logoutSecondaryGameSession(session.token);
          return '';
        }
        jailSecondaryToken = session.token;
        jailSecondaryUserId = session.userId;
        jailSecondaryTokenCreatedAt = Date.now();
        persistSecondaryJailState();
        if (jailStreamShouldRun()) connectSecondaryJailStream();
        return jailSecondaryToken;
      } finally {
        jailSecondarySessionPromise = null;
      }
    })();
    return jailSecondarySessionPromise;
  }

  async function invalidateSecondaryGameSession({ reason = 'secondary session rejected' } = {}) {
    const oldToken = jailSecondaryToken;
    const wasFresh = Boolean(jailSecondaryTokenCreatedAt && Date.now() - jailSecondaryTokenCreatedAt <= SECONDARY_FRESH_SESSION_GRACE_MS);
    jailSecondaryToken = '';
    jailSecondaryUserId = '';
    jailSecondaryTokenCreatedAt = 0;
    jailSecondaryVerifiedMainUserId = '';
    jailSecondaryReady = false;
    persistSecondaryJailState();
    if (oldToken) await logoutSecondaryGameSession(oldToken);

    if (wasFresh) {
      await stopSecondaryJailStream({ logout: false });
      log(`Secondary jail stream disabled: a newly-created session was immediately rejected (${reason})`, 'warn');
      return;
    }
    if (jailSecondaryEnabled && jailStreamShouldRun()) {
      deferSecondaryLoginRestore();
    }
  }

  function connectSecondaryJailStream() {
    if (jailPageExiting || !jailSecondaryEnabled || !jailStreamShouldRun() || !jailSecondaryToken || jailSecondaryRequest) return;
    resetJailRoutingRecent('secondary');
    jailDiagnostics.secondaryStreamConnectAttempts += 1;
    noteJailRoutingTrace('secondary-connect', 'opening');
    const generation = ++jailSecondaryConnectionGeneration;
    let started = false;
    try {
      jailSecondaryRequest = GM_xmlhttpRequest({
        method: 'GET',
        url: new URL('/api/jail/stream', location.origin).href,
        anonymous: true,
        cookie: `ug_session=${jailSecondaryToken}`,
        headers: { Accept: 'text/event-stream' },
        responseType: 'stream',
        onloadstart: (response) => {
          if (jailPageExiting || generation !== jailSecondaryConnectionGeneration) return;
          started = true;
          if (response.status && response.status !== 200) {
            jailDiagnostics.secondaryStreamErrors += 1;
            if (jailSecondaryRequest?.abort) { try { jailSecondaryRequest.abort(); } catch {} }
            jailSecondaryRequest = null;
            jailSecondaryReady = false;
            clearDisconnectedJailSnapshot('secondary');
            if (response.status === 401) {
              void invalidateSecondaryGameSession({ reason: 'stream returned HTTP 401' });
            } else {
              // A 403 does not prove the session is invalid. Reconnect with the
              // normal stream backoff instead of creating another login/session.
              scheduleSecondaryJailReconnect();
            }
            scheduleRuntimePersist();
            return;
          }
          void consumeSecondaryJailStream(response.response, generation).catch(() => {
            if (!jailSecondaryEnabled || jailPageExiting || generation !== jailSecondaryConnectionGeneration) return;
            jailDiagnostics.secondaryStreamErrors += 1;
            jailSecondaryRequest = null;
            jailSecondaryReady = false;
            clearDisconnectedJailSnapshot('secondary');
            scheduleSecondaryJailReconnect();
          });
        },
        onload: () => {
          if (jailPageExiting || generation !== jailSecondaryConnectionGeneration) return;
          jailSecondaryRequest = null;
          jailSecondaryReady = false;
          clearDisconnectedJailSnapshot('secondary');
          if (jailSecondaryEnabled) scheduleSecondaryJailReconnect();
        },
        onerror: () => {
          if (jailPageExiting || generation !== jailSecondaryConnectionGeneration) return;
          jailDiagnostics.secondaryStreamErrors += 1;
          jailSecondaryRequest = null;
          jailSecondaryReady = false;
          clearDisconnectedJailSnapshot('secondary');
          if (jailSecondaryEnabled) scheduleSecondaryJailReconnect();
        },
        onabort: () => {
          jailDiagnostics.secondaryGmAbortEvents += 1;
          if (jailPageExiting || generation !== jailSecondaryConnectionGeneration) return;
          jailSecondaryRequest = null;
          jailSecondaryReady = false;
          clearDisconnectedJailSnapshot('secondary');
        },
      });
    } catch (error) {
      jailDiagnostics.secondaryStreamErrors += 1;
      jailSecondaryRequest = null;
      jailSecondaryReady = false;
      clearDisconnectedJailSnapshot('secondary');
      if (started) scheduleSecondaryJailReconnect();
      throw error;
    }
  }

  async function startSecondaryJailStream() {
    if (!hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) throw new Error('Fast jail is not enabled.');
    if (jailSecondaryEnabled && jailSecondaryToken) {
      syncJailStream();
      return;
    }
    jailSecondaryEnabled = true;
    jailSecondaryReconnectDelayMs = 1_000;
    // A deliberate Start may clear a transient wait, but the rolling login
    // attempt budget is retained so repeated clicks cannot defeat the cap.
    jailSecondaryLoginBackoffUntil = 0;
    jailSecondaryLoginBackoffMs = SECONDARY_LOGIN_BACKOFF_BASE_MS;
    persistSecondaryJailState();
    try {
      if (!jailSecondaryToken) await ensureSecondaryGameSession();
      if (!jailSecondaryToken) throw new Error('Secondary jail session is waiting for a safe retry.');
      if (jailSecondaryToken && jailStreamShouldRun()) connectSecondaryJailStream();
      persistSecondaryJailState();
    } catch (error) {
      if (!error?.secondaryHandled) await stopSecondaryJailStream({ logout: true });
      throw error;
    }
  }

  async function stopSecondaryJailStream({ logout = false } = {}) {
    jailSecondaryEnabled = false;
    jailSecondaryReady = false;
    if (jailSecondaryRestoreTimer) clearTimeout(jailSecondaryRestoreTimer);
    jailSecondaryRestoreTimer = null;
    if (jailSecondaryReconnectTimer) clearTimeout(jailSecondaryReconnectTimer);
    jailSecondaryReconnectTimer = null;
    jailSecondaryConnectionGeneration += 1;
    if (jailSecondaryRequest?.abort) {
      try { jailSecondaryRequest.abort(); jailDiagnostics.secondaryStreamAbortedOnStop += 1; } catch {}
    }
    jailSecondaryRequest = null;
    jailSecondaryLatestInmates = [];
    jailSecondarySnapshotPrimed = false;
    jailSecondaryPreviousTargets = new Set();
    const oldToken = jailSecondaryToken;
    jailSecondaryToken = '';
    jailSecondaryUserId = '';
    jailSecondaryTokenCreatedAt = 0;
    jailSecondaryVerifiedMainUserId = '';
    jailTargetSightings.clear();
    persistSecondaryJailState();
    if (logout && oldToken) await logoutSecondaryGameSession(oldToken);
  }

  function stopJailStream() {
    if (jailReconnectTimer) clearTimeout(jailReconnectTimer);
    jailReconnectTimer = null;
    if (jailStreamBustTimer) clearTimeout(jailStreamBustTimer);
    jailStreamBustTimer = null;
    if (jailEventSource) {
      try { jailEventSource.close(); jailDiagnostics.primaryStreamClosedOnStop += 1; } catch {}
      jailEventSource = null;
    }
    jailStreamReady = false;
    jailLatestStreamInmates = [];
    jailLiveSnapshotPrimed = false;
    jailLivePreviousTargets = new Set();
    jailLiveFreshTargets = [];
    jailSecondaryConnectionGeneration += 1;
    if (jailSecondaryRequest?.abort) { try { jailSecondaryRequest.abort(); } catch {} }
    jailSecondaryRequest = null;
    jailSecondaryReady = false;
    jailSecondaryLatestInmates = [];
    jailSecondarySnapshotPrimed = false;
    jailSecondaryPreviousTargets = new Set();
  }

  function syncJailStream() {
    if (jailPageExiting) return;
    if (!jailStreamShouldRun()) {
      stopJailStream();
      return;
    }
    if (!jailEventSource && !jailReconnectTimer) connectJailStream();
    if (jailSecondaryEnabled && !jailSecondaryRequest && !jailSecondaryReconnectTimer) {
      void ensureSecondaryGameSession().then((sessionToken) => {
        if (sessionToken && jailSecondaryEnabled && jailStreamShouldRun() && !jailSecondaryRequest && !jailSecondaryReconnectTimer) {
          connectSecondaryJailStream();
        }
      }).catch((error) => {
        jailDiagnostics.secondarySessionLoginErrors += 1;
        log(`Secondary jail stream restore: ${friendlyGameError(error)}`, 'warn');
      });
    }
  }

  function scheduleJailStreamReconnect() {
    if (jailPageExiting || !jailStreamShouldRun() || jailReconnectTimer) return;
    const delay = jailStreamReconnectDelayMs;
    jailStreamReconnectDelayMs = Math.min(15_000, jailStreamReconnectDelayMs * 2);
    jailReconnectTimer = setTimeout(() => {
      jailReconnectTimer = null;
      if (jailStreamShouldRun()) connectJailStream();
    }, delay);
  }

  function connectJailStream() {
    if (jailPageExiting || !jailStreamShouldRun() || jailEventSource) return;
    resetJailRoutingRecent('primary');
    noteJailRoutingTrace('primary-connect', 'opening');
    let source;
    jailDiagnostics.streamConnectAttempts += 1;
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
      jailDiagnostics.streamReady += 1;
      jailDiagnostics.primaryStreamReadyAfterRestore += 1;
      noteJailRoutingTrace('primary-ready', 'connected');
      jailStreamReady = true;
      jailStreamReconnectDelayMs = 1_000;
      state.jailStatus = state.inJail ? 'Live jail stream connected · waiting for release' : 'Live jail stream connected · watching inmates';
      scheduleRuntimePersist();
      render();
    });
    source.addEventListener('inmates', (event) => {
      const eventReceivedPerf = performance.now();
      if (jailEventSource !== source || !jailStreamShouldRun()) return;
      try {
        const payload = JSON.parse(String(event.data || '{}'));
        if (!Array.isArray(payload.inmates)) return;
        const refreshSource = payload.refreshSource === 'signal' || payload.refreshSource === 'watch' || payload.refreshSource === 'initial'
          ? payload.refreshSource
          : 'unknown';
        jailDiagnostics.inmateEvents += 1;
        if (refreshSource === 'signal') jailDiagnostics.inmateSourceSignal += 1;
        else if (refreshSource === 'watch') jailDiagnostics.inmateSourceWatch += 1;
        else if (refreshSource === 'initial') jailDiagnostics.inmateSourceInitial += 1;
        else jailDiagnostics.inmateSourceUnknown += 1;
        jailDiagnostics.lastInmateEventAt = Date.now();
        jailDiagnostics.lastInmateServerTime = String(payload.serverTime || '');
        const serverAt = Date.parse(String(payload.serverTime || ''));
        let serverAgeMs = -1;
        let serverGapMs = -1;
        let nearCadence = false;
        if (Number.isFinite(serverAt)) {
          serverAgeMs = Math.max(0, Date.now() - serverAt);
          jailDiagnostics.inmateEventServerAgeSamples += 1;
          jailDiagnostics.inmateEventServerAgeTotalMs += serverAgeMs;
          jailDiagnostics.inmateEventServerAgeMaxMs = Math.max(jailDiagnostics.inmateEventServerAgeMaxMs, serverAgeMs);
          if (jailDiagnostics.lastInmateServerAtMs > 0) {
            serverGapMs = Math.max(0, serverAt - jailDiagnostics.lastInmateServerAtMs);
            jailDiagnostics.inmateServerGapSamples += 1;
            jailDiagnostics.inmateServerGapTotalMs += serverGapMs;
            jailDiagnostics.inmateServerGapMinMs = jailDiagnostics.inmateServerGapMinMs > 0 ? Math.min(jailDiagnostics.inmateServerGapMinMs, serverGapMs) : serverGapMs;
            jailDiagnostics.inmateServerGapMaxMs = Math.max(jailDiagnostics.inmateServerGapMaxMs, serverGapMs);
            if (serverGapMs < 250) jailDiagnostics.inmateGapLt250 += 1;
            else if (serverGapMs < 750) jailDiagnostics.inmateGap250To749 += 1;
            else if (serverGapMs < 1250) jailDiagnostics.inmateGap750To1249 += 1;
            else if (serverGapMs < 2250) jailDiagnostics.inmateGap1250To2249 += 1;
            else jailDiagnostics.inmateGap2250Plus += 1;
            const nearestWholeSecond = Math.max(1, Math.round(serverGapMs / 1000)) * 1000;
            nearCadence = serverGapMs >= 700 && Math.abs(serverGapMs - nearestWholeSecond) <= 160;
            if (nearCadence) jailDiagnostics.inmateGapNearWholeSecond += 1;
          }
          jailDiagnostics.lastInmateServerAtMs = serverAt;
        }
        jailDiagnostics.eventSequence += 1;
        jailLatestEventMeta = {
          seq: jailDiagnostics.eventSequence,
          serverAtMs: Number.isFinite(serverAt) ? serverAt : 0,
          serverGapMs,
          serverAgeMs,
          nearCadence,
          refreshSource,
          receivedPerf: eventReceivedPerf,
          hidden: document.visibilityState === 'hidden',
        };
        noteJailTargetSightings('primary', payload.inmates, eventReceivedPerf);
        noteLiveJailSnapshot(payload.inmates);
        jailLatestStreamInmates = payload.inmates;
        try { noteIndependentJailSnapshot('primary', payload); } catch {} // Metrics must never interrupt live busting.
        try { noteJailCauseSnapshot('primary', payload.inmates); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
        scheduleRuntimePersist();

        // Owner hot path first. Player-discovery persistence/rendering used to run
        // synchronously before this call, delaying the actual bust request. Start
        // the jail lane now and move all unrelated discovery/UI work to a later
        // task so the fetch microtask can dispatch first.
        void processLiveJailSnapshot('primary');
        const pollCompareEpoch = jailPollCompareEpoch;
        const pollCompareReceivedAt = Date.now();
        queueMicrotask(() => {
          if (pollCompareEpoch !== jailPollCompareEpoch) return;
          try { noteJailPollVsStreamSnapshot('primary', payload.inmates, pollCompareReceivedAt); }
          catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
        });
        if (state.settings.discoverPlayers) {
          const discoveredNames = payload.inmates
            .filter((row) => row && row.isBot !== true && row.usernameHidden !== true)
            .map((row) => row.username);
          setTimeout(() => addDiscoveredPlayers(discoveredNames, 'Jail'), 0);
        }
      } catch {}
    });
    source.addEventListener('superseded', () => {
      if (jailEventSource !== source) return;
      jailDiagnostics.streamSuperseded += 1;
      jailDiagnostics.primarySseSupersededLifecycle += 1;
      noteJailRoutingTrace('primary-superseded', 'server-closed');
      source.close();
      jailEventSource = null;
      jailStreamReady = false;
      clearDisconnectedJailSnapshot('primary');
      scheduleJailStreamReconnect();
    });
    source.onerror = () => {
      if (jailEventSource !== source) return;
      jailDiagnostics.streamErrors += 1;
      noteJailRoutingTrace('primary-error', 'reconnecting');
      try { source.close(); } catch {}
      jailEventSource = null;
      jailStreamReady = false;
      clearDisconnectedJailSnapshot('primary');
      scheduleJailStreamReconnect();
    };
  }

  function liveJailCandidateRecord(inmate) {
    if (!inmate || inmate.isBot === true) return null;
    const viewerName = String(state.jailViewerUsername || '').trim().toLocaleLowerCase();
    const viewerToken = String(state.jailViewerBustToken || '').trim();
    const username = String(inmate.username || '').trim();
    const bustToken = String(inmate.bustToken || '').trim();
    const target = bustToken || username;
    if (!target || target.length > 64) return null;
    if (viewerToken && bustToken && viewerToken === bustToken) return null;
    if (!inmate.usernameHidden && viewerName && username.toLocaleLowerCase() === viewerName) return null;
    let reward = 0n;
    try { if (/^\d{1,36}$/.test(String(inmate.bustReward ?? ''))) reward = BigInt(String(inmate.bustReward)); } catch {}
    const seconds = Number.isFinite(Number(inmate.secondsRemaining)) ? Math.max(0, Number(inmate.secondsRemaining)) : 86_400;
    return { inmate, target, reward, seconds };
  }

  function noteLiveJailSnapshot(inmates) {
    const nextTargets = new Set();
    const newlySeen = [];
    const secondaryTargets = liveTargetSet(jailSecondaryReady ? jailSecondaryLatestInmates : []);
    for (const inmate of Array.isArray(inmates) ? inmates : []) {
      const candidate = liveJailCandidateRecord(inmate);
      if (!candidate) continue;
      nextTargets.add(candidate.target);
      if (jailLiveSnapshotPrimed && !jailLivePreviousTargets.has(candidate.target)) {
        // Only re-arm when BOTH prior streams were missing this target. An
        // unchanged target on another backend may be a stale cache entry.
        if (!secondaryTargets.has(candidate.target)) rearmNewJailEpisode(candidate.target);
        newlySeen.push(candidate.target);
      }
    }

    if (jailLiveSnapshotPrimed && newlySeen.length) {
      if (state.jailBustRunning) {
        jailDiagnostics.liveBusyPrimaryFreshTargets += newlySeen.filter((target) => !recentJailAttempt(target)).length;
      }
      const queued = new Set(jailLiveFreshTargets);
      for (const target of newlySeen) {
        if (recentJailAttempt(target)) continue;
        jailDiagnostics.liveFreshTargetsSeen += 1;
        if (!queued.has(target)) {
          jailLiveFreshTargets.push(target);
          queued.add(target);
        }
      }
    }

    jailLiveSnapshotPrimed = true;
    jailLivePreviousTargets = nextTargets;
    // Keep a target while either authenticated stream still sees it.
    jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => (nextTargets.has(target) || secondaryTargets.has(target)) && !recentJailAttempt(target));
  }

  function liveJailCandidate(inmates) {
    const candidates = [];
    const byTarget = new Map();
    for (const inmate of Array.isArray(inmates) ? inmates : []) {
      const candidate = liveJailCandidateRecord(inmate);
      if (!candidate || recentJailAttempt(candidate.target)) continue;
      candidates.push(candidate);
      byTarget.set(candidate.target, candidate);
    }
    if (!candidates.length) return null;

    // Count is the goal on the private fast lane. When multiple choices exist,
    // deliberately avoid the conventional highest-reward/shortest-sentence
    // target that competing automation is most likely to choose.
    const collisionOrder = (a, b) => a.reward !== b.reward
      ? (a.reward < b.reward ? -1 : 1)
      : b.seconds - a.seconds;

    const fresh = [];
    const retainedFreshTargets = [];
    for (const target of jailLiveFreshTargets) {
      const candidate = byTarget.get(target);
      if (!candidate) continue;
      retainedFreshTargets.push(target);
      fresh.push(candidate);
    }
    jailLiveFreshTargets = retainedFreshTargets;

    if (fresh.length) {
      // Prioritise candidates most recently seen as newly jailed. Older
      // candidates in a burst are more likely to have been claimed already.
      // Retain the old reward/seconds order only for equal observation times.
      fresh.sort((a, b) => {
        const aAt = jailTargetSightings.get(a.target)?.firstAt || 0;
        const bAt = jailTargetSightings.get(b.target)?.firstAt || 0;
        return bAt - aAt || collisionOrder(a, b);
      });
      let chosen = fresh[0];
      let secondaryPreferenceOverride = false;
      // v2.2.23: when several fresh candidates are ALREADY available, prefer
      // a secondary-only target. v2.2.22 measured 542/622 secondary-only
      // successes versus 146/1271 primary-only; the classification is an
      // observation, not proof that one feed is inherently always faster.
      // Do not wait for secondary or suppress primary when it is the only choice.
      if (fresh.length > 1 && jailSecondaryEnabled && jailSecondaryReady) {
        const primaryTargets = liveTargetSet(jailLatestStreamInmates);
        const secondaryTargets = liveTargetSet(jailSecondaryLatestInmates);
        const preferred = fresh.find((item) => secondaryTargets.has(item.target) && !primaryTargets.has(item.target));
        if (preferred && preferred.target !== chosen.target) {
          chosen = preferred;
          secondaryPreferenceOverride = true;
        }
      }
      return { ...chosen, freshSelection: true, candidateCount: candidates.length, secondaryPreferenceOverride };
    }

    candidates.sort(collisionOrder);
    return { ...candidates[0], freshSelection: false, candidateCount: candidates.length, secondaryPreferenceOverride:false };
  }

  async function processLiveJailSnapshot(trigger = 'other') {
    if (!jailStreamShouldRun()) return;
    if (state.inJail) { jailDiagnostics.liveSnapshotsBlockedInJail += 1; return; }
    if (state.jailBustRunning) { jailDiagnostics.liveSnapshotsBlockedBusy += 1; return; }
    const candidate = liveJailCandidate(mergedLiveJailInmates());
    if (!candidate) { jailDiagnostics.liveSnapshotsNoCandidate += 1; return; }
    const rateWait = Math.max(0, state.lastJailBustAt + FAST_JAIL_BUST_MIN_INTERVAL_MS - Date.now());
    if (rateWait > 0) {
      jailDiagnostics.liveSnapshotsRateDeferred += 1;
      if (!jailStreamBustTimer) {
        jailStreamBustTimer = setTimeout(() => {
          jailStreamBustTimer = null;
          void processLiveJailSnapshot('timer');
        }, rateWait);
      }
      return;
    }

    state.jailBustRunning = true;
    markFeatureEpoch('jail');
    jailDiagnostics.liveBustAttempts += 1;
    jailRecentAttemptedTargets.set(candidate.target, Date.now());
    const primaryTargetsAtDispatch = liveTargetSet(jailLatestStreamInmates);
    const secondaryTargetsAtDispatch = liveTargetSet(jailSecondaryLatestInmates);
    const primarySeenAtDispatch = primaryTargetsAtDispatch.has(candidate.target);
    const secondarySeenAtDispatch = secondaryTargetsAtDispatch.has(candidate.target);
    const secondaryOnlySelection = !primarySeenAtDispatch && secondarySeenAtDispatch;
    const primaryOnlySelection = primarySeenAtDispatch && !secondarySeenAtDispatch;
    const bothSeenSelection = primarySeenAtDispatch && secondarySeenAtDispatch;
    const streamSighting = streamSightingForTarget(candidate.target);
    if (secondaryOnlySelection) jailDiagnostics.secondaryOnlySelections += 1;
    if (primaryOnlySelection) jailDiagnostics.primaryOnlySelections += 1;
    if (bothSeenSelection) jailDiagnostics.bothSeenSelections += 1;
    if (streamSighting.firstStream === 'primary') jailDiagnostics.firstSeenPrimarySelections += 1;
    else if (streamSighting.firstStream === 'secondary') jailDiagnostics.firstSeenSecondarySelections += 1;
    if (streamSighting.leadStream === 'primary') {
      jailDiagnostics.primaryLeadSamples += 1;
      jailDiagnostics.primaryLeadTotalMs += streamSighting.leadMs;
      jailDiagnostics.primaryLeadMaxMs = Math.max(jailDiagnostics.primaryLeadMaxMs, streamSighting.leadMs);
    } else if (streamSighting.leadStream === 'secondary') {
      jailDiagnostics.secondaryLeadSamples += 1;
      jailDiagnostics.secondaryLeadTotalMs += streamSighting.leadMs;
      jailDiagnostics.secondaryLeadMaxMs = Math.max(jailDiagnostics.secondaryLeadMaxMs, streamSighting.leadMs);
    } else if (streamSighting.leadStream === 'tie') {
      jailDiagnostics.streamLeadTies += 1;
    }
    if (candidate.freshSelection) {
      jailDiagnostics.liveFreshSelections += 1;
      jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => target !== candidate.target);
    } else {
      jailDiagnostics.liveFallbackSelections += 1;
    }
    if (candidate.candidateCount > 1) jailDiagnostics.liveMultiCandidateSelections += 1;
    if (candidate.secondaryPreferenceOverride) jailDiagnostics.liveSecondaryPreferenceOverrides += 1;
    const selectedStream = primaryOnlySelection ? 'primary' : secondaryOnlySelection ? 'secondary' : bothSeenSelection ? 'both' : 'none';
    jailActiveBustSelectedStream = selectedStream;
    let independentContext = { selectedStream, trigger:'other', crossRemoved:'none' };
    try {
      independentContext = independentBustContext(candidate.target, selectedStream, trigger);
      noteIndependentBustOutcome(independentContext, 'attempt');
    } catch {} // Failure to measure must never stop the request.
    let pollBustContext = null;
    try {
      pollBustContext = jailPollSupportForBust(candidate.target, selectedStream);
      noteJailPollSupportOutcome(pollBustContext, 'attempt');
    } catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
    let causeContext = null;
    try {
      causeContext = jailCauseContext(candidate, primaryOnlySelection, secondaryOnlySelection, bothSeenSelection);
      noteJailCauseOutcome(causeContext, 'attempt');
    } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
    const diagnosticBustStartedAt = performance.now();
    const eventMeta = { ...jailLatestEventMeta };
    const trace = {
      seq: eventMeta.seq,
      gapMs: eventMeta.serverGapMs,
      ageMs: eventMeta.serverAgeMs,
      cadence: eventMeta.nearCadence ? 'near1s' : 'off',
      source: eventMeta.refreshSource || 'unknown',
      firstStream: streamSighting.firstStream || 'unknown',
      leadMs: streamSighting.leadMs,
      hidden: streamSighting.firstAt > 0 ? (streamSighting.firstHidden ? 1 : 0) : (eventMeta.hidden ? 1 : 0),
      eventToDispatchMs: 0,
      candidates: candidate.candidateCount,
      fresh: candidate.freshSelection ? 1 : 0,
      outcome: 'pending',
      networkMs: 0,
      independent: independentContext,
      cause: causeContext,
    };
    jailDiagnostics.attemptTrace.push(trace);
    if (jailDiagnostics.attemptTrace.length > 80) jailDiagnostics.attemptTrace.splice(0, jailDiagnostics.attemptTrace.length - 80);
    if (eventMeta.nearCadence) jailDiagnostics.attemptNearCadence += 1;
    else jailDiagnostics.attemptOffCadence += 1;
    if (trace.source === 'signal') jailDiagnostics.attemptSourceSignal += 1;
    else if (trace.source === 'watch') jailDiagnostics.attemptSourceWatch += 1;
    else if (trace.source === 'initial') jailDiagnostics.attemptSourceInitial += 1;
    else jailDiagnostics.attemptSourceUnknown += 1;
    if (trace.hidden) jailDiagnostics.attemptHidden += 1;
    else jailDiagnostics.attemptVisible += 1;
    const inmate = candidate.inmate;
    const displayName = inmate?.usernameHidden ? 'Unknown' : String(inmate?.username || 'player');
    state.lastJailBustAt = Date.now();

    // Ultra-fast owner lane: do not render or enqueue through the generic
    // mutation-tail before the request. The live lane intentionally has no
    // artificial 205 ms spacing: gameJsonDirect's jailBust bucket still caps
    // dispatches at 5 per rolling second, while jailBustRunning keeps requests
    // sequential so the server never sees overlapping actions from this lane.
    const dispatchPrepMs = Math.max(0, performance.now() - diagnosticBustStartedAt);
    jailDiagnostics.liveDispatchPrepSamples += 1;
    jailDiagnostics.liveDispatchPrepTotalMs += dispatchPrepMs;
    jailDiagnostics.liveDispatchPrepMaxMs = Math.max(jailDiagnostics.liveDispatchPrepMaxMs, dispatchPrepMs);

    try {
      const firstSeenPerf = streamSighting.firstAt > 0 ? streamSighting.firstAt : eventMeta.receivedPerf;
      const eventToDispatchMs = firstSeenPerf > 0 ? Math.max(0, performance.now() - firstSeenPerf) : 0;
      trace.eventToDispatchMs = eventToDispatchMs;
      if (firstSeenPerf > 0) {
        jailDiagnostics.liveEventToDispatchSamples += 1;
        jailDiagnostics.liveEventToDispatchTotalMs += eventToDispatchMs;
        jailDiagnostics.liveEventToDispatchMaxMs = Math.max(jailDiagnostics.liveEventToDispatchMaxMs, eventToDispatchMs);
      }
      const result = await gameJsonDirect(`/api/jail/bust/${encodeURIComponent(candidate.target)}`, {
        method: 'POST',
        priority: REQUEST_PRIORITY.ACTION,
        // If the 5/sec safety bucket has to hold this request, do not spend the
        // next available slot on a target that disappeared while queued.
        validate: () => {
          const stillPresent = mergedLiveJailInmates().some((row) => String(row?.bustToken || row?.username || '').trim() === candidate.target);
          if (!stillPresent) {
            jailDiagnostics.liveQueuedTargetDropped += 1;
            trace.outcome = 'queue-stale';
            throw new ActionCancelledError('Queued jail target is no longer present');
          }
        },
      });
      if (result?.success === false) {
        jailDiagnostics.liveBustOtherErrors += 1;
        trace.outcome = 'response-false';
        try { noteJailCauseOutcome(causeContext, 'failure', { status:200, body:result }); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
      } else {
        jailStaleTargetBackoff.delete(candidate.target);
        jailDiagnostics.liveBustSuccess += 1;
        if (secondaryOnlySelection) jailDiagnostics.secondaryOnlySuccess += 1;
        if (primaryOnlySelection) jailDiagnostics.primaryOnlySuccess += 1;
        if (bothSeenSelection) jailDiagnostics.bothSeenSuccess += 1;
        if (streamSighting.firstStream === 'primary') jailDiagnostics.firstSeenPrimarySuccess += 1;
        else if (streamSighting.firstStream === 'secondary') jailDiagnostics.firstSeenSecondarySuccess += 1;
        trace.outcome = 'success';
        try { noteIndependentBustOutcome(independentContext, 'success'); } catch {}
        try { noteJailCauseOutcome(causeContext, 'success'); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
        try { noteJailPollSupportOutcome(pollBustContext, 'success'); } catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
        if (eventMeta.nearCadence) jailDiagnostics.successNearCadence += 1;
        else jailDiagnostics.successOffCadence += 1;
        if (trace.source === 'signal') jailDiagnostics.successSourceSignal += 1;
        else if (trace.source === 'watch') jailDiagnostics.successSourceWatch += 1;
        else if (trace.source === 'initial') jailDiagnostics.successSourceInitial += 1;
        else jailDiagnostics.successSourceUnknown += 1;
        if (trace.hidden) jailDiagnostics.successHidden += 1;
        else jailDiagnostics.successVisible += 1;
      }
      jailDiagnostics.lastBustStatus = result?.success === false ? 'response-success-false' : 'success';
      jailDiagnostics.lastBustAt = Date.now();
      state.currentAction = `Busted ${displayName}`;
      state.jailStatus = `Live stream · ${state.currentAction}`;
      const resultHtml = result?.html;
      const resultWasFalse = result?.success === false;
      setTimeout(() => log(cleanGameMessage(resultHtml) || `Busted ${displayName}`, resultWasFalse ? 'warn' : 'ok'), 0);
      jailLatestStreamInmates = jailLatestStreamInmates.filter((row) => String(row?.bustToken || row?.username || '').trim() !== candidate.target);
      jailSecondaryLatestInmates = jailSecondaryLatestInmates.filter((row) => String(row?.bustToken || row?.username || '').trim() !== candidate.target);
      jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => target !== candidate.target);
      state.jailBustDueAt = Math.max(state.jailBustDueAt, state.lastJailBustAt + JAIL_BUST_MIN_INTERVAL_MS);
    } catch (error) {
      if (error instanceof ActionCancelledError) return;
      const message = friendlyGameError(error);
      const gotCaught = error?.body?.success === false || /got caught trying to bust|cannot bust players while you are in jail/i.test(message);
      const stale = error?.status === 404 || (error?.status === 400 && /not in jail|no longer in jail|dead|not found/i.test(message));
      if (gotCaught) { jailDiagnostics.liveBustCaught += 1; trace.outcome = 'caught'; }
      else if (error?.status === 429) { jailDiagnostics.liveBust429 += 1; trace.outcome = '429'; }
      else if (stale) {
        backoffStaleJailTarget(candidate.target);
        jailDiagnostics.liveBustStale += 1;
        if (secondaryOnlySelection) jailDiagnostics.secondaryOnlyStale += 1;
        if (primaryOnlySelection) jailDiagnostics.primaryOnlyStale += 1;
        if (bothSeenSelection) jailDiagnostics.bothSeenStale += 1;
        if (streamSighting.firstStream === 'primary') jailDiagnostics.firstSeenPrimaryStale += 1;
        else if (streamSighting.firstStream === 'secondary') jailDiagnostics.firstSeenSecondaryStale += 1;
        trace.outcome = 'stale';
        try { noteIndependentBustOutcome(independentContext, 'stale'); } catch {}
        try { noteJailCauseOutcome(causeContext, 'stale'); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
        try { noteJailPollSupportOutcome(pollBustContext, 'stale'); } catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
        if (eventMeta.nearCadence) jailDiagnostics.staleNearCadence += 1;
        else jailDiagnostics.staleOffCadence += 1;
        if (trace.source === 'signal') jailDiagnostics.staleSourceSignal += 1;
        else if (trace.source === 'watch') jailDiagnostics.staleSourceWatch += 1;
        else if (trace.source === 'initial') jailDiagnostics.staleSourceInitial += 1;
        else jailDiagnostics.staleSourceUnknown += 1;
        if (trace.hidden) jailDiagnostics.staleHidden += 1;
        else jailDiagnostics.staleVisible += 1;
      } else { jailDiagnostics.liveBustOtherErrors += 1; trace.outcome = `error-${Number(error?.status) || 0}`; }
      try { noteJailCauseOutcome(causeContext, 'failure', error); } catch { jailDiagnostics.causeDiagMetricsErrors += 1; }
      jailDiagnostics.lastBustStatus = gotCaught ? 'caught' : error?.status === 429 ? '429' : stale ? 'stale' : `error-${Number(error?.status) || 0}`;
      jailDiagnostics.lastBustAt = Date.now();
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
        jailSecondaryLatestInmates = jailSecondaryLatestInmates.filter((row) => String(row?.bustToken || row?.username || '').trim() !== candidate.target);
        jailLiveFreshTargets = jailLiveFreshTargets.filter((target) => target !== candidate.target);
      } else {
        state.jailStatus = `Live jailbust failed: ${message}`;
        log(`Jailbust: ${message}`, 'error');
      }
    } finally {
      const diagnosticBustRoundTrip = Math.max(0, performance.now() - diagnosticBustStartedAt);
      trace.networkMs = Math.round(diagnosticBustRoundTrip);
      jailDiagnostics.liveBustRoundTripSamples += 1;
      jailDiagnostics.liveBustRoundTripTotalMs += diagnosticBustRoundTrip;
      jailDiagnostics.liveBustRoundTripMaxMs = Math.max(jailDiagnostics.liveBustRoundTripMaxMs, diagnosticBustRoundTrip);
      // Successful/stale/caught/queue-stale attempts end this target's current
      // jail episode. Drop its timing record immediately so a later re-jail of
      // the same player cannot inherit an old first-seen timestamp.
      if (trace.outcome === 'success' || trace.outcome === 'stale' || trace.outcome === 'caught' || trace.outcome === 'queue-stale') {
        jailTargetSightings.delete(candidate.target);
      }
      scheduleRuntimePersist();
      state.jailBustRunning = false;
      jailActiveBustSelectedStream = 'none';
      // Drain another currently-visible real inmate before repainting the UI.
      // The request bucket below gameJsonDirect provides the 5/sec safety cap;
      // skipping an intermediate render removes avoidable race latency when
      // inmates arrive in a cluster.
      const canContinueBurst = trace.outcome === 'success' || trace.outcome === 'stale' || trace.outcome === 'queue-stale';
      if (canContinueBurst && !state.inJail && liveJailCandidate(mergedLiveJailInmates())) {
        jailDiagnostics.liveBurstContinuations += 1;
        void processLiveJailSnapshot('continuation');
        return;
      }
      render();
      wakeAutomation();
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
          if (state.settings.jailBust && mergedLiveJailInmates().length) void processLiveJailSnapshot();
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
      try { noteJailPollVsStreamSnapshot('poll', inmates); } catch { jailDiagnostics.pollDiagMetricsErrors += 1; }
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
        if ((jailStreamReady || jailSecondaryReady) && !isBot) continue;
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
      if (hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) {
        if (inmate?.isBot === true) jailDiagnostics.streamDiagPollBotAttempts += 1;
        else jailDiagnostics.streamDiagPollRealAttempts += 1;
      }
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
      if (hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)) {
        const suffix = inmate?.isBot === true ? 'Bot' : 'Real';
        if (!error && result?.success !== false) jailDiagnostics[`streamDiagPoll${suffix}Success`] += 1;
        if (targetStale) jailDiagnostics[`streamDiagPoll${suffix}Stale`] += 1;
      }

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
      if (jailStreamShouldRun() && !state.inJail && mergedLiveJailInmates().length) {
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


  // ---------------------------------------------------------------------------
  // Licensed robot bodyguard defence (userscript only; originally introduced in v2.2.29).
  // Game rules relied on below were checked read-only against the game source:
  //  * A shot at the owner is blocked by the highest-numbered occupied slot.
  //    New robots fill the first free position, which (after the server
  //    compacts the roster on every death) is above the existing guards, so
  //    the newest robot is always the outer (blocking) guard.
  //  * A blocked 1-bullet probe tells the attacker the outer guard's name and
  //    tells the owner nothing. Enemy knowledge cannot be observed, so
  //    "exposed" is a conservative local estimate: any robot that has been the
  //    outer guard, or whose history is unknown, is assumed to be known.
  //  * One POST /api/perks/redeem with several Robot perks creates them all in
  //    one transaction; only the last of the batch is ever the outer guard.
  //  * Killing your own robot never starts the 30 s replacement cooldown.
  //  * Shooting requires a found search, the same country, a gun and bullets;
  //    /api/kill/prepare prices the shot against the maximum armour.
  // Every mutation carries DEFENCE_REQUEST_TOKEN so the request gate can tell
  // a defence request from any other lane. No robot name is sent to the Worker.
  // ---------------------------------------------------------------------------
  function defenceEnabled() {
    return hasDefenceLicence() && state.settings.robotDefence === true;
  }

  function defenceRotationEnabled() {
    return defenceEnabled() && state.settings.robotDefenceRotate === true && state.settings.robotDefenceHybridConsent === true;
  }

  // Beam/Drugs travel and shooting pause while a rotation runs, and briefly
  // after an urgent rebuild had to wait for an in-flight Beam action.
  function defenceTravelLocked(now = Date.now()) {
    return state.defenceTravelLock === true || Number(state.defenceTravelLockUntil || 0) > now;
  }

  // Beam keeps the last DEFENCE_FLIGHT_RESERVE flights of the hourly airport
  // quota free for BG rotations (it can still drive).
  function defenceFlightReserveReached(airport) {
    if (!defenceRotationEnabled()) return false;
    const remaining = Number(airport?.flightsRemaining);
    return Number.isFinite(remaining) && remaining <= DEFENCE_FLIGHT_RESERVE;
  }

  function defenceBoundAccount() {
    return String(state.settings.robotDefenceAccount || '').trim();
  }

  function defenceAccountMatches(name) {
    const bound = defenceBoundAccount();
    return Boolean(bound && name && normalizePlayerName(bound) === normalizePlayerName(name));
  }

  function loadDefenceRoster() {
    const value = GM_getValue(KEYS.defenceRoster, {});
    return value && typeof value === 'object' && typeof value.owner === 'string' &&
      value.guards && typeof value.guards === 'object' ? value : {owner:'', guards:{}};
  }

  function saveDefenceRoster() {
    // Keep the most recently seen robots; the current roster is refreshed on
    // every observation, so it can never be evicted by older history.
    const entries = Object.entries(state.defenceRoster.guards)
      .sort((a, b) => Number(b[1]?.lastSeenAt || 0) - Number(a[1]?.lastSeenAt || 0))
      .slice(0, 24);
    state.defenceRoster.guards = Object.fromEntries(entries);
    GM_setValue(KEYS.defenceRoster, state.defenceRoster);
  }

  function defenceIsOwnRobotName(name) {
    const key = String(name || '');
    const guards = state.defenceRoster?.guards;
    return Boolean(key && guards && Object.prototype.hasOwnProperty.call(guards, key));
  }

  function defenceOccupiedSlots(page) {
    return (Array.isArray(page?.slots) ? page.slots : [])
      .filter(row => (row?.state === 'robot' || row?.state === 'player') && row?.username && Number(row?.health) > 0)
      .map(row => ({...row, name:String(row.username), number:Number(row.slotNumber), robot:row.state === 'robot'}))
      .sort((a, b) => a.number - b.number);
  }

  function defenceSlots(page) {
    return defenceOccupiedSlots(page).filter(row => row.robot);
  }

  function defenceOuterGuard(page) {
    const occupied = defenceOccupiedSlots(page);
    return occupied.length ? occupied[occupied.length - 1] : null;
  }

  function defenceIsBaseRobot(row) {
    return row?.rankName === DEFENCE_BASE_ROBOT_RANK && row?.armour === DEFENCE_BASE_ROBOT_ARMOUR;
  }

  function defenceCapacity(page) {
    // Mirrors robotBodyguardShopBlockReason / assertRobotBodyguardEntitlementCapacityLocked.
    const all = Array.isArray(page?.slots) ? page.slots : [];
    const num = (value, fallback) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) ? Number(value) : fallback;
    const robots = defenceSlots(page).length;
    const occupied = defenceOccupiedSlots(page).length;
    const pending = Math.max(0, num(page?.robotBodyguardsRemaining, 0));
    const robotMax = Math.max(0, Math.min(DEFENCE_ROBOT_MAX, num(page?.robotBodyguardActiveMax, DEFENCE_ROBOT_MAX)));
    const assigned = Math.max(occupied, num(page?.bodyguardsAssigned, occupied));
    const indexed = all.length > 0 && all.every(row => Number.isInteger(Number(row?.slotIndex)) && typeof row?.state === 'string');
    const positions = indexed
      ? all.filter(row => Number(row.slotIndex) < DEFENCE_ROBOT_MAX &&
          (row.state === 'locked' || (row.state === 'robot' && !(row.username && Number(row.health) > 0)))).length
      : Math.max(0, DEFENCE_ROBOT_MAX - occupied);
    const missing = Math.max(0, Math.min(robotMax - robots - pending, DEFENCE_ROBOT_MAX - assigned - pending, positions));
    const cooldown = Math.max(0, Math.ceil(num(page?.replacementSecondsRemaining, 0)));
    return {robots, occupied, pending, missing, cooldown, robotMax, points:num(page?.points, NaN)};
  }

  function observeDefenceSlots(page, owner) {
    const rows = defenceSlots(page);
    if (!owner) return rows; // never attribute a roster to an unconfirmed account
    let changed = false;
    if (normalizePlayerName(state.defenceRoster.owner) !== normalizePlayerName(owner)) {
      state.defenceRoster = {owner:String(owner), guards:{}, nextRotationAt:0};
      changed = true;
    }
    const now = Date.now();
    // A multi-perk redemption whose response was lost (timeout/network) can
    // still be verified: exactly the requested number of new robots on top of
    // an unchanged roster, with no enemy-kill cooldown in between.
    let batchHidden = null;
    const pending = state.defenceRoster.pendingBatch;
    if (pending && typeof pending === 'object') {
      const previous = Array.isArray(pending.previous) ? pending.previous : [];
      const names = rows.map(row => row.name);
      const fresh = names.filter(name => !previous.includes(name));
      if (now - Number(pending.at || 0) > 120_000) {
        delete state.defenceRoster.pendingBatch;
        changed = true;
      } else if (fresh.length) {
        const keptAll = previous.every(name => names.includes(name));
        const freshOnTop = fresh.length === Number(pending.count) &&
          names.slice(names.length - fresh.length).every(name => fresh.includes(name)) &&
          defenceOuterGuard(page)?.name === names[names.length - 1];
        if (keptAll && freshOnTop && fresh.length > 1 && !(Number(page?.replacementSecondsRemaining) > 0)) {
          batchHidden = new Set(fresh.slice(0, -1));
        }
        delete state.defenceRoster.pendingBatch;
        changed = true;
      }
    }
    for (const row of rows) {
      const guard = state.defenceRoster.guards[row.name];
      if (!guard && batchHidden?.has(row.name)) {
        state.defenceRoster.guards[row.name] = {known:false, verifiedHidden:true, exposedAt:0, searchedAt:0, lastSeenAt:now};
        changed = true;
      } else if (!guard) {
        // Unknown history is treated as compromised.
        state.defenceRoster.guards[row.name] = {known:true, verifiedHidden:false, exposedAt:0, searchedAt:0, lastSeenAt:now};
        changed = true;
      } else if (guard.known === false && guard.verifiedHidden !== true) {
        // v2.2.27 stored inferred concealment as known:false without an
        // independently verified marker. Do not silently trust that legacy
        // status when enabling the more consequential hybrid controller.
        guard.known = true;
        guard.verifiedHidden = false;
        guard.exposedAt = 0;
        guard.lastSeenAt = now;
        changed = true;
      } else if (now - Number(guard.lastSeenAt || 0) > 10 * 60_000) {
        guard.lastSeenAt = now;
        changed = true;
      }
    }
    // Exposure history across ANY gap between observations (bot stopped, page
    // reloaded, a robot added from another tab or by hand). A concealed robot
    // can only have been the outer guard if every robot above it in the last
    // observed roster has since died: robots added later always sit above it,
    // so it could have been exposed only before they arrived. In that case it
    // is treated as exposed from the last observation onward. Exact, never
    // optimistic, and independent of the polling interval.
    const currentNames = new Set(rows.map(row => row.name));
    const previousOrder = Array.isArray(state.defenceRoster.lastOrder) ? state.defenceRoster.lastOrder : null;
    if (previousOrder) {
      const lastSeenAt = Number(state.defenceLastObservedAt || state.defenceRoster.lastOrderAt || 0);
      previousOrder.forEach((name, index) => {
        const guard = state.defenceRoster.guards[name];
        if (!guard || guard.known !== false || !currentNames.has(name)) return;
        if (previousOrder.slice(index + 1).every(above => !currentNames.has(above))) {
          guard.known = true;
          guard.verifiedHidden = false;
          guard.exposedAt = Math.max(0, Math.min(lastSeenAt || 0, defenceExposureEstimate(page, now)));
          changed = true;
          log(`BG defence: concealed robot in slot ${rows.findIndex(row => row.name === name) + 1} may have been exposed between observations · now treated as known`, 'warn');
        }
      });
    }
    const outer = defenceOuterGuard(page);
    if (outer?.robot && state.defenceRoster.guards[outer.name]?.known !== true) {
      state.defenceRoster.guards[outer.name].known = true;
      state.defenceRoster.guards[outer.name].verifiedHidden = false;
      state.defenceRoster.guards[outer.name].exposedAt = defenceExposureEstimate(page, now);
      changed = true;
    }
    const order = rows.map(row => row.name);
    if (!previousOrder || previousOrder.join('|') !== order.join('|') || now - Number(state.defenceRoster.lastOrderAt || 0) > 60_000) {
      state.defenceRoster.lastOrder = order;
      state.defenceRoster.lastOrderAt = now;
      changed = true;
    }
    state.defenceLastObservedAt = now;
    if (changed) saveDefenceRoster();
    return rows;
  }

  // Earliest moment a robot first seen as the outer guard could have been
  // revealed. A visible enemy cooldown dates the enemy kill exactly; otherwise
  // assume it happened right after the previous observation (jail, timeouts
  // and a busy queue can delay observations well beyond one poll).
  function defenceExposureEstimate(page, now = Date.now()) {
    let at = now - DEFENCE_POLL_MS;
    const last = Number(state.defenceLastObservedAt || 0);
    if (last > 0 && last < at) at = last;
    const cooldown = Number(page?.replacementSecondsRemaining);
    if (Number.isFinite(cooldown) && cooldown > 0) {
      at = Math.min(at, now - Math.max(0, DEFENCE_REPLACEMENT_COOLDOWN_SECONDS - cooldown) * 1000 - 1000);
    }
    return Math.max(0, at);
  }

  // A robot is "safe" if no opponent can have a completed search on it within
  // `horizonMs`: it was never the outer guard, or it was first exposed less
  // than the 2.5 h search time (minus the safety lead) before now + horizon.
  function defenceGuardSafe(name, now = Date.now(), horizonMs = 0) {
    const guard = state.defenceRoster.guards?.[name];
    if (guard?.known === false && guard?.verifiedHidden === true) return true;
    const at = Number(guard?.exposedAt || 0);
    return at > 0 && now + horizonMs < at + DEFENCE_ENEMY_SEARCH_MS - DEFENCE_HYBRID_LEAD_MS;
  }

  async function defenceReadStats() {
    const stats = await defenceJson('/api/player/stats', {priority:REQUEST_PRIORITY.RAPID});
    const username = String(stats?.username || '').trim();
    if (!username) throw new Error('Could not confirm which account is logged in');
    if (Number(stats?.health) <= 0) {
      stopForDeath();
      throw new ActionCancelledError('Player is dead');
    }
    state.viewerUsername = username;
    state.deathProtected = stats?.deathProtected === true;
    state.deathProtectionCheckedAt = Date.now();
    state.deathProtectionSecondsRemaining = state.deathProtected
      ? Math.max(0, Math.ceil(Number(stats?.deathProtectionSecondsRemaining) || 0))
      : 0;
    state.defenceIdentity = {name:username, at:Date.now()};
    return {username, deathProtected:state.deathProtected};
  }

  async function defenceVerifiedOwner(force = false) {
    if (!defenceBoundAccount() && !state.defenceBindPending) {
      state.defenceStatus = 'Not bound to an account · untick and tick "Auto-replace" while logged in to the account to protect';
      return '';
    }
    let name = state.defenceIdentity?.name || '';
    if (force || state.defenceBindPending || !name || Date.now() - Number(state.defenceIdentity?.at || 0) > DEFENCE_IDENTITY_TTL_MS) {
      name = (await defenceReadStats()).username;
    }
    if (!defenceBoundAccount()) {
      if (!state.defenceBindPending) {
        state.defenceStatus = 'Not bound to an account · untick and tick "Auto-replace" while logged in to the account to protect';
        return '';
      }
      state.settings.robotDefenceAccount = name;
      state.defenceBindPending = false;
      saveSettings();
      log(`BG defence bound to ${name}`, 'info');
      return name;
    }
    if (!defenceAccountMatches(name)) {
      state.defenceStatus = `Paused · bound to ${defenceBoundAccount()}, logged in as ${name}`;
      return '';
    }
    return name;
  }

  async function defenceConfirmAccount(reportedName) {
    // Every page used before a mutation reports the logged-in username; a
    // session switched in another tab is caught here, before any action.
    const name = String(reportedName || '').trim() || (await defenceReadStats()).username;
    if (!defenceAccountMatches(name)) {
      state.defenceIdentity = null;
      state.defenceStatus = `Paused · bound to ${defenceBoundAccount() || 'no account'}, logged in as ${name}`;
      throw new ActionCancelledError('Logged-in account is not the bound BG defence account');
    }
    state.defenceIdentity = {name, at:Date.now()};
    return name;
  }

  async function defenceConfirmNow() {
    // Last read before a state-changing request: the game offers no
    // "expected account" parameter, so this keeps the window to one request.
    return defenceConfirmAccount((await defenceReadStats()).username);
  }

  function defenceRebindAfterRestart(oldUsername, newUsername) {
    // The bot's own death-restart replaces the character but not the owner.
    if (!newUsername || !defenceAccountMatches(oldUsername)) return;
    state.settings.robotDefenceAccount = String(newUsername);
    state.defenceIdentity = null;
    saveSettings();
    log(`BG defence binding moved from ${oldUsername} to ${newUsername} after restart`, 'info');
  }

  // Every BG defence read carries the defence token too, so the request
  // limiter serves it ahead of Beam and other lanes (see pumpRequestQueue).
  function defenceJson(path, options = {}) {
    return gameJson(path, {...options, defenceToken:DEFENCE_REQUEST_TOKEN});
  }

  function defencePost(path, body, options = {}) {
    const {rotation = false, validate = null, ...rest} = options;
    return gameJson(path, {
      ...rest,
      method:'POST',
      body,
      priority:REQUEST_PRIORITY.ACTION,
      defenceToken:DEFENCE_REQUEST_TOKEN,
      validate:() => {
        if (!defenceEnabled()) throw new ActionCancelledError('BG defence disabled');
        if (rotation && !defenceRotationEnabled()) throw new ActionCancelledError('BG rotation disabled');
        if (validate) validate();
      },
    });
  }

  async function defencePerkInventory() {
    const result = await defenceJson('/api/perks?v=con', {priority:REQUEST_PRIORITY.NORMAL});
    const ids = (Array.isArray(result?.groups) ? result.groups : [])
      .flatMap(group => (Array.isArray(group?.perks) ? group.perks : []).map(perk => ({perk, groupType:group?.effectType})))
      .filter(({perk, groupType}) => (perk?.effectType || groupType) === 'robot_bodyguard' &&
        perk?.id && perk.forSale !== true && perk.giftPending !== true)
      .map(({perk}) => String(perk.id));
    // A group hidden with the Perks page "hide" control is left out of
    // `groups` (the cookie overrides any query), but still counted here.
    const hidden = (Array.isArray(result?.groupOptions) ? result.groupOptions : [])
      .find(group => group?.key === 'robot_bodyguard' && group?.visible === false);
    return {ids:[...new Set(ids)], hidden:hidden ? Math.max(0, Number(hidden.count) || 0) : 0, username:String(result?.username || '')};
  }

  function defenceRobotPrice(cap) {
    // robotBodyguardPurchasePrice(active robots + pending robots).
    const index = Math.max(0, Math.min(DEFENCE_ROBOT_PRICES.length - 1, cap.robots + cap.pending));
    return DEFENCE_ROBOT_PRICES[index];
  }

  async function defencePointQuote(cap) {
    let cost = DEFENCE_FALLBACK_ROBOT_PRICE;
    let blockedReason = '';
    let points = NaN;
    try {
      const shop = await defenceJson('/api/points', {priority:REQUEST_PRIORITY.NORMAL});
      const item = (Array.isArray(shop?.shop) ? shop.shop : []).find(row => row?.id === DEFENCE_ROBOT_SHOP_ITEM);
      const quoted = Number(item?.cost);
      cost = Number.isSafeInteger(quoted) && quoted > 0 ? quoted : Math.max(defenceRobotPrice(cap), DEFENCE_FALLBACK_ROBOT_PRICE);
      blockedReason = cleanGameMessage(item?.blockedReason || '');
      if (Number.isFinite(Number(shop?.points))) points = Number(shop.points);
    } catch (error) {
      if (error instanceof ActionCancelledError) throw error;
      cost = DEFENCE_FALLBACK_ROBOT_PRICE; // unknown price: assume the highest tier
    }
    return {cost, blockedReason, points};
  }

  async function defenceRedeem(ids, previousNames, owner) {
    if (!ids.length) return false;
    await defenceConfirmNow();
    if (ids.length > 1) {
      // Lets the next observation verify the batch if this response is lost.
      state.defenceRoster.pendingBatch = {previous:[...previousNames], count:ids.length, at:Date.now()};
      saveDefenceRoster();
    }
    await defencePost('/api/perks/redeem', {perkIds:ids});
    const updated = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
    observeDefenceSlots(updated, owner);
    const created = defenceSlots(updated).filter(row => !previousNames.has(row.name));
    const outer = defenceOuterGuard(updated);
    // Only a verified batch earns a concealed estimate; anything unexpected is exposed.
    const verified = ids.length > 1 && created.length === ids.length;
    const now = Date.now();
    for (const row of created) {
      state.defenceRoster.guards[row.name] = {known:!verified || row.name === outer?.name,verifiedHidden:verified && row.name !== outer?.name,exposedAt:row.name === outer?.name ? now : 0,searchedAt:0,lastSeenAt:now};
    }
    saveDefenceRoster();
    log(`BG defence redeemed ${ids.length} Robot Bodyguard perk${ids.length === 1 ? '' : 's'}${verified ? ` (${created.length - (outer && created.some(r => r.name === outer.name) ? 1 : 0)} concealed)` : ''}`, 'ok');
    return true;
  }

  async function defenceBuyOne(owner, cost, recovery) {
    await defenceConfirmNow();
    await defencePost('/api/points/buy', {itemId:DEFENCE_ROBOT_SHOP_ITEM});
    const page = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
    const previously = new Set(Object.keys(state.defenceRoster.guards));
    observeDefenceSlots(page, owner); // the new robot is the outer guard
    for (const row of defenceSlots(page)) {
      if (!previously.has(row.name)) {
        state.defenceRoster.guards[row.name] = {known:true,verifiedHidden:false,exposedAt:Date.now(),searchedAt:0,lastSeenAt:Date.now()};
      }
    }
    saveDefenceRoster();
    log(`BG defence bought one robot for ${Number(cost).toLocaleString('en-GB')} points${recovery ? ' (rotation recovery: reserve not applied)' : ''}`, 'ok');
    return true;
  }

  async function defenceRefill(page, owner, {recovery = false, preferPoints = false} = {}) {
    const first = defenceCapacity(page);
    if (!first.missing) return {acted:false};
    if (first.cooldown > 0) return {acted:false, waitMs:Math.min(10_000, first.cooldown * 1000 + 250)};
    const inventory = await defencePerkInventory();
    await defenceConfirmAccount(inventory.username);
    // Re-read after the identity check so every figure belongs to this account.
    const fresh = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
    observeDefenceSlots(fresh, owner);
    const cap = defenceCapacity(fresh);
    if (!cap.missing) return {acted:false};
    if (cap.cooldown > 0) return {acted:false, waitMs:Math.min(10_000, cap.cooldown * 1000 + 250)};
    const names = new Set(defenceSlots(fresh).map(row => row.name));
    const perks = inventory.ids;
    if (cap.missing >= 2 && perks.length >= 2) {
      // One atomic request: every robot but the last stays concealed.
      await defenceRedeem(perks.slice(0, Math.min(cap.missing, perks.length)), names, owner);
      return {acted:true};
    }
    // A single replacement becomes the outer guard whether points or a perk
    // pays for it, so perks are kept for multi-robot batches and rotation
    // (the only way to create concealed robots) unless there is a surplus.
    if (!preferPoints && perks.length > DEFENCE_PERKS_KEPT_FOR_BATCHES) {
      await defenceRedeem(perks.slice(0, 1), names, owner);
      return {acted:true};
    }
    const quote = await defencePointQuote(cap);
    if (quote.blockedReason) {
      state.defenceStatus = `Robot purchase blocked: ${quote.blockedReason}`;
      return {acted:false, waitMs:10_000};
    }
    const reserve = recovery ? 0 : Math.max(0, Number(state.settings.robotDefencePointReserve) || 0);
    const points = Number.isFinite(quote.points) ? quote.points : cap.points;
    if (Number.isFinite(points) && points - quote.cost >= reserve) {
      await defenceBuyOne(owner, quote.cost, recovery);
      return {acted:true};
    }
    if (perks.length) {
      await defenceRedeem(perks.slice(0, 1), names, owner);
      return {acted:true};
    }
    const hiddenNote = inventory.hidden > 0
      ? ` · ${inventory.hidden} Robot Bodyguard perk${inventory.hidden === 1 ? ' is' : 's are'} hidden on the Perks page — unhide that group so BG defence can use them`
      : '';
    state.defenceStatus = `Missing ${cap.missing} BG${cap.missing === 1 ? '' : 's'} · needs ${(reserve + quote.cost).toLocaleString('en-GB')} points (${reserve.toLocaleString('en-GB')} reserve) or a Robot Bodyguard perk${hiddenNote}`;
    return {acted:false, waitMs:inventory.hidden > 0 ? 15_000 : 30_000};
  }

  function defenceSearchList(killData) {
    return {
      found: new Map((Array.isArray(killData?.found) ? killData.found : []).map(x => [normalizePlayerName(x.username), x])),
      pending: new Map((Array.isArray(killData?.pending) ? killData.pending : []).map(x => [normalizePlayerName(x.username), x])),
    };
  }

  async function defenceMaintainSearches(page, rows, killData) {
    // One search (or renewal) per rotation check. A found search can be
    // renewed without a new 2.5 h wait; pending searches never show a country.
    const searches = defenceSearchList(killData);
    const guards = state.defenceRoster.guards;
    const outerName = defenceOuterGuard(page)?.name;
    const order = row => row.name === outerName ? 1 : guards[row.name]?.known === false ? 2 : 0;
    const now = Date.now();
    const target = rows.slice().sort((a, b) => order(a) - order(b) || a.number - b.number).find(row => {
      const key = normalizePlayerName(row.name);
      const found = searches.found.get(key);
      if (found && Number(found.secondsRemaining) > DEFENCE_SEARCH_RENEW_SECONDS) return false;
      if (searches.pending.has(key)) return false;
      return now - Number(guards[row.name]?.searchedAt || 0) > DEFENCE_SEARCH_RETRY_MS;
    });
    if (!target) return killData;
    // Starting a search permanently removes temporary death protection.
    const stats = await defenceReadStats();
    await defenceConfirmAccount(stats.username);
    if (stats.deathProtected || !protectionMutationSafe()) {
      state.defenceRotationNote = 'searches wait while death protection is active (a search would remove it)';
      return killData;
    }
    guards[target.name].searchedAt = now; // recorded first so a failure is not retried every tick
    saveDefenceRoster();
    const renewing = searches.found.has(normalizePlayerName(target.name));
    const result = await defencePost('/api/kill/search', {username:target.name}, {rotation:true});
    state.killData = null;
    state.killDataLoadedAt = 0;
    log(`BG defence ${renewing ? 'renewed the search on' : 'started searching'} own robot in slot ${target.number}`, 'info');
    return result?.data && typeof result.data === 'object' && Array.isArray(result.data.found) ? result.data : killData;
  }

  function defenceShotBullets(prepared, assumedArmour, actualArmour) {
    // prepare prices the shot against `assumedArmour` (the maximum). The real
    // requirement differs only by the armour factor and is rounded up, so
    // ceil(prepared × actual / assumed) is never below it; +1 covers float error.
    const full = Number(prepared);
    if (!Number.isSafeInteger(full) || full < 2) return 0;
    const assumed = DEFENCE_ARMOUR_FACTORS[String(assumedArmour || '')];
    const actual = DEFENCE_ARMOUR_FACTORS[String(actualArmour || '')];
    if (state.defenceRoster.fullBullets === true || !assumed || !actual || actual >= assumed) return full;
    return Math.min(full, Math.ceil(full * actual / assumed) + 1);
  }

  function defencePlanRotation(page, killData, perkCount = DEFENCE_ROBOT_MAX) {
    const cap = defenceCapacity(page);
    const rows = defenceSlots(page);
    const occupied = defenceOccupiedSlots(page);
    const guards = state.defenceRoster.guards;
    const hiddenNow = rows.filter(row => guards[row.name]?.known === false).length;
    if (cap.cooldown > 0) return {reason:'replacement cooldown active', hiddenNow};
    if (rows.length !== DEFENCE_ROBOT_MAX || occupied.length !== DEFENCE_ROBOT_MAX) {
      return {reason:'needs four robot bodyguards and no human guards', hiddenNow};
    }
    const outer = occupied[occupied.length - 1];
    const searches = defenceSearchList(killData);
    const here = String(killData?.player?.location || '');
    const exposedInner = rows.filter(row => row.name !== outer.name && guards[row.name]?.known !== false);
    const candidates = [];
    let upgraded = 0;
    let unsearched = 0;
    for (const row of exposedInner) {
      if (!defenceIsBaseRobot(row)) { upgraded += 1; continue; }
      const found = searches.found.get(normalizePlayerName(row.name));
      if (!found?.location || Number(found.secondsRemaining) < DEFENCE_MIN_SEARCH_SECONDS) { unsearched += 1; continue; }
      candidates.push({...row, location:String(found.location)});
    }
    const byCountry = new Map();
    for (const row of candidates) {
      if (!byCountry.has(row.location)) byCountry.set(row.location, []);
      byCountry.get(row.location).push(row);
    }
    let best = null;
    for (const [country, list] of byCountry) {
      if (!best || list.length > best.list.length || (list.length === best.list.length && country === here)) best = {country, list};
    }
    if (exposedInner.length < 2) {
      return {reason:`${hiddenNow} of 3 inner robots estimated concealed · nothing worth rotating`, hiddenNow};
    }
    if (!best || best.list.length < 2) {
      const notes = [];
      if (upgraded) notes.push(`${upgraded} upgraded (never rotated)`);
      if (unsearched) notes.push(`${unsearched} awaiting a found search`);
      if (candidates.length >= 2) notes.push('exposed robots are in different countries');
      return {reason:`no two exposed inner robots can be rotated together${notes.length ? ` (${notes.join(', ')})` : ''}`, hiddenNow};
    }
    const count = Math.min(best.list.length, Math.max(0, Number(perkCount) || 0));
    if (count < 2) return {reason:'needs at least 2 Robot Bodyguard perks for an atomic replacement', hiddenNow};
    const targets = best.list.slice(0, count);
    return {
      targets,
      country:best.country,
      travel:best.country !== here,
      hiddenNow,
      hiddenAfter:hiddenNow + count - 1,
      rosterNames:rows.map(row => row.name),
    };
  }

  function defenceAutoRankSettingsObject(data) {
    const s = data?.settings || {};
    const fields = ['autoCrime','autoCrimeReset','autoGta','autoGtaReset','autoRepair','autoMelt','autoMeltReset','autoDrugRun','autoDrugRepair'];
    const settings = {};
    for (const field of fields) settings[field] = s[field] === true;
    settings.autoMeltCarNames = Array.isArray(s.autoMeltCarNames) ? s.autoMeltCarNames : [];
    const reserve = Number(s.minPointReserve);
    if (Number.isSafeInteger(reserve) && reserve >= 0) settings.minPointReserve = reserve;
    return settings;
  }

  async function defenceSuspendServerDrugRun(owner) {
    const data = await defenceJson('/api/auto-rank', {priority:REQUEST_PRIORITY.RAPID});
    if (data?.settings?.autoDrugRun !== true) return false;
    const saved = GM_getValue(KEYS.defenceAutoRankRestore, null);
    if (!saved || normalizePlayerName(saved.owner) !== normalizePlayerName(owner)) {
      // Written before the change so a reload mid-rotation still restores it.
      GM_setValue(KEYS.defenceAutoRankRestore, {owner, restoreAutoDrugRun:true, at:Date.now()});
    }
    await defenceConfirmNow();
    await defencePost('/api/auto-rank/settings', {...defenceAutoRankSettingsObject(data), autoDrugRun:false});
    log('Paused server Auto Rank Drug Run for BG rotation', 'info');
    return true;
  }

  async function defenceRestoreServerDrugRun(owner) {
    const saved = GM_getValue(KEYS.defenceAutoRankRestore, null);
    if (!saved || typeof saved !== 'object') return true;
    if (normalizePlayerName(saved.owner) !== normalizePlayerName(owner)) return false; // another account's pause: leave it
    const current = await defenceJson('/api/auto-rank', {priority:REQUEST_PRIORITY.RAPID});
    if (!current?.settings) throw new Error('Auto Rank settings unavailable');
    if (current.settings.autoDrugRun !== true) {
      await defenceConfirmNow();
      await defencePost('/api/auto-rank/settings', {...defenceAutoRankSettingsObject(current), autoDrugRun:true});
      log('Restored server Auto Rank Drug Run after BG rotation', 'info');
    }
    GM_setValue(KEYS.defenceAutoRankRestore, null);
    state.defenceRestoreRetryAt = 0;
    return true;
  }

  async function defenceTravelTo(country) {
    if (!country) return false;
    const airport = await defenceJson('/api/airport', {priority:REQUEST_PRIORITY.RAPID});
    const fly = (Array.isArray(airport?.destinations) ? airport.destinations : []).find(row => row?.name === country);
    if (airport?.available === true && fly && Number.isSafeInteger(Number(fly.id)) && Number(fly.id) > 0) {
      const result = await defencePost('/api/airport/fly', {location:Number(fly.id)}, {rotation:true});
      log(`BG rotation flew to ${country}`, 'info');
      return !result?.location || String(result.location) === country;
    }
    const drugs = await defenceJson('/api/drugs?page=1', {priority:REQUEST_PRIORITY.NORMAL});
    const drive = (Array.isArray(drugs?.locations) ? drugs.locations : []).find(row => row?.name === country);
    if (defenceCarUsable(drugs) && drive && Number.isSafeInteger(Number(drive.id)) && Number(drive.id) > 0) {
      const result = await defencePost('/api/drugs/drive', {location:Number(drive.id)}, {rotation:true});
      log(`BG rotation drove to ${country}`, 'info');
      return !result?.location || String(result.location) === country;
    }
    state.defenceRotationNote = `needs travel to ${country} but the airport and car are both unavailable`;
    return false;
  }

  async function defenceRestoreAfterSelfKills(perkIds, owner) {
    // Self-kills never start the replacement cooldown, so this normally runs
    // straight after the last shot. Prefer one atomic perk batch.
    let ids = perkIds.slice();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
      observeDefenceSlots(page, owner);
      const cap = defenceCapacity(page);
      if (!cap.missing) return true;
      if (cap.cooldown > 0) {
        // An enemy kill landed during the rotation; the normal refill path
        // replaces everything as soon as that cooldown ends.
        state.defenceRotationNote = `enemy kill during rotation · refilling after the ${cap.cooldown}s cooldown`;
        return false;
      }
      if (attempt > 0) {
        const inventory = await defencePerkInventory();
        await defenceConfirmAccount(inventory.username);
        ids = inventory.ids;
      }
      const count = Math.min(cap.missing, ids.length);
      if (count < 1) break;
      try {
        await defenceRedeem(ids.slice(0, count), new Set(defenceSlots(page).map(row => row.name)), owner);
      } catch (error) {
        if (error instanceof ActionCancelledError) throw error;
        log(`BG rotation replacement: ${friendlyGameError(error)}`, 'error');
      }
    }
    const page = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
    observeDefenceSlots(page, owner);
    const cap = defenceCapacity(page);
    if (!cap.missing || cap.cooldown > 0) return !cap.missing;
    // Last resort for robots the bot destroyed itself: points, ignoring the reserve.
    await defenceRefill(page, owner, {recovery:true});
    return false;
  }

  async function defenceRunRotation(plan, owner) {
    let perkIds = [];
    let killed = 0;
    let mutated = false;
    let outcome = 'aborted';
    const stop = (note) => { state.defenceRotationNote = note; return DEFENCE_POLL_MS; };
    state.defenceTravelLock = true; // pauses the local Drugs and Combat/Beam lanes
    try {
      if (state.drugsRunning || state.combatRunning) {
        outcome = 'deferred';
        return stop('waiting for the current drug run / combat action to finish');
      }
      const gun = String(plan.killData?.player?.gun || 'None');
      if (gun === 'None') return stop('needs a gun');
      const cached = state.defenceRoster.bullets;
      if (cached && cached.gun === gun && cached.rank === String(plan.killData?.player?.rankName || '')) {
        const estimate = defenceShotBullets(cached.prepared, cached.assumedArmour, DEFENCE_BASE_ROBOT_ARMOUR) * plan.targets.length;
        const have = Number(plan.killData?.player?.bullets);
        if (Number.isFinite(have) && estimate > have) {
          return stop(`needs about ${estimate.toLocaleString('en-GB')} bullets (have ${have.toLocaleString('en-GB')})`);
        }
      }
      await defenceSuspendServerDrugRun(owner);
      if (plan.travel) {
        mutated = true; // a flight costs money: never retry quickly
        await defenceConfirmNow();
        if (!(await defenceTravelTo(plan.country))) return DEFENCE_POLL_MS;
      }
      const kill = await defenceJson('/api/kill', {priority:REQUEST_PRIORITY.RAPID});
      await defenceConfirmAccount(kill?.player?.username);
      if (kill?.player?.alive === false) { stopForDeath(); throw new ActionCancelledError('Player is dead'); }
      if (String(kill?.player?.location || '') !== plan.country) return stop(`arrival in ${plan.country} not confirmed`);
      const found = defenceSearchList(kill).found;
      const targets = plan.targets.filter(row => {
        const search = found.get(normalizePlayerName(row.name));
        return search && String(search.location || '') === plan.country && Number(search.secondsRemaining) >= DEFENCE_MIN_SEARCH_SECONDS;
      }).map(row => ({...row}));
      if (targets.length < 2) return stop('searches changed before shooting');
      let total = 0;
      for (const target of targets) {
        const prepared = await defencePost('/api/kill/prepare', {username:target.name}, {rotation:true});
        target.prepared = Number(prepared?.bullets);
        target.bullets = defenceShotBullets(prepared?.bullets, prepared?.assumedArmour, target.armour);
        if (!target.bullets) return stop('could not price the shot');
        total += target.bullets;
        state.defenceRoster.bullets = {
          gun:String(kill?.player?.gun || ''), rank:String(kill?.player?.rankName || ''),
          prepared:target.prepared, assumedArmour:String(prepared?.assumedArmour || ''), at:Date.now(),
        };
      }
      saveDefenceRoster();
      const bullets = Number(kill?.player?.bullets);
      if (!Number.isFinite(bullets) || bullets < total) {
        return stop(`needs ${total.toLocaleString('en-GB')} bullets for ${targets.length} robots (have ${Number.isFinite(bullets) ? bullets.toLocaleString('en-GB') : 'unknown'})`);
      }
      // Final check immediately before anything irreversible.
      const page = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
      const inventory = await defencePerkInventory();
      await defenceConfirmAccount(inventory.username);
      const cap = defenceCapacity(page);
      const names = defenceSlots(page).map(row => row.name);
      if (cap.cooldown > 0 || defenceOccupiedSlots(page).length !== DEFENCE_ROBOT_MAX || names.join('|') !== plan.rosterNames.join('|')) {
        return stop('roster changed before shooting');
      }
      if (inventory.ids.length < targets.length) return stop('Robot Bodyguard perks changed before shooting');
      if (!automationAllowed() || !defenceRotationEnabled() || state.inJail) throw new ActionCancelledError('BG rotation cancelled');
      perkIds = inventory.ids;
      mutated = true;
      // Destructive burst: inner robots only, the outer guard keeps protecting
      // the owner throughout, and replacement follows immediately.
      for (const target of targets) {
        let shot;
        try {
          shot = await defencePost('/api/kill/shoot', {username:target.name, bullets:target.bullets, showName:false}, {rotation:true});
        } catch (error) {
          if (error instanceof ActionCancelledError) throw error;
          log(`BG rotation shot on slot ${target.number} failed: ${friendlyGameError(error)}`, 'error');
          break;
        }
        if (shot?.killed === true) { killed += 1; continue; }
        if (target.bullets < target.prepared) {
          state.defenceRoster.fullBullets = true; // never under-price again
          saveDefenceRoster();
        }
        log(`BG rotation shot on slot ${target.number} was not lethal; stopping`, 'error');
        break;
      }
      outcome = killed === targets.length ? 'complete' : 'partial';
      return 750;
    } finally {
      try {
        if (killed > 0) await defenceRestoreAfterSelfKills(perkIds, owner);
      } catch (error) {
        log(`BG rotation recovery: ${friendlyGameError(error)}`, 'error');
      }
      try {
        await defenceRestoreServerDrugRun(owner);
      } catch (error) {
        state.defenceRestoreRetryAt = Date.now() + 60_000;
        log(`BG defence: will retry restoring Auto Rank Drug Run (${friendlyGameError(error)})`, 'warn');
      }
      state.defenceTravelLock = false;
      if (outcome === 'complete') {
        state.defenceRotationNote = `rotated ${killed} exposed inner robots`;
        log(`BG rotation replaced ${killed} exposed inner robots with one perk batch`, 'ok');
      } else if (outcome === 'partial') {
        state.defenceRotationNote = `stopped after ${killed} of ${plan.targets.length} robots; replaced with perks`;
      }
      if (outcome !== 'deferred') {
        state.defenceRoster.nextRotationAt = Date.now() + (outcome === 'complete'
          ? DEFENCE_ROTATION_COOLDOWN_MS
          : mutated ? DEFENCE_ROTATION_FAILURE_BACKOFF_MS : DEFENCE_ROTATION_CHECK_MS * 5);
        saveDefenceRoster();
      }
    }
  }

  async function defenceRotationTick(page, rows, owner) {
    const now = Date.now();
    const nextAt = Number(state.defenceRoster.nextRotationAt || 0);
    if (nextAt > now) {
      if (!state.defenceRotationNote) state.defenceRotationNote = 'waiting';
      state.defenceRotationNote = `${state.defenceRotationNote.replace(/ · next check in .*$/, '')} · next check in ${formatWait(nextAt - now)}`;
      return DEFENCE_POLL_MS;
    }
    if (now - Number(state.defenceRotationCheckedAt || 0) < DEFENCE_ROTATION_CHECK_MS) return DEFENCE_POLL_MS;
    state.defenceRotationCheckedAt = now;
    let kill = await defenceJson('/api/kill', {priority:REQUEST_PRIORITY.NORMAL});
    await defenceConfirmAccount(kill?.player?.username);
    if (kill?.player?.alive === false) { stopForDeath(); return DEFENCE_POLL_MS; }
    kill = await defenceMaintainSearches(page, rows, kill);
    const preview = defencePlanRotation(page, kill);
    if (!preview.targets) {
      state.defenceRotationNote = preview.reason;
      return DEFENCE_POLL_MS;
    }
    const stats = await defenceReadStats();
    await defenceConfirmAccount(stats.username);
    if (stats.deathProtected) {
      state.defenceRotationNote = 'waits while death protection is active';
      return DEFENCE_POLL_MS;
    }
    const inventory = await defencePerkInventory();
    await defenceConfirmAccount(inventory.username);
    const plan = defencePlanRotation(page, kill, inventory.ids.length);
    if (!plan.targets) {
      state.defenceRotationNote = plan.reason;
      return DEFENCE_POLL_MS;
    }
    plan.killData = kill;
    state.defenceRotationNote = `rotating ${plan.targets.length} exposed inner robots in ${plan.country}${plan.travel ? ' (travelling)' : ''}`;
    render();
    return defenceRunRotation(plan, owner);
  }

  // The server-side crime/GTA runner is independent of this local pause. Keep
  // that limitation visible, rather than claiming that jail has been eliminated.
  function defenceJailRiskPaused(now = Date.now()) {
    return defenceRotationEnabled() && Number(state.defenceJailRiskPauseUntil || 0) > now;
  }

  function defenceHybridState() {
    const roster = state.defenceRoster;
    if (!roster.hybrid || typeof roster.hybrid !== 'object') roster.hybrid = {};
    return roster.hybrid;
  }

  // This limited invariant is grounded in roster ordering, NOT a claim that
  // opponents lack other information. If two independently verified concealed
  // guards occupy the lowest slots, an opponent who only knows higher robots
  // cannot already have completed searches on those two identities. An enemy
  // loss must still be detected promptly: reactive recovery is NOT immortal.
  function defenceHybridHasVerifiedBase(rows, guards) {
    if (rows.length < 3 || !Array.isArray(rows)) return false;
    return rows.slice(0, 2).every(row => {
      const record = guards?.[row.name];
      return record?.known === false && record?.verifiedHidden === true;
    });
  }

  // Pure selection policy. Unknown exposure history is treated as compromised.
  // A found self-search is an execution prerequisite, NOT evidence that an
  // attacker has or has not completed an independent search. Keep a concealed
  // core when possible; if that core is already lost, try to rebuild it.
  function defenceHybridSelect(rows, guards, found, missing, cooldown, perkCount, now, alertUntil, pointsCanReplace = false, currentCountry = '') {
    const alert = alertUntil > now;
    if (cooldown > 0) return {type:'wait',reason:`replacement cooldown ${cooldown}s`};
    if (missing >= 2 && perkCount >= 2) return {type:'batch',count:Math.min(missing,perkCount),reason:'atomic concealed replacement batch'};

    const isHidden = row => guards[row.name]?.known === false && guards[row.name]?.verifiedHidden === true;
    const hidden = rows.filter(isHidden);
    // Inner (never the outer guard), possibly-known robots whose own search is
    // complete. A found self-search is an execution prerequisite, NOT evidence
    // about what an attacker knows.
    const ready = rows.slice(0,-1).filter(row => !isHidden(row) && defenceRotatable(row)).map(row => ({
      row, search:found.get(normalizePlayerName(row.name)),
    })).filter(x => x.search?.location && Number(x.search.secondsRemaining) >= DEFENCE_MIN_SEARCH_SECONDS);
    // Owner survival invariant: at least one living robot that no opponent can
    // have a completed search on. Self-shots must never leave a roster without
    // one, unless none exists already (then speed matters most).
    const anySafe = rows.some(row => defenceGuardSafe(row.name, now, 0));
    const remainingSafe = targets => rows.some(row =>
      !targets.some(target => target.name === row.name) && defenceGuardSafe(row.name, now, 10 * 60_000));
    // Oldest exposure first, then grouped by country (current country first)
    // so a multi-robot rebuild needs as few travel legs as possible.
    const rebuildTargets = limit => {
      const chosen = [];
      for (const item of ready.slice()
        .sort((a,b) => Number(guards[a.row.name]?.exposedAt || 0) - Number(guards[b.row.name]?.exposedAt || 0))) {
        if (chosen.length >= limit) break;
        // Skip a robot whose loss would leave no safe guard (keeps the freshest).
        if (anySafe && !remainingSafe([...chosen, item].map(x => x.row))) continue;
        chosen.push(item);
      }
      const groups = new Map();
      for (const item of chosen) {
        const country = String(item.search.location);
        if (!groups.has(country)) groups.set(country, []);
        groups.get(country).push(item.row);
      }
      if (!anySafe) {
        // EMERGENCY (no guard is unsearchable any more): there is no survival
        // guarantee left, so minimise the time the roster is reduced. Use one
        // country only: any travel happens BEFORE the first shot and the batch
        // follows the last shot immediately.
        const best = [...groups.keys()]
          .sort((a,b) => groups.get(b).length - groups.get(a).length || Number(b === currentCountry) - Number(a === currentCountry))[0];
        return best ? groups.get(best) : [];
      }
      return [...groups.keys()]
        .sort((a,b) => Number(b === currentCountry) - Number(a === currentCountry) || groups.get(b).length - groups.get(a).length)
        .flatMap(country => groups.get(country));
    };

    // One robot short with fewer than two concealed guards: retiring known
    // inner robots first turns the refill into an atomic batch that creates
    // concealed guards, instead of a single exposed outer guard.
    if (missing > 0) {
      if (missing === 1 && hidden.length < 2 && ready.length) {
        const targets = rebuildTargets(Math.min(DEFENCE_REBUILD_MAX_TARGETS, Math.max(0, perkCount - missing)));
        if (targets.length && perkCount >= targets.length + missing && (!anySafe || remainingSafe(targets))) {
          return {type:'selfbatch',targets,rebuild:true,minTargets:1,emergency:!anySafe,rosterCount:rows.length,
            reason:'REBUILD CONCEALMENT: retire known inner robots, then refill everything in one batch'};
        }
      }
      return {type:'single',reason:'restore one missing robot with points or perk'};
    }
    if (rows.length !== DEFENCE_ROBOT_MAX) return {type:'wait',reason:'waiting for complete four-robot roster'};

    // Fewer than two concealed guards: retire every useful known inner robot
    // (up to three, across countries if needed) and redeem them together.
    // Killing k robots and redeeming k creates k-1 concealed robots; the outer
    // guard keeps protecting the owner throughout.
    if (hidden.length < 2) {
      const targets = rebuildTargets(Math.min(DEFENCE_REBUILD_MAX_TARGETS, perkCount));
      if (targets.length >= 2 && perkCount >= targets.length && (!anySafe || remainingSafe(targets))) {
        return {type:'selfbatch',targets,rebuild:true,minTargets:2,emergency:!anySafe,rosterCount:rows.length,
          reason:hidden.length === 0
            ? `REBUILD CONCEALMENT: retire ${targets.length} known inner robots, redeem ${targets.length} together`
            : `RESTORE CONCEALMENT: retire ${targets.length} known inner robots, redeem ${targets.length} together`};
      }
    }

    const highestHiddenIndex = Math.max(-1,...rows.map((row,i) => isHidden(row) ? i : -1));
    const knownBelowHidden = rows.filter((row,i) => i < highestHiddenIndex && !isHidden(row));
    // Prioritise guards stranded under concealed layers, then long-exposed
    // guards whose enemies could have finished their searches at any time.
    ready.sort((a,b) =>
      Number(knownBelowHidden.some(r => r.name === b.row.name)) - Number(knownBelowHidden.some(r => r.name === a.row.name)) ||
      Number(guards[a.row.name]?.exposedAt || 0) - Number(guards[b.row.name]?.exposedAt || 0));

    const exposedOuter = rows[rows.length-1];
    const exposedAt = Number(guards[exposedOuter?.name]?.exposedAt || 0);
    const outerOld = !exposedAt || now - exposedAt >= DEFENCE_ENEMY_SEARCH_MS - DEFENCE_HYBRID_LEAD_MS;
    // One self-shot doesn't create concealment, but removes a potentially
    // searched identity and keeps a fresh outer guard above the concealed
    // layers. Use this when a concealment batch isn't presently available.
    if (ready.length && (ready.length >= 2 && hidden.length <= 1 ||
        alert && (hidden.length < 2 || outerOld || knownBelowHidden.length > 0) ||
        hidden.length < 2 && outerOld ||
        hidden.length >= 2 && outerOld)) {
      const target = ready[0].row;
      if ((perkCount > 0 || pointsCanReplace) && (!anySafe || remainingSafe([target]))) return {type:'selfsingle',targets:[target],
        emergency:!anySafe,rosterCount:rows.length,
        reason:hidden.length === 0 ? 'NO CONCEALED GUARDS: disrupt a ready search while preparing a batch'
          : 'REPOSITION: retire a searched exposed inner robot; preserve concealed layers'};
    }
    if (hidden.length === 0) return {type:'wait',reason:'NO CONCEALED GUARDS: preparing own searches for a concealment batch'};
    if (hidden.length === 1) return {type:'wait',reason:'one verified concealed guard · preparing searched exposed guards for rotation'};
    if (defenceHybridHasVerifiedBase(rows,guards)) return {type:'wait',reason:'verified two-robot concealed base · maintaining own searches'};
    return {type:'wait',reason:ready.length ? 'concealed layers stable · monitoring exposure' : 'awaiting safe removable searched guards'};
  }

  // driveAvailable only reflects the drive cooldown; the game also refuses a
  // favourite car at 100% damage.
  function defenceCarUsable(drugs) {
    const damage = Number(drugs?.favouriteCar?.damage);
    return drugs?.driveAvailable === true && Boolean(drugs?.favouriteCar) && Number.isFinite(damage) && damage < 100;
  }

  function defenceRotatable(row) {
    return DEFENCE_ROTATE_UPGRADED || defenceIsBaseRobot(row);
  }

  // Trims an ordered (country-grouped) target list to the robots reachable
  // with the airport flights and car drive available right now. Flights have
  // no per-flight cooldown; a drive is counted once because of its cooldown.
  async function defenceReachableTargets(targets, kill) {
    const found = defenceSearchList(kill).found;
    const countryOf = row => String(found.get(normalizePlayerName(row.name))?.location || '');
    let here = String(kill?.player?.location || '');
    const needsTravel = targets.some(row => countryOf(row) && countryOf(row) !== here);
    if (!needsTravel) return targets;
    const airport = await defenceJson('/api/airport', {priority:REQUEST_PRIORITY.RAPID});
    let flights = airport?.available === true ? Math.max(0, Number(airport?.flightsRemaining) || 0) : 0;
    let drives = 0;
    if (flights < targets.length) {
      const drugs = await defenceJson('/api/drugs?page=1', {priority:REQUEST_PRIORITY.NORMAL});
      drives = defenceCarUsable(drugs) ? 1 : 0;
    }
    const reachable = [];
    for (const row of targets) {
      const country = countryOf(row);
      if (!country) break;
      if (country !== here) {
        if (flights > 0) flights -= 1;
        else if (drives > 0) drives -= 1;
        else break;
        here = country;
      }
      reachable.push(row);
    }
    return reachable;
  }

  async function defenceHybridSelfKill(plan, owner, kill) {
    let targets = plan.targets || [];
    if (!targets.length || state.inJail) return false;
    // Claim the travel/combat lane FIRST so a continuously running Beam cannot
    // starve a defence rotation by repeatedly starting another action.
    state.defenceTravelLock = true;
    let killed = 0;
    let shotAttempted = false;
    try {
      const until = Date.now() + DEFENCE_HYBRID_COMBAT_SETTLE_MS;
      while ((state.combatRunning || state.drugsRunning) && Date.now() < until)
        await new Promise(resolve => setTimeout(resolve, 100));
      if (state.combatRunning || state.drugsRunning) {
        state.defenceRotationNote = 'waiting for an in-flight Beam/drug action to settle';
        // A concealment rebuild keeps Beam/Drugs paused until it has run.
        if (plan.rebuild) state.defenceTravelLockUntil = Date.now() + DEFENCE_URGENT_LOCK_MS;
        return false;
      }
      if (targets.length > 1) {
        // Keep only the robots reachable with the flights/drive available now,
        // so a multi-country rebuild never stops halfway for lack of travel.
        targets = await defenceReachableTargets(targets, kill);
        if (targets.length < (plan.minTargets || 2)) {
          state.defenceRotationNote = 'concealment rebuild waiting for flights or a usable car';
          return false;
        }
      }
      await defenceSuspendServerDrugRun(owner);
      for (const target of targets) {
        if (!defenceRotationEnabled()) throw new ActionCancelledError('Hybrid defence disabled');
        const before = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
        await defenceConfirmNow();
        const current = defenceSlots(before);
        const outer = defenceOuterGuard(before);
        const actualTarget = current.find(r => r.name === target.name);
        // Never self-shoot the final guard. While staging a multi-shot batch,
        // halt if an enemy kill reduced the expected roster in between shots.
        const expected = Number(plan.rosterCount) || DEFENCE_ROBOT_MAX;
        if (current.length < (targets.length > 1 ? expected - killed : 2) ||
            outer?.name === target.name || !actualTarget ||
            state.defenceRoster.guards[target.name]?.known === false || !defenceRotatable(actualTarget))
          throw new Error('Unsafe roster or upgraded robot: no self-shot made');
        // Survival invariant: a guard no opponent can have searched must remain.
        if (!plan.emergency && !current.some(r => r.name !== target.name && defenceGuardSafe(r.name, Date.now(), 5 * 60_000)))
          throw new Error('No safe guard would remain: no self-shot made');
        const searches = defenceSearchList(kill).found;
        const found = searches.get(normalizePlayerName(target.name));
        if (!found?.location || Number(found.secondsRemaining) < DEFENCE_MIN_SEARCH_SECONDS)
          throw new Error('Own search is not ready for the selected robot');
        if (String(kill?.player?.location || '') !== String(found.location)) {
          if (!(await defenceTravelTo(String(found.location)))) throw new Error(`Cannot reach ${found.location}`);
        }
        const refreshed = await defenceJson('/api/kill', {priority:REQUEST_PRIORITY.RAPID});
        await defenceConfirmAccount(refreshed?.player?.username);
        if (String(refreshed?.player?.location || '') !== String(found.location))
          throw new Error(`Arrival in ${found.location} not confirmed`);
        const ready = defenceSearchList(refreshed).found.get(normalizePlayerName(target.name));
        if (!ready || Number(ready.secondsRemaining) < DEFENCE_MIN_SEARCH_SECONDS) throw new Error('Search expired before shot');
        const prepared = await defencePost('/api/kill/prepare', {username:target.name}, {rotation:true});
        // Full prepared bullets are deliberately used for emergency reliability.
        const bullets = Number(prepared?.bullets);
        if (!Number.isSafeInteger(bullets) || bullets < 1 || Number(refreshed?.player?.bullets) < bullets)
          throw new Error('Not enough bullets to safely self-shoot');
        // Reconfirm that the target is still an inner, known robot.
        const verify = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
        const verifiedTarget = defenceSlots(verify).find(r=>r.name===target.name);
        if (defenceOuterGuard(verify)?.name === target.name || !verifiedTarget || !defenceRotatable(verifiedTarget))
          throw new Error('Roster or robot upgrade changed during shot preparation');
        await defenceConfirmNow();
        const h = defenceHybridState();
        shotAttempted = true;
        const shot = await defencePost('/api/kill/shoot', {username:target.name,bullets,showName:false}, {rotation:true});
        if (shot?.killed !== true) throw new Error('Self-shot not confirmed lethal');
        killed++;
        h.selfKillNames = [...new Set([...(Array.isArray(h.selfKillNames)?h.selfKillNames:[]), target.name])].slice(-6);
        h.selfKillAt = Date.now();
        // Diagnostic-only bounded history; no resource-driven hourly cap.
        h.selfKillHistory = [...(Array.isArray(h.selfKillHistory)?h.selfKillHistory:[]).slice(-127),Date.now()];
        h.lastRotationAt = Date.now();
        saveDefenceRoster();
        log(`Hybrid BG defence removed a known inner robot (slot ${target.number})`, 'ok');
        kill = refreshed;
      }
    } finally {
      // Hold the Beam/drug travel lock through the complete replacement.
      // This applies even if travel or a later self-shot failed: never strand
      // one or two empty slots while the normal offensive lane resumes.
      try {
        if (killed > 0 || shotAttempted) {
          const inv = await defencePerkInventory();
          await defenceConfirmAccount(inv.username);
          await defenceRestoreAfterSelfKills(inv.ids, owner);
        }
      } catch(e) {log(`Hybrid BG emergency recovery: ${friendlyGameError(e)}`, 'error');}
      try { await defenceRestoreServerDrugRun(owner); } catch(e) {log(`BG Drug Run restore: ${friendlyGameError(e)}`, 'warn');}
      state.defenceTravelLock = false;
      state.defenceDueAt = 0;
    }
    return killed > 0;
  }

  async function defenceHybridTick(page, rows, owner) {
    const hybrid = defenceHybridState();
    const now = Date.now();
    const currentNames = rows.map(r=>r.name);
    const formerNames = Array.isArray(hybrid.lastNames) ? hybrid.lastNames : [];
    const lost = formerNames.filter(n => !currentNames.includes(n));
    const cap = defenceCapacity(page);
    const unaccountedLoss = lost.some(n => !(Array.isArray(hybrid.selfKillNames) && hybrid.selfKillNames.includes(n) && now - Number(hybrid.selfKillAt || 0) < 60_000));
    // On the first observation there may be no historical roster yet. The
    // game's 30-second enemy-only replacement cooldown is independent proof
    // of an enemy loss. Do not require lastNames to have been populated.
    const enemyCooldownLoss = cap.cooldown > 0 && cap.robots < DEFENCE_ROBOT_MAX;
    if (unaccountedLoss || (enemyCooldownLoss && Number(hybrid.alertUntil || 0) <= now)) {
      hybrid.alertUntil = now + DEFENCE_HYBRID_ALERT_MS;
      log(`Hybrid BG defence alarm: ${lost.length} previously observed guard(s) missing${enemyCooldownLoss ? ' · enemy replacement cooldown active' : ''}`, 'warn');
    }
    hybrid.lastNames = currentNames;
    if (lost.length) {hybrid.selfKillNames=[];hybrid.selfKillAt=0;}
    saveDefenceRoster();
    if (cap.cooldown > 0) {
      state.defenceRotationNote = `enemy replacement cooldown ${cap.cooldown}s`;
      return Math.min(5000,cap.cooldown*1000+250);
    }
    let kill;
    // Prepare own searches promptly, even before any enemy has shot. Searches
    // mature on the server's normal clock and cannot be rushed by this bot.
    const verifiedConcealed = rows.filter(r => state.defenceRoster.guards[r.name]?.known === false &&
      state.defenceRoster.guards[r.name]?.verifiedHidden === true).length;
    const refreshMs = verifiedConcealed < 2 ? 10_000 : Number(hybrid.alertUntil||0) > now ? 15_000 : 45_000;
    // Re-decide at once when the concealed count changes (a batch landed, a
    // manual confirmation, a demotion) so the status never shows a stale decision.
    const needSearch = now - Number(state.defenceRotationCheckedAt || 0) >= refreshMs || hybrid.decidedConcealed !== verifiedConcealed;
    if (needSearch) {
      hybrid.decidedConcealed = verifiedConcealed;
      state.defenceRotationCheckedAt = now;
      kill = await defenceJson('/api/kill', {priority:REQUEST_PRIORITY.RAPID});
      await defenceConfirmAccount(kill?.player?.username);
      if (kill?.player?.alive === false) {stopForDeath();return DEFENCE_POLL_MS;}
      if (!state.inJail) kill=await defenceMaintainSearches(page,rows,kill);
    } else if (cap.missing===0) return DEFENCE_POLL_MS;
    if (!kill) {
      kill=await defenceJson('/api/kill', {priority:REQUEST_PRIORITY.RAPID});
      await defenceConfirmAccount(kill?.player?.username);
    }
    const found = defenceSearchList(kill).found;
    const alertUntil=Number(hybrid.alertUntil || 0);
    // Local crime/GTA pause is based on the soonest *known* first exposure;
    // unobserved prior exposure is handled conservatively as already ready.
    const actionDeadlines = rows.map(row=>Number(state.defenceRoster.guards[row.name]?.exposedAt || 0))
      .filter(t=>t>0).map(t=>t+DEFENCE_ENEMY_SEARCH_MS-DEFENCE_HYBRID_LEAD_MS)
      .filter(t=>t>=now && t-now<=DEFENCE_JAIL_PAUSE_LEAD_MS);
    if (alertUntil>now && actionDeadlines.length)
      state.defenceJailRiskPauseUntil=Math.max(Number(state.defenceJailRiskPauseUntil||0),Math.min(...actionDeadlines)+60_000);
    const reserve = Math.max(0, Number(state.settings.robotDefencePointReserve) || 0);
    const enoughPointsForOne = Number.isFinite(cap.points) &&
      cap.points - DEFENCE_FALLBACK_ROBOT_PRICE >= reserve;
    const preview = defenceHybridSelect(rows,state.defenceRoster.guards,found,cap.missing,cap.cooldown,4,now,alertUntil,enoughPointsForOne,String(kill?.player?.location || ''));
    if (preview.type === 'wait' && cap.missing === 0) {
      state.defenceRotationNote = `hybrid ${alertUntil>now?'alert':'quiet'} · ${preview.reason}`;
      return DEFENCE_POLL_MS;
    }
    const inventory = await defencePerkInventory();
    await defenceConfirmAccount(inventory.username);
    // Single known-inner removal can be restored with a points purchase.
    // Establish the entire replacement cost and configured reserve BEFORE
    // taking an irreversible shot; the current full-roster shop is blocked.
    const decision = defenceHybridSelect(rows,state.defenceRoster.guards,found,cap.missing,cap.cooldown,inventory.ids.length,now,alertUntil,enoughPointsForOne,String(kill?.player?.location || ''));
    state.defenceRotationNote = `hybrid ${alertUntil>now?'alert':'quiet'} · ${decision.reason}`;
    // Remembered so a jail spell is ended straight away while work is pending.
    if (decision.type !== 'wait') state.defenceActionWantedUntil = now + 5 * 60_000;
    if (decision.type==='batch') {
      const names = new Set(currentNames);
      await defenceRedeem(inventory.ids.slice(0,decision.count),names,owner);
      return 750;
    }
    if (decision.type==='single') {
      await defenceRefill(page,owner,{preferPoints:true});
      return 750;
    }
    if (decision.type==='selfbatch' || decision.type==='selfsingle') {
      // All planned destructive steps must have verified replacement resources;
      // no hidden robot or outer robot may be targeted.
      // A rebuild replaces every robot it retires plus any already missing in one batch.
      const required = decision.type==='selfbatch' ? Math.max(2, (decision.minTargets || 2) + cap.missing) : 0;
      if (inventory.ids.length<required || (decision.type==='selfsingle' && !inventory.ids.length && !enoughPointsForOne)) {
        state.defenceRotationNote='awaiting verified replacement resources';return DEFENCE_POLL_MS;
      }
      // Only a short stale-state / duplicate-dispatch guard; unlike the old
      // six-per-hour limit this never imposes a rolling resource budget.
      if (now - Number(hybrid.lastRotationAt || 0) < DEFENCE_HYBRID_MIN_ROTATION_GAP_MS) {
        state.defenceRotationNote = 'confirming new roster before next rotation';
        return DEFENCE_POLL_MS;
      }
      state.defenceJailRiskPauseUntil = Math.max(Number(state.defenceJailRiskPauseUntil||0),now + 3*60_000);
      if (state.crimesRunning || state.gtaRunning) {state.defenceRotationNote='waiting for current Crimes/GTA request';return DEFENCE_POLL_MS;}
      if (await defenceHybridSelfKill(decision,owner,kill)) return 750;
    }
    return DEFENCE_POLL_MS;
  }

  // True when a jail spell would delay defence work: a live alarm, a recent
  // non-waiting decision, a missing robot, or (with rotation) no guard that
  // stays unsearchable for the next 30 minutes.
  function defenceJailExitWanted(now = Date.now()) {
    if (Number(defenceHybridState().alertUntil || 0) > now) return true;
    if (Number(state.defenceActionWantedUntil || 0) > now) return true;
    const last = state.defenceLastRoster;
    if (!last) return false;
    if (Number(last.missing) > 0 || Number(last.cooldown) > 0) return true;
    return defenceRotationEnabled() && !last.names.some(name => defenceGuardSafe(name, now, 30 * 60_000));
  }

  async function runBodyguardDefence() {
    if (!automationAllowed() || !defenceEnabled() || state.defenceRunning) return;
    state.defenceRunning = true;
    markFeatureEpoch('defence');
    let nextMs = DEFENCE_POLL_MS;
    try {
      // Another tab may have been controller before; always use the stored roster.
      state.defenceRoster = loadDefenceRoster();
      let owner = await defenceVerifiedOwner();
      if (!owner) { nextMs = 15_000; return; }
      if (GM_getValue(KEYS.defenceAutoRankRestore, null) && Date.now() >= Number(state.defenceRestoreRetryAt || 0)) {
        try {
          await defenceRestoreServerDrugRun(owner);
        } catch (error) {
          if (error instanceof ActionCancelledError) throw error;
          state.defenceRestoreRetryAt = Date.now() + 60_000;
          log(`BG defence: will retry restoring Auto Rank Drug Run (${friendlyGameError(error)})`, 'warn');
        }
      }
      // The game blocks the bodyguard, kill, points and travel pages while
      // jailed. Whenever defence has work pending, pay the 1-point jail exit
      // (no cooldown) rather than waiting out the sentence.
      if (state.inJail) {
        const hybrid = defenceHybridState();
        if (defenceJailExitWanted() && Date.now()-Number(hybrid.lastJailExitAt||0)>10_000) {
          try {
            await defenceConfirmNow();
            hybrid.lastJailExitAt=Date.now(); saveDefenceRoster();
            await defencePost('/api/jail/leave', {});
            state.jailBustDueAt=0;
            state.defenceStatus='Paid jail exit for BG emergency · confirming release';
          } catch(error) {state.defenceStatus=`Waiting for jail release · ${friendlyGameError(error)}`;}
        } else state.defenceStatus='Paused in jail · waiting for release';
        nextMs=5_000;return;
      }
      const page = await defenceJson('/api/bodyguard', {priority:REQUEST_PRIORITY.RAPID});
      if (defenceSlots(page).some(row => !defenceIsOwnRobotName(row.name))) {
        // A robot this roster has never seen: confirm the account before recording it.
        owner = await defenceVerifiedOwner(true);
        if (!owner) { nextMs = 15_000; return; }
      }
      const rows = observeDefenceSlots(page, owner);
      const cap = defenceCapacity(page);
      state.defenceLastRoster = {names:rows.map(row => row.name), missing:cap.missing, cooldown:cap.cooldown};
      const concealed = rows.filter(row => state.defenceRoster.guards[row.name]?.known === false).length;
      state.defenceStatus = `${owner} · ${cap.robots}/${cap.robotMax} robots · ${concealed} estimated concealed${cap.cooldown ? ` · replacement cooldown ${cap.cooldown}s` : ''}`;
      if (defenceRotationEnabled()) {
        const wait = await defenceHybridTick(page, rows, owner);
        if (Number.isFinite(wait)) nextMs = wait;
      } else if (cap.missing > 0) {
        if (cap.cooldown > 0) {
          nextMs = Math.min(10_000, cap.cooldown * 1000 + 250);
          return;
        }
        const result = await defenceRefill(page, owner);
        nextMs = result.acted ? 750 : (result.waitMs || DEFENCE_POLL_MS);
        return;
      }
      if (defenceRotationEnabled() && state.defenceRotationNote) state.defenceStatus += ` · rotation: ${state.defenceRotationNote}`;
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) {
        state.defenceStatus = `BG defence: ${friendlyGameError(error)}`;
        log(state.defenceStatus, 'warn');
      }
      nextMs = errorWait(error, 10_000);
    } finally {
      state.defenceRunning = false;
      state.defenceDueAt = Date.now() + Math.max(250, nextMs);
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
        beamDiagnostic('search-started', `username=${name}`);
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
          // Own BG defence robots are never sent to the Worker.
          pending: (Array.isArray(data?.pending) ? data.pending : []).filter((row) => !defenceIsOwnRobotName(row?.username)).map((row) => ({
            username:String(row?.username || ''),
            secondsUntilFound:Number(row?.secondsUntilFound),
          })),
          found: (Array.isArray(data?.found) ? data.found : []).filter((row) => !defenceIsOwnRobotName(row?.username)).map((row) => ({
            username:String(row?.username || ''),
            secondsRemaining:Number(row?.secondsRemaining),
            location:String(row?.location || ''),
            canShootHere:row?.canShootHere === true,
          })),
          activeBodyguard: state.activeBodyguard,
          backoffs,
        },
      });

      beamDiagnostic('search-plan', `action=${plan.action || '?'} username=${String(plan.username || '')} pending=${(data.pending || []).length} found=${(data.found || []).length} status=${String(plan.status || '')}`);
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

  // A planner command is authorised by the locally selected player action.
  // The remote planner's `follow` field is only a hint: if omitted or false on
  // a selected Beam target, the previous check silently cancelled travel and
  // shooting. Never accept a different target or a stale UI selection.
  function combatCommandStillWanted(command) {
    const primary = String(command?.primary || command?.username || '').trim();
    const key = normalizePlayerName(primary);
    if (!key || !automationAllowed() || !featureEpochCurrent('combat')) return false;
    const action = state.playerActions[key];
    if (!action) return false;
    const beamSelected = action.beam === true && normalizePlayerName(activeBeamName()) === key;
    const usingBeam = beamSelected && (command?.follow === true || action.kill !== true);
    if (usingBeam) {
      const currentMode = action.mode === 'bgs' ? 'bgs' : 'full';
      // An absent planner mode is not an instruction to switch away from the
      // user's selected mode. An explicit incompatible mode is still rejected.
      if (command?.mode !== undefined && command?.mode !== null) {
        const plannedMode = command.mode === 'bgs' ? 'bgs' : 'full';
        if (currentMode !== plannedMode) return false;
      }
      return true;
    }
    if (command?.follow === true) return false;
    return action.kill === true;
  }

  const beamDiagnosticLast = new Map();
  function beamDiagnostic(kind, message) {
    if (!activeBeamName()) return;
    const now = Date.now();
    if (now - (beamDiagnosticLast.get(kind) || 0) < 20_000) return;
    beamDiagnosticLast.set(kind, now);
    log(`Beam diagnostic [${kind}]: ${String(message).slice(0, 300)}`);
  }

  async function shootCombat(command, options = {}) {
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
    if (!options.rapidProbe) render();
    state.shotTimes.push(Date.now());
    if (!options.rapidProbe) beamDiagnostic('shoot-dispatched', `username=${username} role=${String(command.role || '')} follow=${String(command.follow)} bullets=${bullets}`);
    const killRevision = state.killDataRevision;

    try {
      const result = await gameJson('/api/kill/shoot', {
        method:'POST',
        timeoutMs:130_000,
        body:{ username, bullets, showName:false, message:'' },
        // Continuous confirmation shots yield to searches, jail, crimes and
        // other queued work, while defence retains strict highest priority.
        priority: options.rapidProbe ? REQUEST_PRIORITY.BACKGROUND : REQUEST_PRIORITY.ACTION,
        validate: () => {
          if (!protectionMutationSafe()) throw new ActionCancelledError('Death protection active or unverified');
          if (!combatCommandStillWanted(command)) throw new ActionCancelledError('Combat target changed');
          const primary = String(command?.primary || command?.username || '').trim();
          const action = state.playerActions[normalizePlayerName(primary)];
          const ownerShot = normalizePlayerName(username) === normalizePlayerName(primary) && String(command?.role || 'owner') !== 'bodyguard';
          // Check the LOCAL Beam setting, not the remote planner's `follow`
          // flag. This restriction must survive a missing/malformed flag.
          const selectedBeam = action?.beam === true &&
            normalizePlayerName(activeBeamName()) === normalizePlayerName(primary);
          if (selectedBeam && action?.mode === 'bgs' && ownerShot && bullets !== 1) {
            throw new ActionCancelledError('BG-only Beam may probe the owner with exactly one bullet only');
          }
        },
      });

      if (result?.processed === true) {
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatStatus = `Shot at ${username} was processed; refreshing before retry`;
        state.combatDueAt = Date.now() + 5_000;
        return null;
      }
      if (killRevision === state.killDataRevision && result?.data && typeof result.data === 'object') {
        state.killData = result.data;
        state.killDataLoadedAt = Date.now();
      } else {
        state.killData = null;
        state.killDataLoadedAt = 0;
      }

      if (!options.rapidProbe) beamDiagnostic('shoot-result', `target=${username} killed=${String(result?.killed)} blocker=${String(result?.blockingBodyguard || '')} processed=${String(result?.processed)}`);
      const primary = String(command?.primary || username);
      const role = String(command?.role || 'owner');
      if (result?.blockingBodyguard) {
        const guard = String(result.blockingBodyguard);
        const same = state.activeBodyguard &&
          normalizePlayerName(state.activeBodyguard.primary) === normalizePlayerName(primary) &&
          normalizePlayerName(state.activeBodyguard.name) === normalizePlayerName(guard);
        let confirmedAt = same ? Number(state.activeBodyguard.confirmedAt) || 0 : 0;
        if (!options.rapidProbe && role === 'confirm_guard' && normalizePlayerName(command?.guardName) === normalizePlayerName(guard)) {
          confirmedAt = Date.now();
        }
        state.activeBodyguard = { primary, name:guard, confirmedAt };
        state.combatStatus = `Bodyguard found: ${guard}`;
        // Do not ask the Worker to re-plan searches five times per second
        // when continuous probes keep seeing the exact same blocker.
        if (!same) state.playerSearchDueAt = 0;
        // Last successful owner shot is a short-lived permit for continuous
        // local probes, even when the Worker subsequently says 'wait'.
        const chosen = state.playerActions[normalizePlayerName(primary)];
        if (normalizePlayerName(username) === normalizePlayerName(primary) && chosen?.beam === true &&
            normalizePlayerName(activeBeamName()) === normalizePlayerName(primary)) {
          state.beamPressureLease = { primary, guard, at:Date.now() };
        }
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
      return result;
    } catch (error) {
      const message = friendlyGameError(error);
      if (/bodyguard assignment changed/i.test(message)) {
        state.activeBodyguard = null;
        state.killData = null;
        state.killDataLoadedAt = 0;
        state.combatStatus = 'Bodyguard assignment changed — refreshing';
        state.combatDueAt = Date.now();
        return null;
      }
      throw error;
    }
  }

  // This is the continuous Beam cadence, independent of Worker planning.
  // A *successful* owner probe proves that the primary was searchable and in
  // our country. We keep probing for a bounded burst and replan immediately
  // on travel, blocker changes, an error, new state or a defence rotation.
  function beamPressureAllowed(command) {
    const primary = String(command?.primary || '').trim();
    const action = state.playerActions[normalizePlayerName(primary)];
    return Boolean(primary && action?.beam === true &&
      normalizePlayerName(activeBeamName()) === normalizePlayerName(primary) &&
      combatCommandStillWanted(command) && !state.inJail &&
      !defenceTravelLocked() && !state.drugsRunning && !state.autoGunRunning &&
      state.globalRateLimitedUntil <= Date.now());
  }

  function beamPressureHeadroomWait(now = Date.now()) {
    requestLimiter.recentDispatches = requestLimiter.recentDispatches
      .filter((at) => now - at < 1_000);
    if (requestLimiter.recentDispatches.length < BEAM_PRESSURE_TOTAL_HEADROOM_PER_SEC) return 0;
    return Math.max(1, requestLimiter.recentDispatches[0] + 1_000 - now + 5);
  }

  async function runContinuousBeamProbes(command, firstResult) {
    const primary = String(command?.primary || command?.username || '').trim();
    const knownGuard = String(firstResult?.blockingBodyguard || '').trim();
    if (!knownGuard || !primary || !beamPressureAllowed({ ...command, primary, follow:true })) return;
    // The first shot was decided by the Worker. Subsequent shots are only
    // harmless one-bullet owner probes, never autonomous lethal decisions.
    const probe = { ...command, primary, username:primary, role:'confirm_guard',
      guardName:knownGuard, bullets:1, follow:true };
    const started = Date.now();
    const deadline = started + BEAM_PRESSURE_BATCH_MS;
    const startRevision = state.killDataRevision;
    let count = 0;
    let lastShotAt = started;
    while (Date.now() < deadline && beamPressureAllowed(probe)) {
      if (state.killDataRevision !== startRevision) break;
      if (normalizePlayerName(state.activeBodyguard?.name) !== normalizePlayerName(knownGuard) ||
          normalizePlayerName(state.activeBodyguard?.primary) !== normalizePlayerName(primary)) break;
      const now = Date.now();
      const spacing = Math.max(0, lastShotAt + BEAM_PRESSURE_SPACING_MS - now);
      const wait = Math.max(spacing, shootWaitMs(), beamPressureHeadroomWait(now));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 250)));
        continue;
      }
      // Other actions have priority, including waiting search/defence reads.
      if (requestLimiter.queue.some((entry) => !entry.defence && entry.priority < REQUEST_PRIORITY.BACKGROUND)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const dispatchedAt = Date.now();
      const result = await shootCombat(probe, { rapidProbe:true });
      if (!result) break;
      count += 1;
      lastShotAt = dispatchedAt;
      if (result.processed === true || result.killed === true ||
          normalizePlayerName(result.blockingBodyguard) !== normalizePlayerName(knownGuard)) break;
    }
    if (count > 0) {
      const elapsed = Math.max(1, Date.now() - started);
      log(`Beam continuous: ${count} owner probes in ${(elapsed / 1_000).toFixed(1)}s (${(count * 1_000 / elapsed).toFixed(2)}/s)`, 'info');
    }
    state.combatDueAt = Date.now();
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
    const flightReserved = defenceFlightReserveReached(airport);
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
          available: airport?.available === true && !flightReserved,
          secondsRemaining: flightReserved ? Math.max(60, Number(airport?.secondsRemaining) || 0) : Number(airport?.secondsRemaining),
          destinations: airportDestinations.slice(0,30).map((row,index) => ({ index, name:String(row?.name || '') })),
        },
      },
    });

    beamDiagnostic('travel-plan', `action=${plan.action || '?'} target=${targetLocation} here=${currentLocation} flights=${String(airport?.flightsRemaining ?? '?')} reserved=${flightReserved} car=${String(drug?.favouriteCar?.damage ?? '?')} driveAvailable=${String(drug?.driveAvailable)} status=${String(plan.status || '')}`);
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
    if (plan.action === 'fly' && flightReserved) {
      state.combatStatus = 'Beam waiting · last airport flights reserved for BG defence';
      state.combatDueAt = Date.now() + 30_000;
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
          // Own BG defence robots are never sent to the Worker.
          pending:(Array.isArray(data?.pending) ? data.pending : []).filter((row) => !defenceIsOwnRobotName(row?.username)).map((row) => ({
            username:String(row?.username || ''),
            secondsUntilFound:Number(row?.secondsUntilFound),
          })),
          found:(Array.isArray(data?.found) ? data.found : []).filter((row) => !defenceIsOwnRobotName(row?.username)).map((row) => ({
            username:String(row?.username || ''),
            secondsRemaining:Number(row?.secondsRemaining),
            location:String(row?.location || ''),
            canShootHere:row?.canShootHere === true,
          })),
        },
      });

      beamDiagnostic('combat-plan', `action=${plan.action || '?'} follow=${String(plan.follow)} primary=${String(plan.primary || '')} target=${String(plan.username || '')} location=${String(plan.targetLocation || '')} local=${String(data?.player?.location || '')} found=${(data.found || []).length} pending=${(data.pending || []).length} status=${String(plan.status || '')}`);
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
        const lease = state.beamPressureLease;
        if (lease && Date.now() - lease.at < 10_000 &&
            normalizePlayerName(lease.guard) === normalizePlayerName(state.activeBodyguard?.name) &&
            normalizePlayerName(lease.primary) === normalizePlayerName(activeBeamName())) {
          await runContinuousBeamProbes({primary:lease.primary, username:lease.primary,
            role:'confirm_guard', guardName:lease.guard, bullets:1, follow:true},
            {blockingBodyguard:lease.guard});
          return;
        }
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
        const result = await shootCombat(plan);
        if (result?.blockingBodyguard) await runContinuousBeamProbes(plan, result);
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
          const readyShot = { ...plan, ...after };
          const result = await shootCombat(readyShot);
          if (result?.blockingBodyguard) await runContinuousBeamProbes(readyShot, result);
        } else {
          state.combatStatus = after.status || 'Waiting for bullets';
          state.combatDueAt = Date.now() + safeWaitMs(after.waitMs, 30_000);
        }
        return;
      }

      state.combatDueAt = Date.now() + 1_000;
    } catch (error) {
      if (error instanceof ActionCancelledError) {
        beamDiagnostic('cancelled', String(error.message || error));
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
          defenceRebindAfterRestart(String(status.username || ''), username);
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
      jailSecondaryVerifiedMainUserId = '';
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
    jailSecondaryVerifiedMainUserId = '';
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
        jailSecondaryVerifiedMainUserId = '';
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
        // BG defence requests are always served before any other ready
        // request; ageing only orders requests within the same class.
        if (!selected || (candidate.defence && !selected.defence) ||
            (candidate.defence === selected.defence && (score(candidate) < score(selected) ||
              (score(candidate) === score(selected) && candidate.sequence < selected.sequence)))) {
          selectedIndex = index;
        }
      }
      if (selectedIndex < 0) break;
      const [next] = requestLimiter.queue.splice(selectedIndex, 1);
      if (next.usesGlobalToken) requestLimiter.tokens -= 1;
      const bucket = requestBucket(next.rateKey);
      if (bucket && ACTION_RATE_LIMITS[next.rateKey]) bucket.history.push(now);
      // Track all dispatched requests, including fast jailbusts that do not
      // spend a global token, to protect shared server headroom for Beam.
      requestLimiter.recentDispatches = (requestLimiter.recentDispatches || []).filter((at) => now - at < 1_000);
      requestLimiter.recentDispatches.push(now);
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

  function reserveRequestSlot(priority, rateKey, validate, defence = false) {
    return new Promise((resolve, reject) => {
      requestLimiter.queue.push({
        priority: Number.isFinite(priority) ? priority : REQUEST_PRIORITY.NORMAL,
        defence: defence === true,
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

  function gameplayMutationAllowed(path, options = {}) {
    const route = String(path).split('?')[0].replace(/\/+$/, '') || '/';
    if (!token || !plannerSocketReady) return false;
    if (route === '/api/auth/login') return loginRunning || state.restartProgress.active;
    if (route.startsWith('/api/death/')) return restartAllowed();
    if (route === '/api/retrieve/all') return restartAllowed();

    if (!automationAllowed()) return false;
    // BG defence exemptions apply only to the request that carries the
    // defence token, never to whatever else happens to be in flight.
    const defenceRequest = options?.defenceToken === DEFENCE_REQUEST_TOKEN &&
      hasDefenceLicence() && state.settings.robotDefence === true &&
      state.defenceRunning && featureEpochCurrent('defence');
    if (route === '/api/auto-rank/settings' && defenceRequest) return true;
    if (route.startsWith('/api/auto-rank/')) {
      return featureEpochCurrent('autoRank') && state.settings.autoRank && !state.prestigeCommitting;
    }
    // Robots can be killed while the owner is jailed; replacements are allowed then.
    if (state.inJail) return defenceRequest && (DEFENCE_REPLACEMENT_ROUTES.has(route) || route === '/api/jail/leave');
    if (defenceTravelLocked() && !defenceRequest && (route === '/api/airport/fly' || route === '/api/drugs/drive' || route === '/api/drugs/buy' || route === '/api/drugs/sell' || route === '/api/kill/shoot' || route === '/api/kill/prepare')) return false;
    if (defenceRequest && DEFENCE_REPLACEMENT_ROUTES.has(route)) return true;
    if (defenceRequest && DEFENCE_ROTATION_ROUTES.has(route)) return state.settings.robotDefenceRotate === true;
    if (/^\/api\/crimes\//.test(route)) return !defenceJailRiskPaused() && featureEpochCurrent('crimes') && state.settings.crimes && !state.prestigeCommitting;
    if (route === '/api/gta/steal') return !defenceJailRiskPaused() && featureEpochCurrent('gta') && state.settings.gta && !state.prestigeCommitting;
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
    // BG defence mutations get their own lane so a replacement never queues
    // behind a slow Beam shot, drug trade or other economy request.
    const lane = options.defenceToken === DEFENCE_REQUEST_TOKEN ? 'defence' : gameMutationLane(path);
    const execute = () => gameJsonDirect(path, { ...options, method });
    const tail = state.actionTails.get(lane) || Promise.resolve();
    const queued = tail.then(execute, execute);
    state.actionTails.set(lane, queued.catch(() => undefined));
    return queued;
  }

  async function gameJsonDirect(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const rateKey = requestRateKey(path, method);
    const diagnosticFastJailBust = hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM) && method === 'POST' && isJailBustPath(path);
    const diagnosticJailRead = hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM) && method === 'GET' && String(path).split('?')[0] === '/api/jail';
    const diagnosticCallStartedAt = performance.now();
    const priority = options.priority ?? (method === 'POST' ? REQUEST_PRIORITY.ACTION : REQUEST_PRIORITY.NORMAL);
    const callerValidate = typeof options.validate === 'function' ? options.validate : null;
    const validate = method === 'POST'
      ? () => {
          if (!gameplayMutationAllowed(path, options)) throw new ActionCancelledError('Action cancelled because automation state changed');
          if (callerValidate) callerValidate();
        }
      : null;

    await reserveRequestSlot(priority, rateKey, validate, options.defenceToken === DEFENCE_REQUEST_TOKEN);
    const diagnosticAfterQueueAt = performance.now();
    if (diagnosticFastJailBust) {
      const wait = Math.max(0, diagnosticAfterQueueAt - diagnosticCallStartedAt);
      jailDiagnostics.jailBustQueueSamples += 1;
      jailDiagnostics.jailBustQueueTotalMs += wait;
      jailDiagnostics.jailBustQueueMaxMs = Math.max(jailDiagnostics.jailBustQueueMaxMs, wait);
    }
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
      const diagnosticFinishedAt = performance.now();
      if (diagnosticFastJailBust) {
        const network = Math.max(0, diagnosticFinishedAt - diagnosticAfterQueueAt);
        jailDiagnostics.jailBustNetworkSamples += 1;
        jailDiagnostics.jailBustNetworkTotalMs += network;
        jailDiagnostics.jailBustNetworkMaxMs = Math.max(jailDiagnostics.jailBustNetworkMaxMs, network);
      }
      if (diagnosticJailRead) {
        const elapsed = Math.max(0, diagnosticFinishedAt - diagnosticCallStartedAt);
        jailDiagnostics.jailReadSamples += 1;
        jailDiagnostics.jailReadTotalMs += elapsed;
        jailDiagnostics.jailReadMaxMs = Math.max(jailDiagnostics.jailReadMaxMs, elapsed);
      }
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

  function averageDiagnostic(total, samples) {
    return samples > 0 ? Math.round(total / samples) : 0;
  }

  function resetJailDiagnostics() {
    const fresh = {
      startedAt: Date.now(), streamConnectAttempts:0, streamReady:0, streamSuperseded:0, streamErrors:0,
      inmateEvents:0, inmateEventServerAgeSamples:0, inmateEventServerAgeTotalMs:0, inmateEventServerAgeMaxMs:0,
      inmateServerGapSamples:0, inmateServerGapTotalMs:0, inmateServerGapMinMs:0, inmateServerGapMaxMs:0,
      inmateGapLt250:0, inmateGap250To749:0, inmateGap750To1249:0, inmateGap1250To2249:0, inmateGap2250Plus:0, inmateGapNearWholeSecond:0,
      attemptNearCadence:0, successNearCadence:0, staleNearCadence:0, attemptOffCadence:0, successOffCadence:0, staleOffCadence:0,
      inmateSourceInitial:0, inmateSourceSignal:0, inmateSourceWatch:0, inmateSourceUnknown:0,
      attemptSourceInitial:0, successSourceInitial:0, staleSourceInitial:0,
      attemptSourceSignal:0, successSourceSignal:0, staleSourceSignal:0,
      attemptSourceWatch:0, successSourceWatch:0, staleSourceWatch:0,
      attemptSourceUnknown:0, successSourceUnknown:0, staleSourceUnknown:0,
      eventSequence:0, lastInmateServerAtMs:0, attemptTrace:[],
      liveSnapshotsNoCandidate:0, liveSnapshotsBlockedBusy:0, liveSnapshotsBlockedInJail:0, liveSnapshotsRateDeferred:0,
      liveBustAttempts:0, liveBustSuccess:0, liveBustStale:0, liveBust429:0, liveBustCaught:0, liveBustOtherErrors:0,
      liveBustRoundTripSamples:0, liveBustRoundTripTotalMs:0, liveBustRoundTripMaxMs:0,
      liveFreshTargetsSeen:0, liveFreshSelections:0, liveFallbackSelections:0, liveMultiCandidateSelections:0,
      liveDispatchPrepSamples:0, liveDispatchPrepTotalMs:0, liveDispatchPrepMaxMs:0,
      liveQueuedTargetDropped:0, liveStaleBackoffApplied:0, liveNewEpisodeRearmed:0, liveDisconnectedSnapshotDrops:0, liveBurstContinuations:0,
      liveBusyPrimaryFreshTargets:0, liveBusySecondaryFreshTargets:0,
      liveSecondaryFreshDuringPrimary:0, liveSecondaryPreferenceOverrides:0,
      liveEventToDispatchSamples:0, liveEventToDispatchTotalMs:0, liveEventToDispatchMaxMs:0,
      attemptVisible:0, successVisible:0, staleVisible:0, attemptHidden:0, successHidden:0, staleHidden:0,
      secondarySessionLoginAttempts:0, secondarySessionLoginSuccess:0, secondarySessionLoginErrors:0,
      secondaryStreamConnectAttempts:0, secondaryStreamReady:0, secondaryStreamErrors:0, secondaryInmateEvents:0,
      secondaryFreshTargetsSeen:0, secondaryOnlyFreshTargetsSeen:0, secondaryOnlySelections:0, secondaryOnlySuccess:0, secondaryOnlyStale:0,
      primaryOnlySelections:0, primaryOnlySuccess:0, primaryOnlyStale:0, bothSeenSelections:0, bothSeenSuccess:0, bothSeenStale:0,
      firstSeenPrimarySelections:0, firstSeenSecondarySelections:0, firstSeenPrimarySuccess:0, firstSeenSecondarySuccess:0, firstSeenPrimaryStale:0, firstSeenSecondaryStale:0,
      primaryLeadSamples:0, primaryLeadTotalMs:0, primaryLeadMaxMs:0, secondaryLeadSamples:0, secondaryLeadTotalMs:0, secondaryLeadMaxMs:0, streamLeadTies:0, runtimeReloadRestores:0,
      jailBustQueueSamples:0, jailBustQueueTotalMs:0, jailBustQueueMaxMs:0,
      jailBustNetworkSamples:0, jailBustNetworkTotalMs:0, jailBustNetworkMaxMs:0,
      jailReadSamples:0, jailReadTotalMs:0, jailReadMaxMs:0,
      lastInmateEventAt:0, lastInmateServerTime:'', lastBustAt:0, lastBustStatus:'',
    };
    // Keep reset in sync with every diagnostic-only metric.
    fresh.streamDiagPrimaryEvents = 0;
    fresh.streamDiagSecondaryEvents = 0;
    fresh.streamDiagPrimaryServerAgeSamples = 0;
    fresh.streamDiagPrimaryServerAgeTotalMs = 0;
    fresh.streamDiagPrimaryServerAgeMaxMs = 0;
    fresh.streamDiagSecondaryServerAgeSamples = 0;
    fresh.streamDiagSecondaryServerAgeTotalMs = 0;
    fresh.streamDiagSecondaryServerAgeMaxMs = 0;
    fresh.streamDiagPrimaryServerGapSamples = 0;
    fresh.streamDiagPrimaryServerGapTotalMs = 0;
    fresh.streamDiagPrimaryServerGapMaxMs = 0;
    fresh.streamDiagSecondaryServerGapSamples = 0;
    fresh.streamDiagSecondaryServerGapTotalMs = 0;
    fresh.streamDiagSecondaryServerGapMaxMs = 0;
    fresh.streamDiagPrimaryInvalidServerTime = 0;
    fresh.streamDiagSecondaryInvalidServerTime = 0;
    fresh.streamDiagPrimaryAdditions = 0;
    fresh.streamDiagPrimaryRemovals = 0;
    fresh.streamDiagSecondaryAdditions = 0;
    fresh.streamDiagSecondaryRemovals = 0;
    fresh.streamDiagPrimaryReappearAfterSecondaryRemoval = 0;
    fresh.streamDiagSecondaryReappearAfterPrimaryRemoval = 0;
    fresh.streamDiagPrimarySameStreamReappear = 0;
    fresh.streamDiagSecondarySameStreamReappear = 0;
    fresh.streamDiagPrimaryDisappearedWhileSecondaryVisible = 0;
    fresh.streamDiagSecondaryDisappearedWhilePrimaryVisible = 0;
    fresh.streamDiagVersionsEqualAtPrimaryEvent = 0;
    fresh.streamDiagVersionsEqualAtSecondaryEvent = 0;
    fresh.streamDiagPrimaryOnlyAfterSecondaryRemovalAttempts = 0;
    fresh.streamDiagPrimaryOnlyAfterSecondaryRemovalSuccess = 0;
    fresh.streamDiagPrimaryOnlyAfterSecondaryRemovalStale = 0;
    fresh.streamDiagSecondaryOnlyAfterPrimaryRemovalAttempts = 0;
    fresh.streamDiagSecondaryOnlyAfterPrimaryRemovalSuccess = 0;
    fresh.streamDiagSecondaryOnlyAfterPrimaryRemovalStale = 0;
    fresh.streamDiagTriggeredPrimaryAttempts = 0;
    fresh.streamDiagTriggeredSecondaryAttempts = 0;
    fresh.streamDiagTriggeredContinuationAttempts = 0;
    fresh.streamDiagTriggeredOtherAttempts = 0;
    fresh.streamDiagTriggeredPrimarySuccess = 0;
    fresh.streamDiagTriggeredSecondarySuccess = 0;
    fresh.streamDiagTriggeredContinuationSuccess = 0;
    fresh.streamDiagTriggeredOtherSuccess = 0;
    fresh.streamDiagTriggeredPrimaryStale = 0;
    fresh.streamDiagTriggeredSecondaryStale = 0;
    fresh.streamDiagTriggeredContinuationStale = 0;
    fresh.streamDiagTriggeredOtherStale = 0;
    fresh.streamDiagPrimaryOnlyNoCrossRemovalStale = 0;
    fresh.streamDiagSecondaryOnlyNoCrossRemovalStale = 0;
    fresh.streamDiagPollBotAttempts = 0;
    fresh.streamDiagPollBotSuccess = 0;
    fresh.streamDiagPollBotStale = 0;
    fresh.streamDiagPollRealAttempts = 0;
    fresh.streamDiagPollRealSuccess = 0;
    fresh.streamDiagPollRealStale = 0;
    fresh.causeDiagPrimaryAttempts = 0;
    fresh.causeDiagPrimarySuccess = 0;
    fresh.causeDiagPrimaryStale = 0;
    fresh.causeDiagPrimaryReportedSecondsTotal = 0;
    fresh.causeDiagPrimaryReportedSecondsSamples = 0;
    fresh.causeDiagPrimaryFirstSeenAgeTotalMs = 0;
    fresh.causeDiagPrimaryFirstSeenAgeSamples = 0;
    fresh.causeDiagPrimaryS0to5Attempts = 0;
    fresh.causeDiagPrimaryS0to5Success = 0;
    fresh.causeDiagPrimaryS0to5Stale = 0;
    fresh.causeDiagPrimaryS6to15Attempts = 0;
    fresh.causeDiagPrimaryS6to15Success = 0;
    fresh.causeDiagPrimaryS6to15Stale = 0;
    fresh.causeDiagPrimaryS16to45Attempts = 0;
    fresh.causeDiagPrimaryS16to45Success = 0;
    fresh.causeDiagPrimaryS16to45Stale = 0;
    fresh.causeDiagPrimaryS46to120Attempts = 0;
    fresh.causeDiagPrimaryS46to120Success = 0;
    fresh.causeDiagPrimaryS46to120Stale = 0;
    fresh.causeDiagPrimaryS121plusAttempts = 0;
    fresh.causeDiagPrimaryS121plusSuccess = 0;
    fresh.causeDiagPrimaryS121plusStale = 0;
    fresh.causeDiagPrimarySUnknownAttempts = 0;
    fresh.causeDiagPrimarySUnknownSuccess = 0;
    fresh.causeDiagPrimarySUnknownStale = 0;
    fresh.causeDiagPrimaryFirstSnapshotAttempts = 0;
    fresh.causeDiagPrimaryFirstSnapshotSuccess = 0;
    fresh.causeDiagPrimaryFirstSnapshotStale = 0;
    fresh.causeDiagPrimaryRepeatSnapshotAttempts = 0;
    fresh.causeDiagPrimaryRepeatSnapshotSuccess = 0;
    fresh.causeDiagPrimaryRepeatSnapshotStale = 0;
    fresh.causeDiagPrimaryNoHistoryAttempts = 0;
    fresh.causeDiagPrimaryNoHistorySuccess = 0;
    fresh.causeDiagPrimaryNoHistoryStale = 0;
    fresh.causeDiagPrimaryNotInJailCount = 0;
    fresh.causeDiagPrimaryNotFoundCount = 0;
    fresh.causeDiagPrimaryDeadCount = 0;
    fresh.causeDiagPrimaryOtherStaleCount = 0;
    fresh.causeDiagPrimaryOtherErrorCount = 0;
    fresh.causeDiagPrimaryCaughtCount = 0;
    fresh.causeDiagPrimaryRateLimitCount = 0;
    fresh.causeDiagPrimarySuccessCount = 0;
    fresh.causeDiagSecondaryAttempts = 0;
    fresh.causeDiagSecondarySuccess = 0;
    fresh.causeDiagSecondaryStale = 0;
    fresh.causeDiagSecondaryReportedSecondsTotal = 0;
    fresh.causeDiagSecondaryReportedSecondsSamples = 0;
    fresh.causeDiagSecondaryFirstSeenAgeTotalMs = 0;
    fresh.causeDiagSecondaryFirstSeenAgeSamples = 0;
    fresh.causeDiagSecondaryS0to5Attempts = 0;
    fresh.causeDiagSecondaryS0to5Success = 0;
    fresh.causeDiagSecondaryS0to5Stale = 0;
    fresh.causeDiagSecondaryS6to15Attempts = 0;
    fresh.causeDiagSecondaryS6to15Success = 0;
    fresh.causeDiagSecondaryS6to15Stale = 0;
    fresh.causeDiagSecondaryS16to45Attempts = 0;
    fresh.causeDiagSecondaryS16to45Success = 0;
    fresh.causeDiagSecondaryS16to45Stale = 0;
    fresh.causeDiagSecondaryS46to120Attempts = 0;
    fresh.causeDiagSecondaryS46to120Success = 0;
    fresh.causeDiagSecondaryS46to120Stale = 0;
    fresh.causeDiagSecondaryS121plusAttempts = 0;
    fresh.causeDiagSecondaryS121plusSuccess = 0;
    fresh.causeDiagSecondaryS121plusStale = 0;
    fresh.causeDiagSecondarySUnknownAttempts = 0;
    fresh.causeDiagSecondarySUnknownSuccess = 0;
    fresh.causeDiagSecondarySUnknownStale = 0;
    fresh.causeDiagSecondaryFirstSnapshotAttempts = 0;
    fresh.causeDiagSecondaryFirstSnapshotSuccess = 0;
    fresh.causeDiagSecondaryFirstSnapshotStale = 0;
    fresh.causeDiagSecondaryRepeatSnapshotAttempts = 0;
    fresh.causeDiagSecondaryRepeatSnapshotSuccess = 0;
    fresh.causeDiagSecondaryRepeatSnapshotStale = 0;
    fresh.causeDiagSecondaryNoHistoryAttempts = 0;
    fresh.causeDiagSecondaryNoHistorySuccess = 0;
    fresh.causeDiagSecondaryNoHistoryStale = 0;
    fresh.causeDiagSecondaryNotInJailCount = 0;
    fresh.causeDiagSecondaryNotFoundCount = 0;
    fresh.causeDiagSecondaryDeadCount = 0;
    fresh.causeDiagSecondaryOtherStaleCount = 0;
    fresh.causeDiagSecondaryOtherErrorCount = 0;
    fresh.causeDiagSecondaryCaughtCount = 0;
    fresh.causeDiagSecondaryRateLimitCount = 0;
    fresh.causeDiagSecondarySuccessCount = 0;
    fresh.causeDiagBothAttempts = 0;
    fresh.causeDiagBothSuccess = 0;
    fresh.causeDiagBothStale = 0;
    fresh.causeDiagBothReportedSecondsTotal = 0;
    fresh.causeDiagBothReportedSecondsSamples = 0;
    fresh.causeDiagBothFirstSeenAgeTotalMs = 0;
    fresh.causeDiagBothFirstSeenAgeSamples = 0;
    fresh.causeDiagBothS0to5Attempts = 0;
    fresh.causeDiagBothS0to5Success = 0;
    fresh.causeDiagBothS0to5Stale = 0;
    fresh.causeDiagBothS6to15Attempts = 0;
    fresh.causeDiagBothS6to15Success = 0;
    fresh.causeDiagBothS6to15Stale = 0;
    fresh.causeDiagBothS16to45Attempts = 0;
    fresh.causeDiagBothS16to45Success = 0;
    fresh.causeDiagBothS16to45Stale = 0;
    fresh.causeDiagBothS46to120Attempts = 0;
    fresh.causeDiagBothS46to120Success = 0;
    fresh.causeDiagBothS46to120Stale = 0;
    fresh.causeDiagBothS121plusAttempts = 0;
    fresh.causeDiagBothS121plusSuccess = 0;
    fresh.causeDiagBothS121plusStale = 0;
    fresh.causeDiagBothSUnknownAttempts = 0;
    fresh.causeDiagBothSUnknownSuccess = 0;
    fresh.causeDiagBothSUnknownStale = 0;
    fresh.causeDiagBothFirstSnapshotAttempts = 0;
    fresh.causeDiagBothFirstSnapshotSuccess = 0;
    fresh.causeDiagBothFirstSnapshotStale = 0;
    fresh.causeDiagBothRepeatSnapshotAttempts = 0;
    fresh.causeDiagBothRepeatSnapshotSuccess = 0;
    fresh.causeDiagBothRepeatSnapshotStale = 0;
    fresh.causeDiagBothNoHistoryAttempts = 0;
    fresh.causeDiagBothNoHistorySuccess = 0;
    fresh.causeDiagBothNoHistoryStale = 0;
    fresh.causeDiagBothNotInJailCount = 0;
    fresh.causeDiagBothNotFoundCount = 0;
    fresh.causeDiagBothDeadCount = 0;
    fresh.causeDiagBothOtherStaleCount = 0;
    fresh.causeDiagBothOtherErrorCount = 0;
    fresh.causeDiagBothCaughtCount = 0;
    fresh.causeDiagBothRateLimitCount = 0;
    fresh.causeDiagBothSuccessCount = 0;
    fresh.causeDiagUnknownAttempts = 0;
    fresh.causeDiagUnknownSuccess = 0;
    fresh.causeDiagUnknownStale = 0;
    fresh.causeDiagUnknownReportedSecondsTotal = 0;
    fresh.causeDiagUnknownReportedSecondsSamples = 0;
    fresh.causeDiagUnknownFirstSeenAgeTotalMs = 0;
    fresh.causeDiagUnknownFirstSeenAgeSamples = 0;
    fresh.causeDiagUnknownS0to5Attempts = 0;
    fresh.causeDiagUnknownS0to5Success = 0;
    fresh.causeDiagUnknownS0to5Stale = 0;
    fresh.causeDiagUnknownS6to15Attempts = 0;
    fresh.causeDiagUnknownS6to15Success = 0;
    fresh.causeDiagUnknownS6to15Stale = 0;
    fresh.causeDiagUnknownS16to45Attempts = 0;
    fresh.causeDiagUnknownS16to45Success = 0;
    fresh.causeDiagUnknownS16to45Stale = 0;
    fresh.causeDiagUnknownS46to120Attempts = 0;
    fresh.causeDiagUnknownS46to120Success = 0;
    fresh.causeDiagUnknownS46to120Stale = 0;
    fresh.causeDiagUnknownS121plusAttempts = 0;
    fresh.causeDiagUnknownS121plusSuccess = 0;
    fresh.causeDiagUnknownS121plusStale = 0;
    fresh.causeDiagUnknownSUnknownAttempts = 0;
    fresh.causeDiagUnknownSUnknownSuccess = 0;
    fresh.causeDiagUnknownSUnknownStale = 0;
    fresh.causeDiagUnknownFirstSnapshotAttempts = 0;
    fresh.causeDiagUnknownFirstSnapshotSuccess = 0;
    fresh.causeDiagUnknownFirstSnapshotStale = 0;
    fresh.causeDiagUnknownRepeatSnapshotAttempts = 0;
    fresh.causeDiagUnknownRepeatSnapshotSuccess = 0;
    fresh.causeDiagUnknownRepeatSnapshotStale = 0;
    fresh.causeDiagUnknownNoHistoryAttempts = 0;
    fresh.causeDiagUnknownNoHistorySuccess = 0;
    fresh.causeDiagUnknownNoHistoryStale = 0;
    fresh.causeDiagUnknownNotInJailCount = 0;
    fresh.causeDiagUnknownNotFoundCount = 0;
    fresh.causeDiagUnknownDeadCount = 0;
    fresh.causeDiagUnknownOtherStaleCount = 0;
    fresh.causeDiagUnknownOtherErrorCount = 0;
    fresh.causeDiagUnknownCaughtCount = 0;
    fresh.causeDiagUnknownRateLimitCount = 0;
    fresh.causeDiagUnknownSuccessCount = 0;
    fresh.causeDiagHistoryMissing = 0;
    fresh.causeDiagMetricsErrors = 0;
    fresh.pollDiagReads = 0;
    fresh.pollDiagRealTargetsTotal = 0;
    fresh.pollDiagPrimaryComparableReads = 0;
    fresh.pollDiagPrimaryNonComparableReads = 0;
    fresh.pollDiagPrimaryBothTargets = 0;
    fresh.pollDiagPrimaryPollOnlyTargets = 0;
    fresh.pollDiagPrimaryStreamOnlyTargets = 0;
    fresh.pollDiagSecondaryComparableReads = 0;
    fresh.pollDiagSecondaryNonComparableReads = 0;
    fresh.pollDiagSecondaryBothTargets = 0;
    fresh.pollDiagSecondaryPollOnlyTargets = 0;
    fresh.pollDiagSecondaryStreamOnlyTargets = 0;
    fresh.pollDiagPollBeforePrimary = 0;
    fresh.pollDiagPrimaryBeforePoll = 0;
    fresh.pollDiagPollPrimaryTies = 0;
    fresh.pollDiagPollBeforePrimaryLagTotalMs = 0;
    fresh.pollDiagPrimaryBeforePollLagTotalMs = 0;
    fresh.pollDiagPollBeforeSecondary = 0;
    fresh.pollDiagSecondaryBeforePoll = 0;
    fresh.pollDiagPollSecondaryTies = 0;
    fresh.pollDiagPollBeforeSecondaryLagTotalMs = 0;
    fresh.pollDiagSecondaryBeforePollLagTotalMs = 0;
    fresh.pollDiagMetricsErrors = 0;
    fresh.pollDiagPrimaryPollPresentAttempts = 0;
    fresh.pollDiagPrimaryPollPresentSuccess = 0;
    fresh.pollDiagPrimaryPollPresentStale = 0;
    fresh.pollDiagPrimaryPollAbsentAttempts = 0;
    fresh.pollDiagPrimaryPollAbsentSuccess = 0;
    fresh.pollDiagPrimaryPollAbsentStale = 0;
    fresh.pollDiagPrimaryNoRecentPollAttempts = 0;
    fresh.pollDiagPrimaryNoRecentPollSuccess = 0;
    fresh.pollDiagPrimaryNoRecentPollStale = 0;
    fresh.pollDiagSecondaryPollPresentAttempts = 0;
    fresh.pollDiagSecondaryPollPresentSuccess = 0;
    fresh.pollDiagSecondaryPollPresentStale = 0;
    fresh.pollDiagSecondaryPollAbsentAttempts = 0;
    fresh.pollDiagSecondaryPollAbsentSuccess = 0;
    fresh.pollDiagSecondaryPollAbsentStale = 0;
    fresh.pollDiagSecondaryNoRecentPollAttempts = 0;
    fresh.pollDiagSecondaryNoRecentPollSuccess = 0;
    fresh.pollDiagSecondaryNoRecentPollStale = 0;
    fresh.pollDiagBothPollPresentAttempts = 0;
    fresh.pollDiagBothPollPresentSuccess = 0;
    fresh.pollDiagBothPollPresentStale = 0;
    fresh.pollDiagBothPollAbsentAttempts = 0;
    fresh.pollDiagBothPollAbsentSuccess = 0;
    fresh.pollDiagBothPollAbsentStale = 0;
    fresh.pollDiagBothNoRecentPollAttempts = 0;
    fresh.pollDiagBothNoRecentPollSuccess = 0;
    fresh.pollDiagBothNoRecentPollStale = 0;
    fresh.pagehideObserved = 0;
    fresh.pagehidePrimaryClosed = 0;
    fresh.pagehideSecondaryAborted = 0;
    fresh.bfcacheReconnections = 0;
    fresh.primaryStreamClosedOnStop = 0;
    fresh.secondaryStreamAbortedOnStop = 0;
    fresh.primaryStreamReadyAfterRestore = 0;
    fresh.secondaryStreamReadyAfterRestore = 0;
    fresh.primarySseSupersededLifecycle = 0;
    fresh.secondarySseSupersededLifecycle = 0;
    fresh.secondaryGmAbortEvents = 0;
    fresh.secondaryCookieSetObserved = 0;
    fresh.secondaryLoginSameAccountVerified = 0;
    fresh.secondarySessionRestoreVerified = 0;
    fresh.secondarySessionNewLogin = 0;
    fresh.secondaryTokenReusedAcrossReload = 0;
    fresh.secondaryLoginTokenRotationObserved = 0;
    fresh.routingBothReadySnapshotEvents = 0;
    fresh.routingExactBroadcastMatches = 0;
    fresh.routingNearbySameVersionEvents = 0;
    fresh.routingNearbyDifferentTimestampEvents = 0;
    fresh.routingMetricsErrors = 0;
    fresh.routingTrace = [];
    Object.assign(jailDiagnostics, fresh);
    resetJailRoutingRecent();
    resetJailPollComparison();
    jailIndependentStreamEvents = 0;
    jailIndependentHistory.clear();
    jailCauseEpisodes = { primary:new Map(), secondary:new Map() };
    for (const stream of ['primary', 'secondary']) {
      jailIndependentMeta[stream] = { primed:false, targets:new Set(), receivedAt:0, serverAt:0, version:'', seq:0, lastServerAt:0 };
    }
    jailTargetSightings.clear();
    jailActiveBustSelectedStream = 'none';
    jailLatestEventMeta = { seq: 0, serverAtMs: 0, serverGapMs: -1, serverAgeMs: -1, nearCadence: false, refreshSource: 'unknown', receivedPerf: 0, hidden: false };
    persistReloadState();
  }

  function formatJailDiagnostics() {
    const now = Date.now();
    const seconds = Math.max(1, Math.round((now - jailDiagnostics.startedAt) / 1000));
    return [
      `UL Bot jail diagnostics · loader v${SCRIPT_VERSION}`,
      `sampleSeconds=${seconds}`,
      `fastFeature=${hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM)}`,
      'routingNote=An exact shared non-initial SSE broadcast timestamp plus identical version strongly suggests one backend process; no backend 1/2/3 identifier is exposed client-side.',
      'sessionNote=Game /api/auth/login creates a new HttpOnly ug_session cookie; secondary session is verified as same account; main HttpOnly token cannot be read or compared by the userscript.',
      `backendIdentityPrimary=unavailable`,
      `backendIdentitySecondary=unavailable`,
      `routingEvidence=${jailRoutingCurrentPair.exactMatches > 0 ? 'shared-backend-broadcast-observed-in-current-pair' : jailRoutingCurrentPair.bothReadyEvents >= 30 ? 'no-exact-match-in-current-pair-not-proof-of-different-backends' : 'insufficient-comparable-events-current-pair'}`,
      `routingPairEpoch=${jailRoutingCurrentPair.epoch}`,
      `routingCurrentPairBothReadyEvents=${jailRoutingCurrentPair.bothReadyEvents}`,
      `routingCurrentPairExactMatches=${jailRoutingCurrentPair.exactMatches}`,
      `routingCurrentPairNearbySameVersion=${jailRoutingCurrentPair.nearbySameVersion}`,
      `routingBothReadySnapshotEvents=${jailDiagnostics.routingBothReadySnapshotEvents}`,
      `routingExactBroadcastMatches=${jailDiagnostics.routingExactBroadcastMatches}`,
      `routingNearbySameVersionEvents=${jailDiagnostics.routingNearbySameVersionEvents}`,
      `routingNearbyDifferentTimestampEvents=${jailDiagnostics.routingNearbyDifferentTimestampEvents}`,
      `routingMetricsErrors=${jailDiagnostics.routingMetricsErrors}`,
      `secondaryCookieSetObserved=${jailDiagnostics.secondaryCookieSetObserved}`,
      `secondarySessionNewLogin=${jailDiagnostics.secondarySessionNewLogin}`,
      `secondarySessionRestoreVerified=${jailDiagnostics.secondarySessionRestoreVerified}`,
      `secondaryLoginSameAccountVerified=${jailDiagnostics.secondaryLoginSameAccountVerified}`,
      `secondaryLoginTokenRotationObserved=${jailDiagnostics.secondaryLoginTokenRotationObserved}`,
      `secondaryStoredTokenPresent=${Boolean(jailSecondaryToken)}`,
      `secondarySessionCreatedAtPresent=${jailSecondaryTokenCreatedAt > 0}`,
      `secondaryTokenReusedAcrossReload=${jailDiagnostics.secondaryTokenReusedAcrossReload}`,
      `primaryStreamReadyLifecycle=${jailDiagnostics.primaryStreamReadyAfterRestore}`,
      `secondaryStreamReadyLifecycle=${jailDiagnostics.secondaryStreamReadyAfterRestore}`,
      `sessionComparisonWithMain=not-readable-HttpOnly-cookie`,
      `pagehideObserved=${jailDiagnostics.pagehideObserved}`,
      `pagehidePrimaryClosed=${jailDiagnostics.pagehidePrimaryClosed}`,
      `pagehideSecondaryAborted=${jailDiagnostics.pagehideSecondaryAborted}`,
      `bfcacheReconnections=${jailDiagnostics.bfcacheReconnections}`,
      `primaryStreamClosedOnStop=${jailDiagnostics.primaryStreamClosedOnStop}`,
      `secondaryStreamAbortedOnStop=${jailDiagnostics.secondaryStreamAbortedOnStop}`,
      `primarySseSupersededLifecycle=${jailDiagnostics.primarySseSupersededLifecycle}`,
      `secondarySseSupersededLifecycle=${jailDiagnostics.secondarySseSupersededLifecycle}`,
      `secondaryGmAbortEvents=${jailDiagnostics.secondaryGmAbortEvents}`,
      'routingTraceFormat=unixMs,event,detail',
      ...jailDiagnostics.routingTrace.slice(-24).map((row) => `routingTrace=${row.at},${row.event},${row.detail}`),
      `streamReadyNow=${jailStreamReady}`,
      `streamConnectAttempts=${jailDiagnostics.streamConnectAttempts}`,
      `streamReadyEvents=${jailDiagnostics.streamReady}`,
      `streamSuperseded=${jailDiagnostics.streamSuperseded}`,
      `streamErrors=${jailDiagnostics.streamErrors}`,
      `inmateEvents=${jailDiagnostics.inmateEvents}`,
      `inmateServerAgeAvgMs=${averageDiagnostic(jailDiagnostics.inmateEventServerAgeTotalMs,jailDiagnostics.inmateEventServerAgeSamples)}`,
      `inmateServerAgeMaxMs=${Math.round(jailDiagnostics.inmateEventServerAgeMaxMs)}`,
      `inmateServerGapAvgMs=${averageDiagnostic(jailDiagnostics.inmateServerGapTotalMs,jailDiagnostics.inmateServerGapSamples)}`,
      `inmateServerGapMinMs=${Math.round(jailDiagnostics.inmateServerGapMinMs)}`,
      `inmateServerGapMaxMs=${Math.round(jailDiagnostics.inmateServerGapMaxMs)}`,
      `inmateGapLt250=${jailDiagnostics.inmateGapLt250}`,
      `inmateGap250To749=${jailDiagnostics.inmateGap250To749}`,
      `inmateGap750To1249=${jailDiagnostics.inmateGap750To1249}`,
      `inmateGap1250To2249=${jailDiagnostics.inmateGap1250To2249}`,
      `inmateGap2250Plus=${jailDiagnostics.inmateGap2250Plus}`,
      `inmateGapNearWholeSecond=${jailDiagnostics.inmateGapNearWholeSecond}`,
      `attemptNearCadence=${jailDiagnostics.attemptNearCadence}`,
      `successNearCadence=${jailDiagnostics.successNearCadence}`,
      `staleNearCadence=${jailDiagnostics.staleNearCadence}`,
      `attemptOffCadence=${jailDiagnostics.attemptOffCadence}`,
      `successOffCadence=${jailDiagnostics.successOffCadence}`,
      `staleOffCadence=${jailDiagnostics.staleOffCadence}`,
      `inmateSourceInitial=${jailDiagnostics.inmateSourceInitial}`,
      `inmateSourceSignal=${jailDiagnostics.inmateSourceSignal}`,
      `inmateSourceWatch=${jailDiagnostics.inmateSourceWatch}`,
      `inmateSourceUnknown=${jailDiagnostics.inmateSourceUnknown}`,
      `attemptSourceInitial=${jailDiagnostics.attemptSourceInitial}`,
      `successSourceInitial=${jailDiagnostics.successSourceInitial}`,
      `staleSourceInitial=${jailDiagnostics.staleSourceInitial}`,
      `attemptSourceSignal=${jailDiagnostics.attemptSourceSignal}`,
      `successSourceSignal=${jailDiagnostics.successSourceSignal}`,
      `staleSourceSignal=${jailDiagnostics.staleSourceSignal}`,
      `attemptSourceWatch=${jailDiagnostics.attemptSourceWatch}`,
      `successSourceWatch=${jailDiagnostics.successSourceWatch}`,
      `staleSourceWatch=${jailDiagnostics.staleSourceWatch}`,
      `attemptSourceUnknown=${jailDiagnostics.attemptSourceUnknown}`,
      `successSourceUnknown=${jailDiagnostics.successSourceUnknown}`,
      `staleSourceUnknown=${jailDiagnostics.staleSourceUnknown}`,
      `liveNoCandidate=${jailDiagnostics.liveSnapshotsNoCandidate}`,
      `liveBlockedBusy=${jailDiagnostics.liveSnapshotsBlockedBusy}`,
      `liveBlockedInJail=${jailDiagnostics.liveSnapshotsBlockedInJail}`,
      `liveRateDeferred=${jailDiagnostics.liveSnapshotsRateDeferred}`,
      `liveBustAttempts=${jailDiagnostics.liveBustAttempts}`,
      `liveBustSuccess=${jailDiagnostics.liveBustSuccess}`,
      `liveBustStale=${jailDiagnostics.liveBustStale}`,
      `liveBust429=${jailDiagnostics.liveBust429}`,
      `liveBustCaught=${jailDiagnostics.liveBustCaught}`,
      `liveBustOtherErrors=${jailDiagnostics.liveBustOtherErrors}`,
      `liveBustRoundTripAvgMs=${averageDiagnostic(jailDiagnostics.liveBustRoundTripTotalMs,jailDiagnostics.liveBustRoundTripSamples)}`,
      `liveBustRoundTripMaxMs=${Math.round(jailDiagnostics.liveBustRoundTripMaxMs)}`,
      `liveFreshTargetsSeen=${jailDiagnostics.liveFreshTargetsSeen}`,
      `liveFreshSelections=${jailDiagnostics.liveFreshSelections}`,
      `liveFallbackSelections=${jailDiagnostics.liveFallbackSelections}`,
      `liveMultiCandidateSelections=${jailDiagnostics.liveMultiCandidateSelections}`,
      `liveDispatchPrepAvgMs=${averageDiagnostic(jailDiagnostics.liveDispatchPrepTotalMs,jailDiagnostics.liveDispatchPrepSamples)}`,
      `liveDispatchPrepMaxMs=${Math.round(jailDiagnostics.liveDispatchPrepMaxMs)}`,
      `liveQueuedTargetDropped=${jailDiagnostics.liveQueuedTargetDropped}`,
      `liveStaleBackoffApplied=${jailDiagnostics.liveStaleBackoffApplied}`,
      `liveNewEpisodeRearmed=${jailDiagnostics.liveNewEpisodeRearmed}`,
      `liveDisconnectedSnapshotDrops=${jailDiagnostics.liveDisconnectedSnapshotDrops}`,
      `liveBurstContinuations=${jailDiagnostics.liveBurstContinuations}`,
      `liveBusyPrimaryFreshTargets=${jailDiagnostics.liveBusyPrimaryFreshTargets}`,
      `liveBusySecondaryFreshTargets=${jailDiagnostics.liveBusySecondaryFreshTargets}`,
      `liveSecondaryFreshDuringPrimary=${jailDiagnostics.liveSecondaryFreshDuringPrimary}`,
      `liveSecondaryPreferenceOverrides=${jailDiagnostics.liveSecondaryPreferenceOverrides}`,
      `liveEventToDispatchAvgMs=${averageDiagnostic(jailDiagnostics.liveEventToDispatchTotalMs,jailDiagnostics.liveEventToDispatchSamples)}`,
      `liveEventToDispatchMaxMs=${Math.round(jailDiagnostics.liveEventToDispatchMaxMs)}`,
      `attemptVisible=${jailDiagnostics.attemptVisible}`,
      `successVisible=${jailDiagnostics.successVisible}`,
      `staleVisible=${jailDiagnostics.staleVisible}`,
      `attemptHidden=${jailDiagnostics.attemptHidden}`,
      `successHidden=${jailDiagnostics.successHidden}`,
      `staleHidden=${jailDiagnostics.staleHidden}`,
      `secondaryEnabled=${jailSecondaryEnabled}`,
      `secondaryReadyNow=${jailSecondaryReady}`,
      `secondarySessionLoginAttempts=${jailDiagnostics.secondarySessionLoginAttempts}`,
      `secondarySessionLoginSuccess=${jailDiagnostics.secondarySessionLoginSuccess}`,
      `secondarySessionLoginErrors=${jailDiagnostics.secondarySessionLoginErrors}`,
      `secondaryStreamConnectAttempts=${jailDiagnostics.secondaryStreamConnectAttempts}`,
      `secondaryStreamReadyEvents=${jailDiagnostics.secondaryStreamReady}`,
      `secondaryStreamErrors=${jailDiagnostics.secondaryStreamErrors}`,
      `secondaryInmateEvents=${jailDiagnostics.secondaryInmateEvents}`,
      `secondaryFreshTargetsSeen=${jailDiagnostics.secondaryFreshTargetsSeen}`,
      `secondaryOnlyFreshTargetsSeen=${jailDiagnostics.secondaryOnlyFreshTargetsSeen}`,
      `secondaryOnlySelections=${jailDiagnostics.secondaryOnlySelections}`,
      `secondaryOnlySuccess=${jailDiagnostics.secondaryOnlySuccess}`,
      `secondaryOnlyStale=${jailDiagnostics.secondaryOnlyStale}`,
      `primaryOnlySelections=${jailDiagnostics.primaryOnlySelections}`,
      `primaryOnlySuccess=${jailDiagnostics.primaryOnlySuccess}`,
      `primaryOnlyStale=${jailDiagnostics.primaryOnlyStale}`,
      `bothSeenSelections=${jailDiagnostics.bothSeenSelections}`,
      `bothSeenSuccess=${jailDiagnostics.bothSeenSuccess}`,
      `bothSeenStale=${jailDiagnostics.bothSeenStale}`,
      `firstSeenPrimarySelections=${jailDiagnostics.firstSeenPrimarySelections}`,
      `firstSeenSecondarySelections=${jailDiagnostics.firstSeenSecondarySelections}`,
      `firstSeenPrimarySuccess=${jailDiagnostics.firstSeenPrimarySuccess}`,
      `firstSeenSecondarySuccess=${jailDiagnostics.firstSeenSecondarySuccess}`,
      `firstSeenPrimaryStale=${jailDiagnostics.firstSeenPrimaryStale}`,
      `firstSeenSecondaryStale=${jailDiagnostics.firstSeenSecondaryStale}`,
      `primaryLeadAvgMs=${averageDiagnostic(jailDiagnostics.primaryLeadTotalMs,jailDiagnostics.primaryLeadSamples)}`,
      `primaryLeadMaxMs=${Math.round(jailDiagnostics.primaryLeadMaxMs)}`,
      `secondaryLeadAvgMs=${averageDiagnostic(jailDiagnostics.secondaryLeadTotalMs,jailDiagnostics.secondaryLeadSamples)}`,
      `secondaryLeadMaxMs=${Math.round(jailDiagnostics.secondaryLeadMaxMs)}`,
      `streamLeadTies=${jailDiagnostics.streamLeadTies}`,
      `runtimeReloadRestores=${jailDiagnostics.runtimeReloadRestores}`,
      `jailBustQueueAvgMs=${averageDiagnostic(jailDiagnostics.jailBustQueueTotalMs,jailDiagnostics.jailBustQueueSamples)}`,
      `jailBustQueueMaxMs=${Math.round(jailDiagnostics.jailBustQueueMaxMs)}`,
      `jailBustNetworkAvgMs=${averageDiagnostic(jailDiagnostics.jailBustNetworkTotalMs,jailDiagnostics.jailBustNetworkSamples)}`,
      `jailBustNetworkMaxMs=${Math.round(jailDiagnostics.jailBustNetworkMaxMs)}`,
      `jailReadAvgMs=${averageDiagnostic(jailDiagnostics.jailReadTotalMs,jailDiagnostics.jailReadSamples)}`,
      `jailReadMaxMs=${Math.round(jailDiagnostics.jailReadMaxMs)}`,
      `lastBustStatus=${jailDiagnostics.lastBustStatus || 'none'}`,
      `lastInmateEventAgoMs=${jailDiagnostics.lastInmateEventAt ? now-jailDiagnostics.lastInmateEventAt : -1}`,
      `lastBustAgoMs=${jailDiagnostics.lastBustAt ? now-jailDiagnostics.lastBustAt : -1}`,
      'diagNote=anonymous observations only; snapshot serverTime is broadcast time, version is non-monotonic content fingerprint',
      `diagPrimaryLatestSeq=${jailIndependentMeta.primary.seq}`,
      `diagSecondaryLatestSeq=${jailIndependentMeta.secondary.seq}`,
      `diagPrimaryLatestVersion=${jailIndependentMeta.primary.version || 'none'}`,
      `diagSecondaryLatestVersion=${jailIndependentMeta.secondary.version || 'none'}`,
      `diagPrimaryLatestSnapshotAgoMs=${jailIndependentMeta.primary.receivedAt ? now - jailIndependentMeta.primary.receivedAt : -1}`,
      `diagSecondaryLatestSnapshotAgoMs=${jailIndependentMeta.secondary.receivedAt ? now - jailIndependentMeta.secondary.receivedAt : -1}`,
      `diagPrimaryServerAgeAvgMs=${averageDiagnostic(jailDiagnostics.streamDiagPrimaryServerAgeTotalMs,jailDiagnostics.streamDiagPrimaryServerAgeSamples)}`,
      `diagPrimaryServerAgeMaxMs=${Math.round(jailDiagnostics.streamDiagPrimaryServerAgeMaxMs)}`,
      `diagPrimaryServerGapAvgMs=${averageDiagnostic(jailDiagnostics.streamDiagPrimaryServerGapTotalMs,jailDiagnostics.streamDiagPrimaryServerGapSamples)}`,
      `diagSecondaryServerAgeAvgMs=${averageDiagnostic(jailDiagnostics.streamDiagSecondaryServerAgeTotalMs,jailDiagnostics.streamDiagSecondaryServerAgeSamples)}`,
      `diagSecondaryServerAgeMaxMs=${Math.round(jailDiagnostics.streamDiagSecondaryServerAgeMaxMs)}`,
      `diagSecondaryServerGapAvgMs=${averageDiagnostic(jailDiagnostics.streamDiagSecondaryServerGapTotalMs,jailDiagnostics.streamDiagSecondaryServerGapSamples)}`,
      `streamDiagPrimaryEvents=${jailDiagnostics.streamDiagPrimaryEvents}`,
      `streamDiagSecondaryEvents=${jailDiagnostics.streamDiagSecondaryEvents}`,
      `streamDiagPrimaryServerAgeSamples=${jailDiagnostics.streamDiagPrimaryServerAgeSamples}`,
      `streamDiagPrimaryServerAgeTotalMs=${jailDiagnostics.streamDiagPrimaryServerAgeTotalMs}`,
      `streamDiagPrimaryServerAgeMaxMs=${jailDiagnostics.streamDiagPrimaryServerAgeMaxMs}`,
      `streamDiagSecondaryServerAgeSamples=${jailDiagnostics.streamDiagSecondaryServerAgeSamples}`,
      `streamDiagSecondaryServerAgeTotalMs=${jailDiagnostics.streamDiagSecondaryServerAgeTotalMs}`,
      `streamDiagSecondaryServerAgeMaxMs=${jailDiagnostics.streamDiagSecondaryServerAgeMaxMs}`,
      `streamDiagPrimaryServerGapSamples=${jailDiagnostics.streamDiagPrimaryServerGapSamples}`,
      `streamDiagPrimaryServerGapTotalMs=${jailDiagnostics.streamDiagPrimaryServerGapTotalMs}`,
      `streamDiagPrimaryServerGapMaxMs=${jailDiagnostics.streamDiagPrimaryServerGapMaxMs}`,
      `streamDiagSecondaryServerGapSamples=${jailDiagnostics.streamDiagSecondaryServerGapSamples}`,
      `streamDiagSecondaryServerGapTotalMs=${jailDiagnostics.streamDiagSecondaryServerGapTotalMs}`,
      `streamDiagSecondaryServerGapMaxMs=${jailDiagnostics.streamDiagSecondaryServerGapMaxMs}`,
      `streamDiagPrimaryInvalidServerTime=${jailDiagnostics.streamDiagPrimaryInvalidServerTime}`,
      `streamDiagSecondaryInvalidServerTime=${jailDiagnostics.streamDiagSecondaryInvalidServerTime}`,
      `streamDiagPrimaryAdditions=${jailDiagnostics.streamDiagPrimaryAdditions}`,
      `streamDiagPrimaryRemovals=${jailDiagnostics.streamDiagPrimaryRemovals}`,
      `streamDiagSecondaryAdditions=${jailDiagnostics.streamDiagSecondaryAdditions}`,
      `streamDiagSecondaryRemovals=${jailDiagnostics.streamDiagSecondaryRemovals}`,
      `streamDiagPrimaryReappearAfterSecondaryRemoval=${jailDiagnostics.streamDiagPrimaryReappearAfterSecondaryRemoval}`,
      `streamDiagSecondaryReappearAfterPrimaryRemoval=${jailDiagnostics.streamDiagSecondaryReappearAfterPrimaryRemoval}`,
      `streamDiagPrimarySameStreamReappear=${jailDiagnostics.streamDiagPrimarySameStreamReappear}`,
      `streamDiagSecondarySameStreamReappear=${jailDiagnostics.streamDiagSecondarySameStreamReappear}`,
      `streamDiagPrimaryDisappearedWhileSecondaryVisible=${jailDiagnostics.streamDiagPrimaryDisappearedWhileSecondaryVisible}`,
      `streamDiagSecondaryDisappearedWhilePrimaryVisible=${jailDiagnostics.streamDiagSecondaryDisappearedWhilePrimaryVisible}`,
      `streamDiagVersionsEqualAtPrimaryEvent=${jailDiagnostics.streamDiagVersionsEqualAtPrimaryEvent}`,
      `streamDiagVersionsEqualAtSecondaryEvent=${jailDiagnostics.streamDiagVersionsEqualAtSecondaryEvent}`,
      `streamDiagPrimaryOnlyAfterSecondaryRemovalAttempts=${jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalAttempts}`,
      `streamDiagPrimaryOnlyAfterSecondaryRemovalSuccess=${jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalSuccess}`,
      `streamDiagPrimaryOnlyAfterSecondaryRemovalStale=${jailDiagnostics.streamDiagPrimaryOnlyAfterSecondaryRemovalStale}`,
      `streamDiagSecondaryOnlyAfterPrimaryRemovalAttempts=${jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalAttempts}`,
      `streamDiagSecondaryOnlyAfterPrimaryRemovalSuccess=${jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalSuccess}`,
      `streamDiagSecondaryOnlyAfterPrimaryRemovalStale=${jailDiagnostics.streamDiagSecondaryOnlyAfterPrimaryRemovalStale}`,
      `streamDiagTriggeredPrimaryAttempts=${jailDiagnostics.streamDiagTriggeredPrimaryAttempts}`,
      `streamDiagTriggeredSecondaryAttempts=${jailDiagnostics.streamDiagTriggeredSecondaryAttempts}`,
      `streamDiagTriggeredContinuationAttempts=${jailDiagnostics.streamDiagTriggeredContinuationAttempts}`,
      `streamDiagTriggeredOtherAttempts=${jailDiagnostics.streamDiagTriggeredOtherAttempts}`,
      `streamDiagTriggeredPrimarySuccess=${jailDiagnostics.streamDiagTriggeredPrimarySuccess}`,
      `streamDiagTriggeredSecondarySuccess=${jailDiagnostics.streamDiagTriggeredSecondarySuccess}`,
      `streamDiagTriggeredContinuationSuccess=${jailDiagnostics.streamDiagTriggeredContinuationSuccess}`,
      `streamDiagTriggeredOtherSuccess=${jailDiagnostics.streamDiagTriggeredOtherSuccess}`,
      `streamDiagTriggeredPrimaryStale=${jailDiagnostics.streamDiagTriggeredPrimaryStale}`,
      `streamDiagTriggeredSecondaryStale=${jailDiagnostics.streamDiagTriggeredSecondaryStale}`,
      `streamDiagTriggeredContinuationStale=${jailDiagnostics.streamDiagTriggeredContinuationStale}`,
      `streamDiagTriggeredOtherStale=${jailDiagnostics.streamDiagTriggeredOtherStale}`,
      `streamDiagPrimaryOnlyNoCrossRemovalStale=${jailDiagnostics.streamDiagPrimaryOnlyNoCrossRemovalStale}`,
      `streamDiagSecondaryOnlyNoCrossRemovalStale=${jailDiagnostics.streamDiagSecondaryOnlyNoCrossRemovalStale}`,
      `streamDiagPollBotAttempts=${jailDiagnostics.streamDiagPollBotAttempts}`,
      `streamDiagPollBotSuccess=${jailDiagnostics.streamDiagPollBotSuccess}`,
      `streamDiagPollBotStale=${jailDiagnostics.streamDiagPollBotStale}`,
      `streamDiagPollRealAttempts=${jailDiagnostics.streamDiagPollRealAttempts}`,
      `streamDiagPollRealSuccess=${jailDiagnostics.streamDiagPollRealSuccess}`,
      `streamDiagPollRealStale=${jailDiagnostics.streamDiagPollRealStale}`,
      `causeDiagPrimaryAttempts=${jailDiagnostics.causeDiagPrimaryAttempts}`,
      `causeDiagPrimarySuccess=${jailDiagnostics.causeDiagPrimarySuccess}`,
      `causeDiagPrimaryStale=${jailDiagnostics.causeDiagPrimaryStale}`,
      `causeDiagPrimaryReportedSecondsTotal=${jailDiagnostics.causeDiagPrimaryReportedSecondsTotal}`,
      `causeDiagPrimaryReportedSecondsSamples=${jailDiagnostics.causeDiagPrimaryReportedSecondsSamples}`,
      `causeDiagPrimaryFirstSeenAgeTotalMs=${jailDiagnostics.causeDiagPrimaryFirstSeenAgeTotalMs}`,
      `causeDiagPrimaryFirstSeenAgeSamples=${jailDiagnostics.causeDiagPrimaryFirstSeenAgeSamples}`,
      `causeDiagPrimaryS0to5Attempts=${jailDiagnostics.causeDiagPrimaryS0to5Attempts}`,
      `causeDiagPrimaryS0to5Success=${jailDiagnostics.causeDiagPrimaryS0to5Success}`,
      `causeDiagPrimaryS0to5Stale=${jailDiagnostics.causeDiagPrimaryS0to5Stale}`,
      `causeDiagPrimaryS6to15Attempts=${jailDiagnostics.causeDiagPrimaryS6to15Attempts}`,
      `causeDiagPrimaryS6to15Success=${jailDiagnostics.causeDiagPrimaryS6to15Success}`,
      `causeDiagPrimaryS6to15Stale=${jailDiagnostics.causeDiagPrimaryS6to15Stale}`,
      `causeDiagPrimaryS16to45Attempts=${jailDiagnostics.causeDiagPrimaryS16to45Attempts}`,
      `causeDiagPrimaryS16to45Success=${jailDiagnostics.causeDiagPrimaryS16to45Success}`,
      `causeDiagPrimaryS16to45Stale=${jailDiagnostics.causeDiagPrimaryS16to45Stale}`,
      `causeDiagPrimaryS46to120Attempts=${jailDiagnostics.causeDiagPrimaryS46to120Attempts}`,
      `causeDiagPrimaryS46to120Success=${jailDiagnostics.causeDiagPrimaryS46to120Success}`,
      `causeDiagPrimaryS46to120Stale=${jailDiagnostics.causeDiagPrimaryS46to120Stale}`,
      `causeDiagPrimaryS121plusAttempts=${jailDiagnostics.causeDiagPrimaryS121plusAttempts}`,
      `causeDiagPrimaryS121plusSuccess=${jailDiagnostics.causeDiagPrimaryS121plusSuccess}`,
      `causeDiagPrimaryS121plusStale=${jailDiagnostics.causeDiagPrimaryS121plusStale}`,
      `causeDiagPrimarySUnknownAttempts=${jailDiagnostics.causeDiagPrimarySUnknownAttempts}`,
      `causeDiagPrimarySUnknownSuccess=${jailDiagnostics.causeDiagPrimarySUnknownSuccess}`,
      `causeDiagPrimarySUnknownStale=${jailDiagnostics.causeDiagPrimarySUnknownStale}`,
      `causeDiagPrimaryFirstSnapshotAttempts=${jailDiagnostics.causeDiagPrimaryFirstSnapshotAttempts}`,
      `causeDiagPrimaryFirstSnapshotSuccess=${jailDiagnostics.causeDiagPrimaryFirstSnapshotSuccess}`,
      `causeDiagPrimaryFirstSnapshotStale=${jailDiagnostics.causeDiagPrimaryFirstSnapshotStale}`,
      `causeDiagPrimaryRepeatSnapshotAttempts=${jailDiagnostics.causeDiagPrimaryRepeatSnapshotAttempts}`,
      `causeDiagPrimaryRepeatSnapshotSuccess=${jailDiagnostics.causeDiagPrimaryRepeatSnapshotSuccess}`,
      `causeDiagPrimaryRepeatSnapshotStale=${jailDiagnostics.causeDiagPrimaryRepeatSnapshotStale}`,
      `causeDiagPrimaryNoHistoryAttempts=${jailDiagnostics.causeDiagPrimaryNoHistoryAttempts}`,
      `causeDiagPrimaryNoHistorySuccess=${jailDiagnostics.causeDiagPrimaryNoHistorySuccess}`,
      `causeDiagPrimaryNoHistoryStale=${jailDiagnostics.causeDiagPrimaryNoHistoryStale}`,
      `causeDiagPrimaryNotInJailCount=${jailDiagnostics.causeDiagPrimaryNotInJailCount}`,
      `causeDiagPrimaryNotFoundCount=${jailDiagnostics.causeDiagPrimaryNotFoundCount}`,
      `causeDiagPrimaryDeadCount=${jailDiagnostics.causeDiagPrimaryDeadCount}`,
      `causeDiagPrimaryOtherStaleCount=${jailDiagnostics.causeDiagPrimaryOtherStaleCount}`,
      `causeDiagPrimaryOtherErrorCount=${jailDiagnostics.causeDiagPrimaryOtherErrorCount}`,
      `causeDiagPrimaryCaughtCount=${jailDiagnostics.causeDiagPrimaryCaughtCount}`,
      `causeDiagPrimaryRateLimitCount=${jailDiagnostics.causeDiagPrimaryRateLimitCount}`,
      `causeDiagPrimarySuccessCount=${jailDiagnostics.causeDiagPrimarySuccessCount}`,
      `causeDiagSecondaryAttempts=${jailDiagnostics.causeDiagSecondaryAttempts}`,
      `causeDiagSecondarySuccess=${jailDiagnostics.causeDiagSecondarySuccess}`,
      `causeDiagSecondaryStale=${jailDiagnostics.causeDiagSecondaryStale}`,
      `causeDiagSecondaryReportedSecondsTotal=${jailDiagnostics.causeDiagSecondaryReportedSecondsTotal}`,
      `causeDiagSecondaryReportedSecondsSamples=${jailDiagnostics.causeDiagSecondaryReportedSecondsSamples}`,
      `causeDiagSecondaryFirstSeenAgeTotalMs=${jailDiagnostics.causeDiagSecondaryFirstSeenAgeTotalMs}`,
      `causeDiagSecondaryFirstSeenAgeSamples=${jailDiagnostics.causeDiagSecondaryFirstSeenAgeSamples}`,
      `causeDiagSecondaryS0to5Attempts=${jailDiagnostics.causeDiagSecondaryS0to5Attempts}`,
      `causeDiagSecondaryS0to5Success=${jailDiagnostics.causeDiagSecondaryS0to5Success}`,
      `causeDiagSecondaryS0to5Stale=${jailDiagnostics.causeDiagSecondaryS0to5Stale}`,
      `causeDiagSecondaryS6to15Attempts=${jailDiagnostics.causeDiagSecondaryS6to15Attempts}`,
      `causeDiagSecondaryS6to15Success=${jailDiagnostics.causeDiagSecondaryS6to15Success}`,
      `causeDiagSecondaryS6to15Stale=${jailDiagnostics.causeDiagSecondaryS6to15Stale}`,
      `causeDiagSecondaryS16to45Attempts=${jailDiagnostics.causeDiagSecondaryS16to45Attempts}`,
      `causeDiagSecondaryS16to45Success=${jailDiagnostics.causeDiagSecondaryS16to45Success}`,
      `causeDiagSecondaryS16to45Stale=${jailDiagnostics.causeDiagSecondaryS16to45Stale}`,
      `causeDiagSecondaryS46to120Attempts=${jailDiagnostics.causeDiagSecondaryS46to120Attempts}`,
      `causeDiagSecondaryS46to120Success=${jailDiagnostics.causeDiagSecondaryS46to120Success}`,
      `causeDiagSecondaryS46to120Stale=${jailDiagnostics.causeDiagSecondaryS46to120Stale}`,
      `causeDiagSecondaryS121plusAttempts=${jailDiagnostics.causeDiagSecondaryS121plusAttempts}`,
      `causeDiagSecondaryS121plusSuccess=${jailDiagnostics.causeDiagSecondaryS121plusSuccess}`,
      `causeDiagSecondaryS121plusStale=${jailDiagnostics.causeDiagSecondaryS121plusStale}`,
      `causeDiagSecondarySUnknownAttempts=${jailDiagnostics.causeDiagSecondarySUnknownAttempts}`,
      `causeDiagSecondarySUnknownSuccess=${jailDiagnostics.causeDiagSecondarySUnknownSuccess}`,
      `causeDiagSecondarySUnknownStale=${jailDiagnostics.causeDiagSecondarySUnknownStale}`,
      `causeDiagSecondaryFirstSnapshotAttempts=${jailDiagnostics.causeDiagSecondaryFirstSnapshotAttempts}`,
      `causeDiagSecondaryFirstSnapshotSuccess=${jailDiagnostics.causeDiagSecondaryFirstSnapshotSuccess}`,
      `causeDiagSecondaryFirstSnapshotStale=${jailDiagnostics.causeDiagSecondaryFirstSnapshotStale}`,
      `causeDiagSecondaryRepeatSnapshotAttempts=${jailDiagnostics.causeDiagSecondaryRepeatSnapshotAttempts}`,
      `causeDiagSecondaryRepeatSnapshotSuccess=${jailDiagnostics.causeDiagSecondaryRepeatSnapshotSuccess}`,
      `causeDiagSecondaryRepeatSnapshotStale=${jailDiagnostics.causeDiagSecondaryRepeatSnapshotStale}`,
      `causeDiagSecondaryNoHistoryAttempts=${jailDiagnostics.causeDiagSecondaryNoHistoryAttempts}`,
      `causeDiagSecondaryNoHistorySuccess=${jailDiagnostics.causeDiagSecondaryNoHistorySuccess}`,
      `causeDiagSecondaryNoHistoryStale=${jailDiagnostics.causeDiagSecondaryNoHistoryStale}`,
      `causeDiagSecondaryNotInJailCount=${jailDiagnostics.causeDiagSecondaryNotInJailCount}`,
      `causeDiagSecondaryNotFoundCount=${jailDiagnostics.causeDiagSecondaryNotFoundCount}`,
      `causeDiagSecondaryDeadCount=${jailDiagnostics.causeDiagSecondaryDeadCount}`,
      `causeDiagSecondaryOtherStaleCount=${jailDiagnostics.causeDiagSecondaryOtherStaleCount}`,
      `causeDiagSecondaryOtherErrorCount=${jailDiagnostics.causeDiagSecondaryOtherErrorCount}`,
      `causeDiagSecondaryCaughtCount=${jailDiagnostics.causeDiagSecondaryCaughtCount}`,
      `causeDiagSecondaryRateLimitCount=${jailDiagnostics.causeDiagSecondaryRateLimitCount}`,
      `causeDiagSecondarySuccessCount=${jailDiagnostics.causeDiagSecondarySuccessCount}`,
      `causeDiagBothAttempts=${jailDiagnostics.causeDiagBothAttempts}`,
      `causeDiagBothSuccess=${jailDiagnostics.causeDiagBothSuccess}`,
      `causeDiagBothStale=${jailDiagnostics.causeDiagBothStale}`,
      `causeDiagBothReportedSecondsTotal=${jailDiagnostics.causeDiagBothReportedSecondsTotal}`,
      `causeDiagBothReportedSecondsSamples=${jailDiagnostics.causeDiagBothReportedSecondsSamples}`,
      `causeDiagBothFirstSeenAgeTotalMs=${jailDiagnostics.causeDiagBothFirstSeenAgeTotalMs}`,
      `causeDiagBothFirstSeenAgeSamples=${jailDiagnostics.causeDiagBothFirstSeenAgeSamples}`,
      `causeDiagBothS0to5Attempts=${jailDiagnostics.causeDiagBothS0to5Attempts}`,
      `causeDiagBothS0to5Success=${jailDiagnostics.causeDiagBothS0to5Success}`,
      `causeDiagBothS0to5Stale=${jailDiagnostics.causeDiagBothS0to5Stale}`,
      `causeDiagBothS6to15Attempts=${jailDiagnostics.causeDiagBothS6to15Attempts}`,
      `causeDiagBothS6to15Success=${jailDiagnostics.causeDiagBothS6to15Success}`,
      `causeDiagBothS6to15Stale=${jailDiagnostics.causeDiagBothS6to15Stale}`,
      `causeDiagBothS16to45Attempts=${jailDiagnostics.causeDiagBothS16to45Attempts}`,
      `causeDiagBothS16to45Success=${jailDiagnostics.causeDiagBothS16to45Success}`,
      `causeDiagBothS16to45Stale=${jailDiagnostics.causeDiagBothS16to45Stale}`,
      `causeDiagBothS46to120Attempts=${jailDiagnostics.causeDiagBothS46to120Attempts}`,
      `causeDiagBothS46to120Success=${jailDiagnostics.causeDiagBothS46to120Success}`,
      `causeDiagBothS46to120Stale=${jailDiagnostics.causeDiagBothS46to120Stale}`,
      `causeDiagBothS121plusAttempts=${jailDiagnostics.causeDiagBothS121plusAttempts}`,
      `causeDiagBothS121plusSuccess=${jailDiagnostics.causeDiagBothS121plusSuccess}`,
      `causeDiagBothS121plusStale=${jailDiagnostics.causeDiagBothS121plusStale}`,
      `causeDiagBothSUnknownAttempts=${jailDiagnostics.causeDiagBothSUnknownAttempts}`,
      `causeDiagBothSUnknownSuccess=${jailDiagnostics.causeDiagBothSUnknownSuccess}`,
      `causeDiagBothSUnknownStale=${jailDiagnostics.causeDiagBothSUnknownStale}`,
      `causeDiagBothFirstSnapshotAttempts=${jailDiagnostics.causeDiagBothFirstSnapshotAttempts}`,
      `causeDiagBothFirstSnapshotSuccess=${jailDiagnostics.causeDiagBothFirstSnapshotSuccess}`,
      `causeDiagBothFirstSnapshotStale=${jailDiagnostics.causeDiagBothFirstSnapshotStale}`,
      `causeDiagBothRepeatSnapshotAttempts=${jailDiagnostics.causeDiagBothRepeatSnapshotAttempts}`,
      `causeDiagBothRepeatSnapshotSuccess=${jailDiagnostics.causeDiagBothRepeatSnapshotSuccess}`,
      `causeDiagBothRepeatSnapshotStale=${jailDiagnostics.causeDiagBothRepeatSnapshotStale}`,
      `causeDiagBothNoHistoryAttempts=${jailDiagnostics.causeDiagBothNoHistoryAttempts}`,
      `causeDiagBothNoHistorySuccess=${jailDiagnostics.causeDiagBothNoHistorySuccess}`,
      `causeDiagBothNoHistoryStale=${jailDiagnostics.causeDiagBothNoHistoryStale}`,
      `causeDiagBothNotInJailCount=${jailDiagnostics.causeDiagBothNotInJailCount}`,
      `causeDiagBothNotFoundCount=${jailDiagnostics.causeDiagBothNotFoundCount}`,
      `causeDiagBothDeadCount=${jailDiagnostics.causeDiagBothDeadCount}`,
      `causeDiagBothOtherStaleCount=${jailDiagnostics.causeDiagBothOtherStaleCount}`,
      `causeDiagBothOtherErrorCount=${jailDiagnostics.causeDiagBothOtherErrorCount}`,
      `causeDiagBothCaughtCount=${jailDiagnostics.causeDiagBothCaughtCount}`,
      `causeDiagBothRateLimitCount=${jailDiagnostics.causeDiagBothRateLimitCount}`,
      `causeDiagBothSuccessCount=${jailDiagnostics.causeDiagBothSuccessCount}`,
      `causeDiagUnknownAttempts=${jailDiagnostics.causeDiagUnknownAttempts}`,
      `causeDiagUnknownSuccess=${jailDiagnostics.causeDiagUnknownSuccess}`,
      `causeDiagUnknownStale=${jailDiagnostics.causeDiagUnknownStale}`,
      `causeDiagUnknownReportedSecondsTotal=${jailDiagnostics.causeDiagUnknownReportedSecondsTotal}`,
      `causeDiagUnknownReportedSecondsSamples=${jailDiagnostics.causeDiagUnknownReportedSecondsSamples}`,
      `causeDiagUnknownFirstSeenAgeTotalMs=${jailDiagnostics.causeDiagUnknownFirstSeenAgeTotalMs}`,
      `causeDiagUnknownFirstSeenAgeSamples=${jailDiagnostics.causeDiagUnknownFirstSeenAgeSamples}`,
      `causeDiagUnknownS0to5Attempts=${jailDiagnostics.causeDiagUnknownS0to5Attempts}`,
      `causeDiagUnknownS0to5Success=${jailDiagnostics.causeDiagUnknownS0to5Success}`,
      `causeDiagUnknownS0to5Stale=${jailDiagnostics.causeDiagUnknownS0to5Stale}`,
      `causeDiagUnknownS6to15Attempts=${jailDiagnostics.causeDiagUnknownS6to15Attempts}`,
      `causeDiagUnknownS6to15Success=${jailDiagnostics.causeDiagUnknownS6to15Success}`,
      `causeDiagUnknownS6to15Stale=${jailDiagnostics.causeDiagUnknownS6to15Stale}`,
      `causeDiagUnknownS16to45Attempts=${jailDiagnostics.causeDiagUnknownS16to45Attempts}`,
      `causeDiagUnknownS16to45Success=${jailDiagnostics.causeDiagUnknownS16to45Success}`,
      `causeDiagUnknownS16to45Stale=${jailDiagnostics.causeDiagUnknownS16to45Stale}`,
      `causeDiagUnknownS46to120Attempts=${jailDiagnostics.causeDiagUnknownS46to120Attempts}`,
      `causeDiagUnknownS46to120Success=${jailDiagnostics.causeDiagUnknownS46to120Success}`,
      `causeDiagUnknownS46to120Stale=${jailDiagnostics.causeDiagUnknownS46to120Stale}`,
      `causeDiagUnknownS121plusAttempts=${jailDiagnostics.causeDiagUnknownS121plusAttempts}`,
      `causeDiagUnknownS121plusSuccess=${jailDiagnostics.causeDiagUnknownS121plusSuccess}`,
      `causeDiagUnknownS121plusStale=${jailDiagnostics.causeDiagUnknownS121plusStale}`,
      `causeDiagUnknownSUnknownAttempts=${jailDiagnostics.causeDiagUnknownSUnknownAttempts}`,
      `causeDiagUnknownSUnknownSuccess=${jailDiagnostics.causeDiagUnknownSUnknownSuccess}`,
      `causeDiagUnknownSUnknownStale=${jailDiagnostics.causeDiagUnknownSUnknownStale}`,
      `causeDiagUnknownFirstSnapshotAttempts=${jailDiagnostics.causeDiagUnknownFirstSnapshotAttempts}`,
      `causeDiagUnknownFirstSnapshotSuccess=${jailDiagnostics.causeDiagUnknownFirstSnapshotSuccess}`,
      `causeDiagUnknownFirstSnapshotStale=${jailDiagnostics.causeDiagUnknownFirstSnapshotStale}`,
      `causeDiagUnknownRepeatSnapshotAttempts=${jailDiagnostics.causeDiagUnknownRepeatSnapshotAttempts}`,
      `causeDiagUnknownRepeatSnapshotSuccess=${jailDiagnostics.causeDiagUnknownRepeatSnapshotSuccess}`,
      `causeDiagUnknownRepeatSnapshotStale=${jailDiagnostics.causeDiagUnknownRepeatSnapshotStale}`,
      `causeDiagUnknownNoHistoryAttempts=${jailDiagnostics.causeDiagUnknownNoHistoryAttempts}`,
      `causeDiagUnknownNoHistorySuccess=${jailDiagnostics.causeDiagUnknownNoHistorySuccess}`,
      `causeDiagUnknownNoHistoryStale=${jailDiagnostics.causeDiagUnknownNoHistoryStale}`,
      `causeDiagUnknownNotInJailCount=${jailDiagnostics.causeDiagUnknownNotInJailCount}`,
      `causeDiagUnknownNotFoundCount=${jailDiagnostics.causeDiagUnknownNotFoundCount}`,
      `causeDiagUnknownDeadCount=${jailDiagnostics.causeDiagUnknownDeadCount}`,
      `causeDiagUnknownOtherStaleCount=${jailDiagnostics.causeDiagUnknownOtherStaleCount}`,
      `causeDiagUnknownOtherErrorCount=${jailDiagnostics.causeDiagUnknownOtherErrorCount}`,
      `causeDiagUnknownCaughtCount=${jailDiagnostics.causeDiagUnknownCaughtCount}`,
      `causeDiagUnknownRateLimitCount=${jailDiagnostics.causeDiagUnknownRateLimitCount}`,
      `causeDiagUnknownSuccessCount=${jailDiagnostics.causeDiagUnknownSuccessCount}`,
      `causeDiagHistoryMissing=${jailDiagnostics.causeDiagHistoryMissing}`,
      `causeDiagMetricsErrors=${jailDiagnostics.causeDiagMetricsErrors}`,
      'pollDiagNote=GET /api/jail can be cached 2s; observed first is not jail-entry time; comparisons are passive and require a recent SSE snapshot',
      `pollDiagLastReadAgoMs=${jailPollCompare.poll.receivedAt ? now-jailPollCompare.poll.receivedAt : -1}`,
      `pollDiagLastPrimarySnapshotAgoMs=${jailPollCompare.primary.receivedAt ? now-jailPollCompare.primary.receivedAt : -1}`,
      `pollDiagLastSecondarySnapshotAgoMs=${jailPollCompare.secondary.receivedAt ? now-jailPollCompare.secondary.receivedAt : -1}`,
      `pollDiagReads=${jailDiagnostics.pollDiagReads}`,
      `pollDiagRealTargetsTotal=${jailDiagnostics.pollDiagRealTargetsTotal}`,
      `pollDiagPrimaryComparableReads=${jailDiagnostics.pollDiagPrimaryComparableReads}`,
      `pollDiagPrimaryNonComparableReads=${jailDiagnostics.pollDiagPrimaryNonComparableReads}`,
      `pollDiagPrimaryBothTargets=${jailDiagnostics.pollDiagPrimaryBothTargets}`,
      `pollDiagPrimaryPollOnlyTargets=${jailDiagnostics.pollDiagPrimaryPollOnlyTargets}`,
      `pollDiagPrimaryStreamOnlyTargets=${jailDiagnostics.pollDiagPrimaryStreamOnlyTargets}`,
      `pollDiagSecondaryComparableReads=${jailDiagnostics.pollDiagSecondaryComparableReads}`,
      `pollDiagSecondaryNonComparableReads=${jailDiagnostics.pollDiagSecondaryNonComparableReads}`,
      `pollDiagSecondaryBothTargets=${jailDiagnostics.pollDiagSecondaryBothTargets}`,
      `pollDiagSecondaryPollOnlyTargets=${jailDiagnostics.pollDiagSecondaryPollOnlyTargets}`,
      `pollDiagSecondaryStreamOnlyTargets=${jailDiagnostics.pollDiagSecondaryStreamOnlyTargets}`,
      `pollDiagPollBeforePrimary=${jailDiagnostics.pollDiagPollBeforePrimary}`,
      `pollDiagPrimaryBeforePoll=${jailDiagnostics.pollDiagPrimaryBeforePoll}`,
      `pollDiagPollPrimaryTies=${jailDiagnostics.pollDiagPollPrimaryTies}`,
      `pollDiagPollBeforePrimaryLagTotalMs=${jailDiagnostics.pollDiagPollBeforePrimaryLagTotalMs}`,
      `pollDiagPrimaryBeforePollLagTotalMs=${jailDiagnostics.pollDiagPrimaryBeforePollLagTotalMs}`,
      `pollDiagPollBeforeSecondary=${jailDiagnostics.pollDiagPollBeforeSecondary}`,
      `pollDiagSecondaryBeforePoll=${jailDiagnostics.pollDiagSecondaryBeforePoll}`,
      `pollDiagPollSecondaryTies=${jailDiagnostics.pollDiagPollSecondaryTies}`,
      `pollDiagPollBeforeSecondaryLagTotalMs=${jailDiagnostics.pollDiagPollBeforeSecondaryLagTotalMs}`,
      `pollDiagSecondaryBeforePollLagTotalMs=${jailDiagnostics.pollDiagSecondaryBeforePollLagTotalMs}`,
      `pollDiagMetricsErrors=${jailDiagnostics.pollDiagMetricsErrors}`,
      `pollDiagPrimaryPollPresentAttempts=${jailDiagnostics.pollDiagPrimaryPollPresentAttempts}`,
      `pollDiagPrimaryPollPresentSuccess=${jailDiagnostics.pollDiagPrimaryPollPresentSuccess}`,
      `pollDiagPrimaryPollPresentStale=${jailDiagnostics.pollDiagPrimaryPollPresentStale}`,
      `pollDiagPrimaryPollAbsentAttempts=${jailDiagnostics.pollDiagPrimaryPollAbsentAttempts}`,
      `pollDiagPrimaryPollAbsentSuccess=${jailDiagnostics.pollDiagPrimaryPollAbsentSuccess}`,
      `pollDiagPrimaryPollAbsentStale=${jailDiagnostics.pollDiagPrimaryPollAbsentStale}`,
      `pollDiagPrimaryNoRecentPollAttempts=${jailDiagnostics.pollDiagPrimaryNoRecentPollAttempts}`,
      `pollDiagPrimaryNoRecentPollSuccess=${jailDiagnostics.pollDiagPrimaryNoRecentPollSuccess}`,
      `pollDiagPrimaryNoRecentPollStale=${jailDiagnostics.pollDiagPrimaryNoRecentPollStale}`,
      `pollDiagSecondaryPollPresentAttempts=${jailDiagnostics.pollDiagSecondaryPollPresentAttempts}`,
      `pollDiagSecondaryPollPresentSuccess=${jailDiagnostics.pollDiagSecondaryPollPresentSuccess}`,
      `pollDiagSecondaryPollPresentStale=${jailDiagnostics.pollDiagSecondaryPollPresentStale}`,
      `pollDiagSecondaryPollAbsentAttempts=${jailDiagnostics.pollDiagSecondaryPollAbsentAttempts}`,
      `pollDiagSecondaryPollAbsentSuccess=${jailDiagnostics.pollDiagSecondaryPollAbsentSuccess}`,
      `pollDiagSecondaryPollAbsentStale=${jailDiagnostics.pollDiagSecondaryPollAbsentStale}`,
      `pollDiagSecondaryNoRecentPollAttempts=${jailDiagnostics.pollDiagSecondaryNoRecentPollAttempts}`,
      `pollDiagSecondaryNoRecentPollSuccess=${jailDiagnostics.pollDiagSecondaryNoRecentPollSuccess}`,
      `pollDiagSecondaryNoRecentPollStale=${jailDiagnostics.pollDiagSecondaryNoRecentPollStale}`,
      `pollDiagBothPollPresentAttempts=${jailDiagnostics.pollDiagBothPollPresentAttempts}`,
      `pollDiagBothPollPresentSuccess=${jailDiagnostics.pollDiagBothPollPresentSuccess}`,
      `pollDiagBothPollPresentStale=${jailDiagnostics.pollDiagBothPollPresentStale}`,
      `pollDiagBothPollAbsentAttempts=${jailDiagnostics.pollDiagBothPollAbsentAttempts}`,
      `pollDiagBothPollAbsentSuccess=${jailDiagnostics.pollDiagBothPollAbsentSuccess}`,
      `pollDiagBothPollAbsentStale=${jailDiagnostics.pollDiagBothPollAbsentStale}`,
      `pollDiagBothNoRecentPollAttempts=${jailDiagnostics.pollDiagBothNoRecentPollAttempts}`,
      `pollDiagBothNoRecentPollSuccess=${jailDiagnostics.pollDiagBothNoRecentPollSuccess}`,
      `pollDiagBothNoRecentPollStale=${jailDiagnostics.pollDiagBothNoRecentPollStale}`,
      `pollDiagPollBeforePrimaryAvgLeadMs=${averageDiagnostic(jailDiagnostics.pollDiagPollBeforePrimaryLagTotalMs,jailDiagnostics.pollDiagPollBeforePrimary)}`,
      `pollDiagPrimaryBeforePollAvgLeadMs=${averageDiagnostic(jailDiagnostics.pollDiagPrimaryBeforePollLagTotalMs,jailDiagnostics.pollDiagPrimaryBeforePoll)}`,
      `pollDiagPollBeforeSecondaryAvgLeadMs=${averageDiagnostic(jailDiagnostics.pollDiagPollBeforeSecondaryLagTotalMs,jailDiagnostics.pollDiagPollBeforeSecondary)}`,
      `pollDiagSecondaryBeforePollAvgLeadMs=${averageDiagnostic(jailDiagnostics.pollDiagSecondaryBeforePollLagTotalMs,jailDiagnostics.pollDiagSecondaryBeforePoll)}`,
      'causeTraceFormat=stream,trigger,secondsBucket,seenCategory,previousSnapshotCount,firstSeenAgeMs,rejectCategory,outcome',
      ...jailDiagnostics.attemptTrace.slice(-40).map((row) => {
        const c = row.cause || {};
        return `causeTrace=${c.stream || 'Unknown'},${row.independent?.trigger || 'other'},${c.secondsBucket || 'SUnknown'},${c.seenCategory || 'NoHistory'},${Number(c.seenCount) || 0},${Number.isFinite(c.firstSeenAge) ? Math.round(c.firstSeenAge) : -1},${c.reason || 'pending'},${row.outcome}`;
      }),
      'diagTraceFormat=selectedStream,trigger,otherRemovedBeforeAttempt,otherRemovedAgoMs,primarySnapshotAgoMs,secondarySnapshotAgoMs,primaryBroadcastAgeMs,secondaryBroadcastAgeMs,primarySeq,secondarySeq,outcome',
      ...jailDiagnostics.attemptTrace.slice(-40).map((row) => {
        const d = row.independent || {};
        return `diagTrace=${d.selectedStream || 'unknown'},${d.trigger || 'unknown'},${d.crossRemoved || 'unknown'},${Number.isFinite(d.oppositeRemovedAgoMs) ? Math.round(d.oppositeRemovedAgoMs) : -1},${Number.isFinite(d.primarySnapshotAgoMs) ? Math.round(d.primarySnapshotAgoMs) : -1},${Number.isFinite(d.secondarySnapshotAgoMs) ? Math.round(d.secondarySnapshotAgoMs) : -1},${Number.isFinite(d.primaryBroadcastAgeMs) ? Math.round(d.primaryBroadcastAgeMs) : -1},${Number.isFinite(d.secondaryBroadcastAgeMs) ? Math.round(d.secondaryBroadcastAgeMs) : -1},${d.primarySeq ?? -1},${d.secondarySeq ?? -1},${row.outcome}`;
      }),
      'traceFormat=seq,gapMs,ageMs,cadence,source,firstStream,leadMs,hidden,eventToDispatchMs,candidates,fresh,outcome,roundTripMs',
      ...jailDiagnostics.attemptTrace.slice(-40).map((row) =>
        `trace=${row.seq},${Math.round(row.gapMs)},${Math.round(row.ageMs)},${row.cadence},${row.source},${row.firstStream || 'unknown'},${Number.isFinite(Number(row.leadMs)) ? Math.round(Number(row.leadMs)) : -1},${row.hidden},${Math.round(row.eventToDispatchMs)},${row.candidates},${row.fresh},${row.outcome},${Math.round(row.networkMs)}`
      ),
    ].join('\n');
  }

  function loadLogs() {
    const raw = GM_getValue(KEYS.logs, []);
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, LOG_HISTORY_LIMIT).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const at = Number(item.at);
      const text = String(item.text || '').slice(0, 1_000);
      const kind = ['info', 'ok', 'warn', 'error'].includes(String(item.kind || '')) ? String(item.kind) : 'info';
      if (!Number.isFinite(at) || at <= 0 || !text) return [];
      return [{ at, text, kind }];
    });
  }

  function loadSecondaryJailState() {
    const raw = GM_getValue(KEYS.secondaryJail, {});
    const value = raw && typeof raw === 'object' ? raw : {};
    const token = String(value.token || '').trim();
    const userId = String(value.userId || '').trim();
    const now = Date.now();
    const attemptTimes = (Array.isArray(value.loginAttemptTimes) ? value.loginAttemptTimes : [])
      .map((entry) => Number(entry) || 0)
      .filter((at) => at > 0 && now - at < SECONDARY_LOGIN_WINDOW_MS)
      .slice(-SECONDARY_LOGIN_LIMIT);
    const backoffMs = Number(value.loginBackoffMs);
    const backoffUntil = Number(value.loginBackoffUntil);
    const tokenCreatedAt = Number(value.tokenCreatedAt);
    return {
      enabled: value.enabled === true,
      token: token.length >= 8 && token.length <= 512 ? token : '',
      userId: userId.length >= 1 && userId.length <= 128 ? userId : '',
      tokenCreatedAt: Number.isFinite(tokenCreatedAt) && tokenCreatedAt > 0 ? tokenCreatedAt : 0,
      loginAttemptTimes: attemptTimes,
      loginBackoffUntil: Number.isFinite(backoffUntil) && backoffUntil > now ? backoffUntil : 0,
      loginBackoffMs: Number.isFinite(backoffMs)
        ? Math.min(SECONDARY_LOGIN_BACKOFF_MAX_MS, Math.max(SECONDARY_LOGIN_BACKOFF_BASE_MS, backoffMs))
        : SECONDARY_LOGIN_BACKOFF_BASE_MS,
    };
  }

  function persistSecondaryJailState() {
    pruneSecondaryLoginAttempts();
    GM_setValue(KEYS.secondaryJail, {
      enabled: jailSecondaryEnabled === true,
      token: jailSecondaryEnabled ? String(jailSecondaryToken || '') : '',
      userId: jailSecondaryEnabled ? String(jailSecondaryUserId || '') : '',
      tokenCreatedAt: jailSecondaryEnabled ? Number(jailSecondaryTokenCreatedAt) || 0 : 0,
      loginAttemptTimes: jailSecondaryLoginAttemptTimes.slice(-SECONDARY_LOGIN_LIMIT),
      loginBackoffUntil: Number(jailSecondaryLoginBackoffUntil) || 0,
      loginBackoffMs: Number(jailSecondaryLoginBackoffMs) || SECONDARY_LOGIN_BACKOFF_BASE_MS,
    });
  }

  function restoreJailDiagnosticsFromStorage(target) {
    const raw = GM_getValue(KEYS.jailDiagnostics, {});
    if (!raw || typeof raw !== 'object') return;
    let restored = false;
    for (const key of Object.keys(target)) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      if (key === 'routingTrace') {
        if (Array.isArray(raw.routingTrace)) {
          target.routingTrace = raw.routingTrace.slice(-48).filter((r) => r && Number.isFinite(Number(r.at)) && /^[a-z0-9_-]{1,48}$/i.test(String(r.event || ''))).map((r) => ({at:Number(r.at), event:String(r.event), detail:String(r.detail || '').replace(/[^a-z0-9_-]/gi, '').slice(0,56)}));
          restored = true;
        }
        continue;
      }
      if (key === 'attemptTrace') {
        if (Array.isArray(raw.attemptTrace)) {
          target.attemptTrace = raw.attemptTrace.slice(-80).filter((row) => row && typeof row === 'object');
          restored = true;
        }
        continue;
      }
      if (typeof target[key] === 'number') {
        const value = Number(raw[key]);
        if (Number.isFinite(value) && value >= 0) {
          target[key] = value;
          restored = true;
        }
      } else if (typeof target[key] === 'string') {
        target[key] = String(raw[key] || '').slice(0, 250);
        restored = true;
      }
    }
    // Do not bridge the first post-reload SSE gap to the previous page lifetime.
    target.lastInmateServerAtMs = 0;
    if (restored) target.runtimeReloadRestores = (Number(target.runtimeReloadRestores) || 0) + 1;
  }

  function serialisableJailDiagnostics() {
    const out = {};
    for (const [key, value] of Object.entries(jailDiagnostics)) {
      if (key === 'routingTrace') out.routingTrace = Array.isArray(value) ? value.slice(-48) : [];
      else if (key === 'attemptTrace') out.attemptTrace = Array.isArray(value) ? value.slice(-80) : [];
      else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      else if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  function persistReloadState() {
    if (runtimePersistTimer) {
      clearTimeout(runtimePersistTimer);
      runtimePersistTimer = null;
    }
    try { GM_setValue(KEYS.logs, state.logs.slice(0, LOG_HISTORY_LIMIT)); } catch {}
    try { GM_setValue(KEYS.jailDiagnostics, serialisableJailDiagnostics()); } catch {}
    // Secondary session state is persisted only at the exact mutation sites.
    // Never rewrite it from pagehide/log persistence: another tab may hold an
    // older in-memory token and resurrect or overwrite the current session.
    try { GM_setValue(KEYS.collapsed, state.collapsed === true); } catch {}
    try { GM_setValue(KEYS.uiTab, validTab(state.uiTab)); } catch {}
    try { GM_setValue(KEYS.botTab, state.botTab === true); } catch {}
  }

  function scheduleRuntimePersist(delay = 5_000) {
    if (runtimePersistTimer) return;
    runtimePersistTimer = setTimeout(() => {
      runtimePersistTimer = null;
      persistReloadState();
    }, Math.max(500, Number(delay) || 5_000));
  }

  function renderLogs(){
    const h=document.querySelector('#ul-simple-bot');if(!h)return;
    const diag=h.querySelector('#ul-simple-jail-diag-wrap');
    const fastJail=hasFeature(LICENCE_FEATURE.FAST_JAIL_STREAM);
    if(diag)diag.hidden=!fastJail;
    const secondaryButton=h.querySelector('#ul-simple-jail-secondary-toggle');
    const secondaryStatus=h.querySelector('#ul-simple-jail-secondary-status');
    if(secondaryButton){
      secondaryButton.textContent=jailSecondaryEnabled?'Stop secondary jail stream':'Start secondary jail stream';
      secondaryButton.disabled=!fastJail || (!jailSecondaryEnabled && (!state.login.email || !state.login.password));
    }
    if(secondaryStatus){
      secondaryStatus.textContent=jailSecondaryEnabled
        ? `Secondary stream ${jailSecondaryReady?'connected':'starting/reconnecting'} · persists across full page reloads`
        : (state.login.email && state.login.password
          ? 'Secondary stream off · optional owner-only test using one additional normal game session.'
          : 'Secondary stream off · save game login details first to test it.');
    }
    h.querySelector('#ul-simple-last').textContent=state.logs[0]?.text||'None yet';
    const box=h.querySelector('#ul-simple-logs');box.replaceChildren();
    for(const item of state.logs.slice(0,LOG_HISTORY_LIMIT)){const d=document.createElement('div');d.className=`ul-simple-log ${item.kind||''}`;d.textContent=`${new Date(item.at).toLocaleTimeString()} · ${item.text}`;box.appendChild(d);}
  }

  globalThis.__UL_JAIL_DIAGNOSTICS__ = () => formatJailDiagnostics();

  function log(text,kind='info'){state.logs.unshift({at:Date.now(),text:String(text),kind});state.logs=state.logs.slice(0,LOG_HISTORY_LIMIT);scheduleRuntimePersist();renderLogs();}
  function saveSettings(){
    // Any local automation-setting edit starts a new gameplay generation. This
    // makes a rapid feature OFF -> ON (or target/travel preference edit) unable
    // to revive an older async plan that was already waiting on a read/queue.
    state.automationEpoch += 1;
    GM_setValue(KEYS.settings,state.settings);
  }
  function saveQt(){GM_setValue(KEYS.quicktrade,state.qt)}
  function saveRestart(){GM_setValue(KEYS.restart,state.restart);renderRestart()}


  // Access and UI wording update: preserve explicit hybrid-rotation consent
  // from v2.2.35 and v2.2.36. Earlier versions require fresh consent.
  function defenceRotationConsentValid(value) {
    return value?.robotDefenceHybridConsent === true &&
      [SCRIPT_VERSION, '2.2.36', '2.2.35'].includes(value.robotDefenceHardeningConsent);
  }
  function loadSettings(){const r=GM_getValue(KEYS.settings,{});const v=r&&typeof r==='object'?r:{};return {...DEFAULT_SETTINGS,...v,drugRepairDamage:clampInt(v.drugRepairDamage,1,99,DEFAULT_SETTINGS.drugRepairDamage),beamTravelMode:['auto','car','airport'].includes(v.beamTravelMode)?v.beamTravelMode:'auto',autoGunId:clampInt(v.autoGunId,1,9,9),robotDefencePointReserve:clampInt(v.robotDefencePointReserve,0,2147483647,1400),robotDefenceAccount:typeof v.robotDefenceAccount==='string'?v.robotDefenceAccount.trim().slice(0,32):'',robotDefenceHardeningConsent:typeof v.robotDefenceHardeningConsent==='string'?v.robotDefenceHardeningConsent:'',robotDefenceHybridConsent:defenceRotationConsentValid(v),robotDefenceRotate:defenceRotationConsentValid(v)&&v.robotDefenceRotate===true}}
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
        if (!hasFastJail) {
          stopJailStream();
          void stopSecondaryJailStream({ logout: true });
        } else syncJailStream();
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
