// ==UserScript==
// @name         Underworld Legacy - Crimes & GTA
// @namespace    https://underworldlegacy.com/
// @version      1.8.5
// @description  API-first UL automation with crimes, GTA, jailbust, melting, drugs, Auto Rank, player searches, Kill and Beam.
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
  const ONLINE_DISCOVERY_MS = 2 * 60_000;
  const PLAYER_SEARCH_MIN_RENEW_LEAD_SECONDS = 30 * 60;
  const PLAYER_SEARCH_RENEW_SAFETY_SECONDS = 120;
  const SHOOT_WINDOW_MS = 10_000;
  const SHOOT_WINDOW_LIMIT = 49;
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
    minDelayMs: 150,
    maxDelayMs: 350,
  });

  const state = {
    settings: loadSettings(),
    botTab: sessionStorage.getItem(BOT_TAB_KEY) === 'true',
    uiTab: ['actions', 'cars', 'players', 'logs'].includes(sessionStorage.getItem(UI_TAB_KEY))
      ? sessionStorage.getItem(UI_TAB_KEY)
      : 'actions',
    controller: false,
    controllerLockRequested: false,
    releaseController: null,
    inJail: false,
    jailMarkedAt: 0,
    authRequired: false,
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
    playerSearchDueAt: 0,
    jailDueAt: 0,
    crimesRunning: false,
    gtaRunning: false,
    jailBustRunning: false,
    meltRunning: false,
    drugsRunning: false,
    autoRankRunning: false,
    playerDiscoveryRunning: false,
    playerSearchRunning: false,
    jailRunning: false,
    jailBustCandidate: null,
    drugContextLoaded: false,
    drugFavouriteCarId: null,
    drugStatus: 'Drugs not checked',
    autoRankActive: false,
    autoRankEndsAt: 0,
    autoRankStatus: 'Auto Rank not checked',
    playerNames: loadPlayerNames(),
    playerActions: loadPlayerActions(),
    viewerUsername: '',
    playerDiscoveryStatus: 'Player discovery disabled',
    playerSearchStatus: 'Player searching disabled',
    playerSearchBackoff: new Map(),
    killData: null,
    activeBodyguard: null,
    combatStatus: 'Kill and Beam idle',
    shootHistory: [],
    actionTail: Promise.resolve(),
    logs: [],
  };

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

  function sanitiseSettings(value) {
    const minimum = clampInteger(value.minDelayMs, 0, 10_000, DEFAULT_SETTINGS.minDelayMs);
    const maximum = clampInteger(value.maxDelayMs, 0, 10_000, DEFAULT_SETTINGS.maxDelayMs);
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
      minDelayMs: Math.min(minimum, maximum),
      maxDelayMs: Math.max(minimum, maximum),
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
    return added;
  }

  function saveSettings(patch) {
    const wasStoppedForDeath = state.stoppedForDeath;
    state.settings = sanitiseSettings({ ...state.settings, ...patch });
    GM_setValue(SETTINGS_KEY, state.settings);
    if (patch.enabled === true) {
      prepareRuntimeForStart(wasStoppedForDeath);
    }
    render();
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
      state.autoRankStatus = state.settings.autoRank ? 'Checking Auto Rank for this character' : 'Auto-renew disabled';
      state.drugStatus = state.settings.drugs ? 'Checking drug run for this character' : 'Drug run disabled';
      state.playerSearchStatus = state.settings.searchPlayers ? 'Checking searches for this character' : 'Player searching disabled';
      state.combatStatus = 'Kill and Beam idle';
      state.killData = null;
      state.activeBodyguard = null;
      state.shootHistory = [];
    }
    if (state.settings.drugs) state.drugContextLoaded = false;
    wakeAll();
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }

  function randomDelay() {
    const { minDelayMs, maxDelayMs } = state.settings;
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

  function wakeAll() {
    state.crimesDueAt = 0;
    state.gtaDueAt = 0;
    state.jailBustDueAt = 0;
    state.meltDueAt = 0;
    state.drugsDueAt = 0;
    state.autoRankDueAt = 0;
    state.playerDiscoveryDueAt = 0;
    state.playerSearchDueAt = 0;
    state.jailDueAt = 0;
  }

  function markJailed() {
    state.inJail = true;
    state.jailMarkedAt = Date.now();
    state.jailBustCandidate = null;
    state.jailDueAt = 0;
  }

  function stopAutomationForDeath() {
    state.stoppedForDeath = true;
    state.inJail = false;
    state.authRequired = false;
    state.settings = sanitiseSettings({ ...state.settings, enabled: false });
    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
    state.autoRankDueAt = 0;
    state.autoRankStatus = state.settings.autoRank
      ? 'Stopped after death · restart character, then press Restart bot'
      : 'Auto-renew disabled';
    state.drugContextLoaded = false;
    state.drugStatus = state.settings.drugs ? 'Stopped after death' : 'Drug run disabled';
    state.playerSearchStatus = state.settings.searchPlayers ? 'Stopped after death' : 'Player searching disabled';
    state.combatStatus = 'Stopped after death';
    state.killData = null;
    state.activeBodyguard = null;
    state.shootHistory = [];
    GM_setValue(DEATH_STOP_KEY, true);
    GM_setValue(SETTINGS_KEY, state.settings);
    log('Character is dead — automation stopped; saved modules will be rechecked after Restart bot', 'error');
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      response = await fetch(new URL(path, location.origin), {
        method: options.method || 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new ApiError(408, `Request timed out: ${path}`, {});
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { html: await response.text().catch(() => '') };

    if (!response.ok) {
      const message = cleanMessage(body.html || body.error || body.message) || `${response.status} ${response.statusText}`;
      throw new ApiError(response.status, message, body, clampInteger(response.headers.get('retry-after'), 0, 3600, 0));
    }
    state.authRequired = false;
    return body;
  }

  function actionAllowed() {
    return state.botTab && state.controller && state.settings.enabled && !state.stoppedForDeath;
  }

  async function queueAction(path, label, options = {}) {
    if (!actionAllowed()) throw new ActionCancelledError('Automation is stopped');
    if (state.inJail && options.allowInJail !== true) throw new ActionCancelledError('Player is in jail');

    // Delay non-crime actions before joining the mutation queue. This prevents
    // a delayed GTA/repair/melt request from holding up a newly ready crime.
    if (options.skipDelay !== true) {
      await sleep(randomDelay());
    }

    const execute = async () => {
      if (!actionAllowed()) {
        throw new ActionCancelledError('Automation is stopped');
      }
      if (state.inJail && options.allowInJail !== true) {
        throw new ActionCancelledError('Player is in jail');
      }

      state.currentAction = label;
      render();

      const result = await api(path, { method: 'POST', body: options.body });
      const message = cleanMessage(result.html) || label;
      log(message, result.success === false ? 'warn' : 'ok');
      if (result.success === false || /sent to (?:the )?jail/i.test(message)) {
        markJailed();
      }
      return result;
    };

    const queued = state.actionTail.then(execute, execute);
    state.actionTail = queued.catch(() => undefined);
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

  function nextCrimePollFromRoundedSeconds(seconds) {
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
    if (parsed <= 1) return Date.now() + 100;
    return Date.now() + (parsed - 1) * 1000 + 100;
  }

  async function runCrimes() {
    state.crimesRunning = true;
    state.currentAction = 'Checking crimes';
    render();
    try {
      const data = await api('/api/crimes');
      const crimes = Array.isArray(data.crimes) ? data.crimes : [];
      const nextTimes = [];
      let rankedUp = false;

      for (const crime of crimes) {
        if (crime.locked) continue;
        if (!crime.available) {
          nextTimes.push(nextCrimePollFromRoundedSeconds(crime.secondsRemaining));
          continue;
        }

        try {
          const result = await queueAction(
            `/api/crimes/${encodeURIComponent(crime.id)}/commit`,
            `Committing ${crime.name}`,
            { skipDelay: true },
          );
          nextTimes.push(nextCrimeTimeFromCooldown(result.cooldownSeconds));
          rankedUp = rankedUp || result.rankedUp === true;
          if (result.success === false || state.inJail) break;
        } catch (error) {
          if (error instanceof ActionCancelledError) break;
          throw error;
        }
      }

      state.crimesDueAt = rankedUp
        ? Date.now() + 50
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
      const data = await api('/api/gta');
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
      const overview = await api('/api/melt?page=1');
      if (overview.autoRank && overview.autoRank.committingMelt === true) {
        state.meltDueAt = Date.now() + 5_000;
        return;
      }
      if (!overview.available) {
        state.meltDueAt = nextTimeFromSeconds(overview.secondsRemaining, 5);
        return;
      }

      const groups = Array.isArray(overview.groups) ? overview.groups : [];
      const eligibleGroups = groups.filter((group) => Number(group.count) > 0 && canMeltCar(group));
      if (eligibleGroups.length === 0) {
        state.meltDueAt = Date.now() + 30_000;
        return;
      }

      const eligibleNames = new Set(eligibleGroups.map((group) => group.name));
      let car = (Array.isArray(overview.cars) ? overview.cars : [])
        .find((candidate) => eligibleNames.has(candidate.name) && canMeltCar(candidate));

      if (!car) {
        for (const eligibleGroup of eligibleGroups) {
          const filtered = await api(`/api/melt?page=1&filter=${encodeURIComponent(eligibleGroup.name)}`);
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
        );
      }

      const result = await queueAction(
        `/api/melt/cars/${encodeURIComponent(String(publicId))}/melt`,
        `Melting ${car.displayName || car.name}`,
      );
      state.meltDueAt = nextTimeFromSeconds(result.cooldownSeconds, 5);
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
    );
    state.drugsDueAt = Date.now() + 50;
    return true;
  }

  async function runDrugs() {
    state.drugsRunning = true;
    state.currentAction = 'Checking drug run';
    render();
    try {
      const data = await api('/api/drugs?page=1');
      const location = normaliseDrugLabel(data.location);
      const displayLocation = String(data.location || 'Unknown');
      const capacity = Math.max(0, Number(data.capacity ?? data.rankCapacity) || 0);
      const unitsHeld = Math.max(0, Number(data.unitsHeld) || 0);
      const inventory = Array.isArray(data.inventory) ? data.inventory.filter((lot) => lot && lot.id) : [];
      const favouriteCar = data.favouriteCar && typeof data.favouriteCar === 'object' ? data.favouriteCar : null;
      const favouriteCarId = Number(favouriteCar && favouriteCar.publicId);

      state.drugContextLoaded = true;
      state.drugFavouriteCarId = Number.isSafeInteger(favouriteCarId) && favouriteCarId > 0 ? favouriteCarId : null;
      state.drugStatus = `${displayLocation}: ${unitsHeld.toLocaleString('en-GB')}/${capacity.toLocaleString('en-GB')} drug units${
        favouriteCar ? ` · ${favouriteCar.name} ${Number(favouriteCar.damage || 0)}% damage` : ' · no favourite car'
      }`;

      // Sell only lots whose intended profitable destination is the current city.
      const lotsToSell = inventory.filter((lot) => DRUG_SELL_DESTINATIONS[drugLotId(lot)] === location);
      if (lotsToSell.length > 0) {
        await queueAction('/api/drugs/sell', `Selling drugs in ${displayLocation}`, {
          body: { ids: lotsToSell.map((lot) => String(lot.id)) },
        });
        state.drugsDueAt = Date.now() + 50;
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
        });
        state.drugsDueAt = Date.now() + 50;
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
        });
        state.drugsDueAt = Date.now() + 50;
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
      state.drugsDueAt = Date.now() + 50;
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
    if (tier < 1) {
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
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
      state.autoRankStatus = `Active · ${compactDuration(remaining)} remaining`;
      // Use the server-provided end time as the wake-up clock. No constant
      // polling is needed while server-side Auto Rank is already running.
      state.autoRankDueAt = endsAt > Date.now() ? endsAt + 100 : Date.now() + 500;
      return 'active';
    }

    state.autoRankActive = false;
    state.autoRankEndsAt = 0;
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
      const status = await api('/api/auto-rank');
      const sessionState = applyAutoRankState(status);
      if (sessionState !== 'inactive') return;

      const started = await queueAction('/api/auto-rank/session/start', 'Starting Auto Rank', {
        skipDelay: true,
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
      const data = await api('/api/pages/online');
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
    const passSeconds = Math.ceil(activeCount * (Math.max(0, state.settings.maxDelayMs) + 120) / 1000);
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
    const now = Date.now();
    state.shootHistory = state.shootHistory.filter((at) => at > now - SHOOT_WINDOW_MS);
    if (state.shootHistory.length < SHOOT_WINDOW_LIMIT) return 0;
    return Math.max(50, state.shootHistory[0] + SHOOT_WINDOW_MS - now + 25);
  }

  function nextBeamPollAt() {
    return Date.now() + Math.max(50, randomDelay());
  }

  async function shootPlayer(username, bullets, expectedBodyguardFor = '') {
    const wait = shootWaitMs();
    if (wait > 0) {
      state.playerSearchDueAt = Date.now() + wait;
      return null;
    }
    state.shootHistory.push(Date.now());
    try {
      const result = await queueAction('/api/kill/shoot', `Shooting ${username} with ${bullets.toLocaleString('en-GB')} bullet${bullets === 1 ? '' : 's'}`, {
        skipDelay: true,
        body: {
          username,
          bullets,
          showName: false,
          message: '',
          ...(expectedBodyguardFor ? { expectedBodyguardFor } : {}),
        },
      });
      if (result && result.processed === true) {
        log(`Shot at ${username} was processed, but its final response failed — refreshing before any retry`, 'warn');
        state.playerSearchDueAt = Date.now() + 5_000;
        return null;
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.body && error.body.processed === true) {
        log(`Shot at ${username} was processed, but its final response failed — refreshing before any retry`, 'warn');
        state.playerSearchDueAt = Date.now() + 5_000;
        return null;
      }
      throw error;
    }
  }

  async function travelToKillTarget(row) {
    const targetLocation = normaliseDrugLabel(row && row.location);
    const currentLocation = normaliseDrugLabel(state.killData && state.killData.player && state.killData.player.location);
    if (!targetLocation || targetLocation === currentLocation) return false;

    const mode = state.settings.beamTravelMode;
    let driveData = null;
    if (mode !== 'airport') {
      driveData = await api('/api/drugs?page=1');
      const destination = findDrugLocation(driveData, targetLocation);
      const favouriteCar = driveData.favouriteCar && typeof driveData.favouriteCar === 'object'
        ? driveData.favouriteCar
        : null;
      if (destination && favouriteCar && driveData.driveAvailable === true) {
        if (Number(favouriteCar.damage || 0) >= state.settings.drugRepairDamage) {
          const publicId = Number(favouriteCar.publicId);
          if (Number.isSafeInteger(publicId) && publicId > 0) {
            await queueAction(`/api/gta/cars/${encodeURIComponent(String(publicId))}/repair`, `Repairing beam car ${favouriteCar.name || ''}`.trim());
            state.playerSearchDueAt = Date.now() + 50;
            return true;
          }
        }
        await queueAction('/api/drugs/drive', `Driving to ${destination.name} for Beam`, {
          body: { location: Number(destination.id) },
        });
        state.playerSearchDueAt = Date.now() + 50;
        return true;
      }
      if (mode === 'car') {
        state.combatStatus = favouriteCar
          ? `Waiting for favourite car to reach ${row.location}`
          : 'Beam needs a favourited car';
        state.playerSearchDueAt = driveData ? nextDrugDriveCheck(driveData) : Date.now() + 10_000;
        return true;
      }
    }

    if (mode !== 'car') {
      const airport = await api('/api/airport');
      const destination = (Array.isArray(airport.destinations) ? airport.destinations : [])
        .find((entry) => normaliseDrugLabel(entry && entry.name) === targetLocation);
      if (destination && airport.available === true) {
        await queueAction('/api/airport/fly', `Flying to ${destination.name} for Beam`, {
          body: { location: Number(destination.id) },
        });
        state.playerSearchDueAt = Date.now() + 50;
        return true;
      }
      const airportWait = Number(airport.secondsRemaining);
      const driveWait = Number(driveData && driveData.driveSecondsRemaining);
      const waits = [airportWait, driveWait].filter((seconds) => Number.isFinite(seconds) && seconds > 0);
      state.combatStatus = `Waiting to travel to ${row.location}`;
      state.playerSearchDueAt = Date.now() + (waits.length ? Math.min(...waits) * 1000 + 100 : 10_000);
      return true;
    }
    return false;
  }

  async function searchKillName(username, label = 'Searching') {
    try {
      await queueAction('/api/kill/search', `${label} ${username} on the kill page`, {
        body: { username },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && /player not found/i.test(error.message)) {
        removeNonLivingPlayer(username);
        state.playerSearchDueAt = Date.now() + 50;
        return false;
      }
      throw error;
    }
    state.playerSearchBackoff.delete(normalisePlayerName(username));
    state.playerSearchStatus = `Last searched: ${username}`;
    state.playerSearchDueAt = Date.now() + 120;
    return true;
  }

  async function attemptKillSearch(username, label = 'Searching') {
    try {
      return await searchKillName(username, label);
    } catch (error) {
      if (error instanceof ActionCancelledError) throw error;
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
      state.playerSearchDueAt = Date.now() + Math.max(120, randomDelay());
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
      return true;
    }
    if (!primaryFound) {
      state.combatStatus = `Beam: finding ${primary} in ${Math.max(0, Number(primaryPending.secondsUntilFound) || 0)}s`;
      state.playerSearchDueAt = nextTimeFromSeconds(Math.min(60, Number(primaryPending.secondsUntilFound) || 60), 60);
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
        state.playerSearchDueAt = nextBeamPollAt();
        return true;
      }

      if (await travelToKillTarget(blockerFound)) return true;
      if (!data.capabilities || data.capabilities.expectedBodyguardFor !== true) {
        state.combatStatus = 'Beam: deploy the bodyguard-safety game patch before automated bodyguard shots';
        state.playerSearchDueAt = Date.now() + 60_000;
        return true;
      }
      const prepared = await api('/api/kill/prepare', { method: 'POST', body: { username: blocker.name } });
      const required = Number(prepared.bullets);
      const available = Number(data.player && data.player.bullets);
      if (!Number.isSafeInteger(required) || required < 1) throw new Error(`Invalid prepared bullet count for ${blocker.name}`);
      if (!Number.isFinite(available) || available < required) {
        state.combatStatus = `Beam: need ${required.toLocaleString('en-GB')} bullets for bodyguard ${blocker.name}`;
        state.playerSearchDueAt = Date.now() + 30_000;
        return true;
      }
      try {
        const result = await shootPlayer(blocker.name, required, primary);
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
      state.playerSearchDueAt = Date.now() + 50;
      return true;
    }

    if (await travelToKillTarget(primaryFound)) return true;
    const action = playerAction(primary);
    let bullets = 1;
    if (action.beamMode === 'kill') {
      const prepared = await api('/api/kill/prepare', { method: 'POST', body: { username: primary } });
      bullets = Number(prepared.bullets);
      const available = Number(data.player && data.player.bullets);
      if (!Number.isSafeInteger(bullets) || bullets < 1) throw new Error(`Invalid prepared bullet count for ${primary}`);
      if (!Number.isFinite(available) || available < bullets) {
        state.combatStatus = `Beam: need ${bullets.toLocaleString('en-GB')} bullets for ${primary}`;
        state.playerSearchDueAt = Date.now() + 30_000;
        return true;
      }
    }
    const result = await shootPlayer(primary, bullets);
    if (result && result.blockingBodyguard) {
      setActiveBodyguard(primary, result.blockingBodyguard);
      state.combatStatus = `Beam: searching bodyguard ${result.blockingBodyguard}`;
    } else if (result && result.killed === true) {
      state.playerActions[primaryKey] = { ...action, beam: false, kill: false };
      savePlayerActions();
      state.combatStatus = `Beam target ${primary} killed`;
    }
    state.playerSearchDueAt = nextBeamPollAt();
    return true;
  }

  async function runPassiveKill(data, found) {
    const target = state.playerNames.find((name) => {
      const row = found.get(normalisePlayerName(name));
      return playerAction(name).kill && row && row.canShootHere === true;
    });
    if (!target) return false;
    const prepared = await api('/api/kill/prepare', { method: 'POST', body: { username: target } });
    const required = Number(prepared.bullets);
    const available = Number(data.player && data.player.bullets);
    if (!Number.isSafeInteger(required) || required < 1) throw new Error(`Invalid prepared bullet count for ${target}`);
    if (!Number.isFinite(available) || available < required) {
      state.combatStatus = `Kill: need ${required.toLocaleString('en-GB')} bullets for ${target}`;
      return false;
    }
    const result = await shootPlayer(target, required);
    if (result && result.killed === true) {
      const key = normalisePlayerName(target);
      state.playerActions[key] = { ...playerAction(target), kill: false };
      savePlayerActions();
      state.combatStatus = `Kill target ${target} killed`;
    } else if (result && result.blockingBodyguard) {
      state.combatStatus = `Kill: ${target} is protected by ${result.blockingBodyguard}`;
    }
    state.playerSearchDueAt = Date.now() + 5_000;
    return true;
  }

  async function runPlayerSearch() {
    if (state.playerSearchRunning) return;
    state.playerSearchRunning = true;
    state.currentAction = 'Checking kill-page searches';
    render();
    try {
      const data = await api('/api/kill');
      state.killData = data;
      const viewer = validPlayerName(data.player && data.player.username);
      if (viewer) setViewerUsername(viewer);
      if (data.player && data.player.alive === false) {
        stopAutomationForDeath();
        return;
      }

      const now = Date.now();
      for (const [key, until] of state.playerSearchBackoff) {
        if (until <= now) state.playerSearchBackoff.delete(key);
      }
      const { pending, found } = killMaps(data);
      const renewalTarget = nextSearchRenewalTarget(data, now);
      if (renewalTarget) {
        await attemptKillSearch(renewalTarget, 'Renewing search for');
        return;
      }
      if (await runBeam(data, pending, found)) return;
      if (await runPassiveKill(data, found)) return;
      const ownName = normalisePlayerName(state.viewerUsername);
      const candidates = state.playerNames.filter((name) => {
        const key = normalisePlayerName(name);
        return key && key !== ownName && (state.playerSearchBackoff.get(key) || 0) <= now;
      });
      const searchCandidates = candidates.filter((name) => state.settings.searchPlayers || playerAction(name).kill || playerAction(name).beam);

      // Searches already returned by /api/kill are renewed above, including
      // searches created manually on the kill page and temporary bodyguard
      // searches which are not part of the bot's saved player list.
      const target = searchCandidates.find((name) => {
        const key = normalisePlayerName(name);
        return !pending.has(key) && !found.has(key);
      });

      if (!target) {
        state.playerSearchStatus = state.playerNames.length
          ? `${pending.size} pending · ${found.size} found`
          : 'No players collected yet';
        state.playerSearchDueAt = hasCombatActions()
          ? Math.min(nextPlayerSearchCheck(data), Date.now() + 10_000)
          : nextPlayerSearchCheck(data);
        return;
      }

      await attemptKillSearch(target);
    } catch (error) {
      if (!(error instanceof ActionCancelledError)) handleTaskError('Player search', error);
      state.playerSearchDueAt = Date.now() + errorBackoff(error);
    } finally {
      state.playerSearchRunning = false;
      refreshIdleStatus();
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
    if (!inmate || state.jailBustRunning || state.inJail) return;
    const inmateIdentifier = jailInmateIdentifier(inmate);
    if (!inmateIdentifier) return;

    state.jailBustCandidate = null;
    state.jailBustRunning = true;
    state.currentAction = `Preparing to bust ${inmate.username || 'player'}`;
    render();
    try {
      await queueAction(
        `/api/jail/bust/${encodeURIComponent(inmateIdentifier)}`,
        `Busting ${inmate.username || 'player'}`,
        { skipDelay: true },
      );
      state.jailBustCandidate = null;
      state.jailBustDueAt = Date.now() + 50;
      state.jailDueAt = 0;
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
        state.jailBustDueAt = Date.now() + 50;
      } else if (!(error instanceof ActionCancelledError)) {
        handleTaskError('Jailbust', error);
        state.jailBustDueAt = Date.now() + errorBackoff(error);
      }
      state.jailDueAt = 0;
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
    try {
      const data = await api('/api/jail');
      discoverJailInmates(data);
      const wasInJail = state.inJail;
      if (data.inJail === true) {
        markJailed();
      } else if (requestStartedAt >= state.jailMarkedAt) {
        state.inJail = false;
        state.jailMarkedAt = 0;
      }
      state.jailBustCandidate = chooseJailBustCandidate(data);
      bustImmediately = state.jailBustCandidate !== null && !state.jailBustRunning;
      if (state.settings.jailBust && !state.inJail) {
        state.jailDueAt = Date.now() + randomDelay();
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
      // Do not wait for the ordinary feature scheduler. Crimes may be processing
      // several ready actions, and inmates can disappear within milliseconds.
      if (bustImmediately) void runJailBust();
      refreshIdleStatus();
    }
  }

  function errorBackoff(error) {
    if (error instanceof ApiError && error.status === 429) {
      return Math.max(3_000, error.retryAfter * 1000);
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
      state.authRequired = true;
      state.currentAction = 'Log in to Underworld Legacy';
      render();
      return;
    }
    if (error instanceof ApiError && error.body && error.body.inJail === true) {
      markJailed();
      return;
    }
    log(`${task}: ${error && error.message ? error.message : error}`, 'error');
  }

  function refreshIdleStatus() {
    if (state.stoppedForDeath) state.currentAction = 'Character dead — stopped';
    else if (!state.botTab) state.currentAction = 'Play tab — automation inactive';
    else if (!state.settings.enabled) state.currentAction = 'Stopped';
    else if (state.authRequired) state.currentAction = 'Log in to Underworld Legacy';
    else if (!state.controller) state.currentAction = 'Standby — another tab is active';
    else if (state.inJail) state.currentAction = 'Paused while in jail';
    else if (autoRankIsActiveNow() && !state.jailBustRunning && !state.drugsRunning && !state.playerSearchRunning) state.currentAction = 'Auto Rank active — crimes/GTA/melt paused';
    else if (!state.crimesRunning && !state.gtaRunning && !state.jailBustRunning && !state.meltRunning && !state.drugsRunning && !state.autoRankRunning && !state.playerDiscoveryRunning && !state.playerSearchRunning && !state.jailRunning) state.currentAction = 'Waiting for next action';
    render();
  }

  function tick() {
    if (!state.botTab || !state.controller || !state.settings.enabled || state.stoppedForDeath) {
      refreshIdleStatus();
      return;
    }

    const now = Date.now();
    if (!state.jailRunning && !state.jailBustRunning && state.jailDueAt <= now) void checkJail();
    if (state.settings.discoverPlayers && !state.playerDiscoveryRunning && state.playerDiscoveryDueAt <= now) {
      void runPlayerDiscovery();
    }
    if (!state.inJail && (state.settings.searchPlayers || hasCombatActions()) && !state.playerSearchRunning && state.playerSearchDueAt <= now) {
      // Kill-page reads may run beside other feature reads. Any resulting POST
      // still passes through the shared mutation queue.
      void runPlayerSearch();
    }
    if (state.settings.autoRank && !state.autoRankRunning && state.autoRankDueAt <= now) {
      // Let an action already in progress finish before switching control to
      // server-side Auto Rank.
      if (state.crimesRunning || state.gtaRunning || state.meltRunning || state.drugsRunning || state.jailBustRunning) return;
      void runAutoRank();
      return;
    }
    if (state.autoRankRunning) return;
    if (state.inJail) return;
    const serverRanking = autoRankIsActiveNow();
    if (!serverRanking && state.settings.crimes && !state.crimesRunning && state.crimesDueAt <= now) {
      void runCrimes();
      return;
    }
    if (state.crimesRunning) return;
    if (state.settings.jailBust && state.jailBustCandidate && !state.jailBustRunning && state.jailBustDueAt <= now) {
      void runJailBust();
      return;
    }
    if (state.jailBustRunning) return;
    if (state.settings.drugs && !activeBeamName() && !state.drugContextLoaded) {
      if (!state.drugsRunning && state.drugsDueAt <= now) void runDrugs();
      return;
    }
    if (!serverRanking && state.settings.gta && !state.gtaRunning && state.gtaDueAt <= now) void runGta();
    if (!serverRanking && state.settings.melt && !state.meltRunning && state.meltDueAt <= now) void runMelt();
    if (state.settings.drugs && !activeBeamName() && !state.drugsRunning && state.drugsDueAt <= now) void runDrugs();
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
        <nav class="ul-simple-tabs" role="tablist" aria-label="Bot sections">
          <button type="button" class="ul-simple-tab" data-tab="actions" role="tab">Actions</button>
          <button type="button" class="ul-simple-tab" data-tab="cars" role="tab">Cars</button>
          <button type="button" class="ul-simple-tab" data-tab="players" role="tab">Players</button>
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
            <label title="Collect visible Players Online and public jail inmates"><input type="checkbox" id="ul-simple-discover-players"> Discover players</label>
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

        <section class="ul-simple-tab-panel" data-tab-panel="logs" role="tabpanel" hidden>
          <div class="ul-simple-section-title">Timing</div>
          <div class="ul-simple-delay">
            Action / jail scan delay
            <input type="number" id="ul-simple-min-delay" min="0" max="10000" step="50" aria-label="Minimum delay">
            –
            <input type="number" id="ul-simple-max-delay" min="0" max="10000" step="50" aria-label="Maximum delay">
            ms
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
      #ul-simple-bot .ul-simple-tabs { display:grid; grid-template-columns:repeat(4,1fr); border-top:1px solid #3b3b3b; border-bottom:1px solid #3b3b3b; background:#181818; }
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
      #ul-simple-bot .ul-simple-delay { display:flex; flex-wrap:wrap; gap:4px; align-items:center; color:#bbb; margin-bottom:12px; }
      #ul-simple-bot .ul-simple-delay input { width:54px; padding:3px; color:#eee; background:#1b1b1b; border:1px solid #555; }
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
    const minimum = host.querySelector('#ul-simple-min-delay');
    const maximum = host.querySelector('#ul-simple-max-delay');
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    const collapse = host.querySelector('#ul-simple-collapse');
    const body = host.querySelector('#ul-simple-body');

    for (const tab of host.querySelectorAll('.ul-simple-tab')) {
      tab.addEventListener('click', () => {
        const nextTab = String(tab.dataset.tab || '');
        if (!['actions', 'cars', 'players', 'logs'].includes(nextTab)) return;
        state.uiTab = nextTab;
        sessionStorage.setItem(UI_TAB_KEY, nextTab);
        render();
      });
    }

    toggle.addEventListener('click', () => saveSettings({ enabled: !state.settings.enabled }));
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
      state.playerSearchDueAt = 0;
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
    minimum.addEventListener('change', () => saveSettings({ minDelayMs: minimum.value }));
    maximum.addEventListener('change', () => saveSettings({ maxDelayMs: maximum.value }));
    tabMode.addEventListener('click', () => setBotTab(!state.botTab));
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

    const toggle = host.querySelector('#ul-simple-toggle');
    toggle.textContent = state.stoppedForDeath ? 'Restart bot' : state.settings.enabled ? 'Stop' : 'Start';
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
    host.querySelector('#ul-simple-min-delay').value = String(state.settings.minDelayMs);
    host.querySelector('#ul-simple-max-delay').value = String(state.settings.maxDelayMs);
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    tabMode.textContent = state.botTab ? 'Release bot tab' : 'Use as bot tab';
    tabMode.classList.toggle('active', state.botTab);
    for (const control of host.querySelectorAll('#ul-simple-body button:not(.ul-simple-tab), #ul-simple-body input, #ul-simple-body textarea, #ul-simple-body select')) {
      control.disabled = !state.botTab;
    }
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

  function renderPlayerActions(container) {
    const killRows = state.killData
      ? [...(Array.isArray(state.killData.pending) ? state.killData.pending : []), ...(Array.isArray(state.killData.found) ? state.killData.found : [])]
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
    const { pending, found } = killMaps(state.killData || {});
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
    state.botTab = enabled;
    sessionStorage.setItem(BOT_TAB_KEY, enabled ? 'true' : 'false');
    if (enabled) {
      state.currentAction = 'Waiting for controller lock';
      startControllerElection();
    } else {
      if (state.releaseController) state.releaseController();
      state.controller = false;
      state.currentAction = 'Play tab — automation inactive';
    }
    render();
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

  GM_addValueChangeListener(SETTINGS_KEY, (_name, _oldValue, newValue) => {
    const nextSettings = sanitiseSettings({ ...DEFAULT_SETTINGS, ...(newValue || {}) });
    const starting = nextSettings.enabled && !state.settings.enabled;
    const wasStoppedForDeath = state.stoppedForDeath;
    state.settings = nextSettings;
    if (starting) prepareRuntimeForStart(wasStoppedForDeath);
    else if (state.settings.enabled) wakeAll();
    render();
  });

  GM_addValueChangeListener(DEATH_STOP_KEY, (_name, _oldValue, newValue) => {
    state.stoppedForDeath = newValue === true;
    if (state.stoppedForDeath) {
      state.autoRankActive = false;
      state.autoRankEndsAt = 0;
    }
    render();
  });

  GM_addValueChangeListener(PLAYER_LIST_KEY, (_name, _oldValue, newValue) => {
    state.playerNames = sanitisePlayerNames(newValue);
    state.playerDiscoveryStatus = `${state.playerNames.length.toLocaleString('en-GB')} player${state.playerNames.length === 1 ? '' : 's'} collected`;
    if (state.settings.searchPlayers) state.playerSearchDueAt = 0;
    render();
  });

  GM_addValueChangeListener(PLAYER_ACTIONS_KEY, (_name, _oldValue, newValue) => {
    state.playerActions = sanitisePlayerActions(newValue);
    state.playerSearchDueAt = 0;
    render();
  });

  createPanel();
  if (state.botTab) startControllerElection();
  setInterval(tick, 50);
})();
