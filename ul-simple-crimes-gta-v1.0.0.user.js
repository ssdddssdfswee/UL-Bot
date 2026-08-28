// ==UserScript==
// @name         Underworld Legacy - Crimes & GTA
// @namespace    https://underworldlegacy.com/
// @version      1.3.0
// @description  Small API-first Crimes, GTA, jailbust and safely filtered melting automation panel for Underworld Legacy.
// @author       Crisy
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

  const SCRIPT_NAME = 'UL Crimes, GTA & Melt';
  const SETTINGS_KEY = 'ul_simple_crimes_gta_settings_v1';
  const CONTROLLER_LOCK = 'ul-simple-crimes-gta-controller-v1';
  const BOT_TAB_KEY = 'ul_simple_crimes_gta_bot_tab_v1';
  const NEVER_MELT_CAR_NAMES = new Set([
    'Tuner',
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
    repairBeforeMelt: false,
    minDelayMs: 150,
    maxDelayMs: 350,
  });

  const state = {
    settings: loadSettings(),
    botTab: sessionStorage.getItem(BOT_TAB_KEY) === 'true',
    controller: false,
    controllerLockRequested: false,
    releaseController: null,
    inJail: false,
    jailMarkedAt: 0,
    authRequired: false,
    stoppedForDeath: false,
    currentAction: 'Waiting for controller',
    lastAction: 'None yet',
    crimesDueAt: 0,
    gtaDueAt: 0,
    jailBustDueAt: 0,
    meltDueAt: 0,
    jailDueAt: 0,
    crimesRunning: false,
    gtaRunning: false,
    jailBustRunning: false,
    meltRunning: false,
    jailRunning: false,
    jailBustCandidate: null,
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
      repairBeforeMelt: value.repairBeforeMelt === true,
      minDelayMs: Math.min(minimum, maximum),
      maxDelayMs: Math.max(minimum, maximum),
    };
  }

  function saveSettings(patch) {
    state.settings = sanitiseSettings({ ...state.settings, ...patch });
    GM_setValue(SETTINGS_KEY, state.settings);
    if (patch.enabled === true) {
      state.stoppedForDeath = false;
      wakeAll();
    }
    render();
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
    state.jailDueAt = 0;
  }

  function markJailed() {
    state.inJail = true;
    state.jailMarkedAt = Date.now();
    state.jailBustCandidate = null;
    state.jailDueAt = 0;
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
    if (state.inJail) throw new ActionCancelledError('Player is in jail');

    // Delay non-crime actions before joining the mutation queue. This prevents
    // a delayed GTA/repair/melt request from holding up a newly ready crime.
    if (options.skipDelay !== true) {
      await sleep(randomDelay());
    }

    const execute = async () => {
      if (!actionAllowed()) {
        throw new ActionCancelledError('Automation is stopped');
      }
      if (state.inJail) {
        throw new ActionCancelledError('Player is in jail');
      }

      state.currentAction = label;
      render();

      const result = await api(path, { method: 'POST' });
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
      const eligibleGroup = groups.find((group) => Number(group.count) > 0 && canMeltCar(group));
      if (!eligibleGroup) {
        state.meltDueAt = Date.now() + 30_000;
        return;
      }

      let car = (Array.isArray(overview.cars) ? overview.cars : [])
        .find((candidate) => candidate.name === eligibleGroup.name && canMeltCar(candidate));

      if (!car) {
        const filtered = await api(`/api/melt?page=1&filter=${encodeURIComponent(eligibleGroup.name)}`);
        if (!filtered.available) {
          state.meltDueAt = nextTimeFromSeconds(filtered.secondsRemaining, 5);
          return;
        }
        car = (Array.isArray(filtered.cars) ? filtered.cars : []).find(canMeltCar);
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

  function bigintOrZero(value) {
    try {
      return BigInt(String(value ?? '0'));
    } catch {
      return 0n;
    }
  }

  function chooseJailBustCandidate(data) {
    if (!state.settings.jailBust || data.inJail === true) return null;
    const playerId = String(data.playerId || '');
    const inmates = (Array.isArray(data.inmates) ? data.inmates : [])
      .filter((inmate) => inmate && String(inmate.id || '') && String(inmate.id) !== playerId);

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

    state.jailBustCandidate = null;
    state.jailBustRunning = true;
    state.currentAction = `Preparing to bust ${inmate.username || 'player'}`;
    render();
    try {
      await queueAction(
        `/api/jail/bust/${encodeURIComponent(String(inmate.id))}`,
        `Busting ${inmate.username || 'player'}`,
      );
      state.jailBustDueAt = Date.now() + 1_000;
      state.jailDueAt = 0;
    } catch (error) {
      if (error instanceof ApiError && (
        (error.body && error.body.success === false) ||
        /cannot bust players while you are in jail|got caught trying to bust/i.test(error.message)
      )) {
        log(error.message, 'warn');
        markJailed();
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
    try {
      const data = await api('/api/jail');
      const wasInJail = state.inJail;
      if (data.inJail === true) {
        markJailed();
      } else if (requestStartedAt >= state.jailMarkedAt) {
        state.inJail = false;
        state.jailMarkedAt = 0;
      }
      state.jailBustCandidate = chooseJailBustCandidate(data);
      state.jailDueAt = nextTimeFromSeconds(state.inJail ? Math.min(Number(data.secondsRemaining) || 3, 3) : 3, 3);

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
    if (error instanceof ApiError && error.status === 401) {
      if (error.body && error.body.dead === true) {
        state.stoppedForDeath = true;
        state.settings.enabled = false;
        GM_setValue(SETTINGS_KEY, state.settings);
        log('Character is dead — automation stopped', 'error');
      } else {
        state.authRequired = true;
        state.currentAction = 'Log in to Underworld Legacy';
        render();
      }
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
    else if (!state.crimesRunning && !state.gtaRunning && !state.jailBustRunning && !state.meltRunning && !state.jailRunning) state.currentAction = 'Waiting for next action';
    render();
  }

  function tick() {
    if (!state.botTab || !state.controller || !state.settings.enabled || state.stoppedForDeath) {
      refreshIdleStatus();
      return;
    }

    const now = Date.now();
    if (!state.jailRunning && state.jailDueAt <= now) void checkJail();
    if (state.jailRunning) return;
    if (state.inJail) return;
    if (state.settings.crimes && !state.crimesRunning && state.crimesDueAt <= now) {
      void runCrimes();
      return;
    }
    if (state.crimesRunning) return;
    if (state.settings.jailBust && state.jailBustCandidate && !state.jailBustRunning && state.jailBustDueAt <= now) {
      void runJailBust();
      return;
    }
    if (state.jailBustRunning) return;
    if (state.settings.gta && !state.gtaRunning && state.gtaDueAt <= now) void runGta();
    if (state.settings.melt && !state.meltRunning && state.meltDueAt <= now) void runMelt();
  }

  function createPanel() {
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
        <div id="ul-simple-status">Loading…</div>
        <div class="ul-simple-controls">
          <button type="button" id="ul-simple-toggle">Start</button>
          <label><input type="checkbox" id="ul-simple-crimes"> Crimes</label>
          <label><input type="checkbox" id="ul-simple-gta"> GTA</label>
          <label title="Failed attempts can send your character to jail"><input type="checkbox" id="ul-simple-jailbust"> Jailbust</label>
          <label><input type="checkbox" id="ul-simple-melt"> Melt</label>
        </div>
        <div class="ul-simple-melt-filter">
          <span>Melt:</span>
          <label><input type="checkbox" id="ul-simple-melt-common"> Common</label>
          <label><input type="checkbox" id="ul-simple-melt-rare"> Rare</label>
          <label><input type="checkbox" id="ul-simple-repair-before-melt"> Repair first</label>
        </div>
        <div class="ul-simple-protected" title="These types and every API-reported very rare car are always blocked from melting.">
          Never melts: Tuner, RS Tuner, Mythic, Hyper, Black or Orange
        </div>
        <div class="ul-simple-delay">
          Other delay
          <input type="number" id="ul-simple-min-delay" min="0" max="10000" step="50" aria-label="Minimum delay">
          –
          <input type="number" id="ul-simple-max-delay" min="0" max="10000" step="50" aria-label="Maximum delay">
          ms
        </div>
        <div id="ul-simple-last">None yet</div>
        <div id="ul-simple-logs"></div>
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
      #ul-simple-bot #ul-simple-body { padding:8px; }
      #ul-simple-bot #ul-simple-status { min-height:31px; margin-bottom:7px; color:#ffd36b; }
      #ul-simple-bot .ul-simple-controls { display:flex; flex-wrap:wrap; gap:9px; align-items:center; margin-bottom:8px; }
      #ul-simple-bot .ul-simple-controls label { display:flex; gap:4px; align-items:center; }
      #ul-simple-bot #ul-simple-toggle.running { color:#ffb1b1; border-color:#a44; }
      #ul-simple-bot .ul-simple-melt-filter { display:flex; gap:9px; align-items:center; margin-bottom:5px; color:#ccc; }
      #ul-simple-bot .ul-simple-melt-filter label { display:flex; gap:4px; align-items:center; }
      #ul-simple-bot .ul-simple-protected { margin-bottom:8px; padding:5px 6px; border:1px solid #5b4b2c; background:#211c12; color:#ffd36b; }
      #ul-simple-bot .ul-simple-delay { display:flex; gap:4px; align-items:center; color:#bbb; margin-bottom:8px; }
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
    const meltCommon = host.querySelector('#ul-simple-melt-common');
    const meltRare = host.querySelector('#ul-simple-melt-rare');
    const repairBeforeMelt = host.querySelector('#ul-simple-repair-before-melt');
    const minimum = host.querySelector('#ul-simple-min-delay');
    const maximum = host.querySelector('#ul-simple-max-delay');
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    const collapse = host.querySelector('#ul-simple-collapse');
    const body = host.querySelector('#ul-simple-body');

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
    meltCommon.addEventListener('change', () => {
      saveSettings({ meltCommon: meltCommon.checked });
      state.meltDueAt = 0;
    });
    meltRare.addEventListener('change', () => {
      saveSettings({ meltRare: meltRare.checked });
      state.meltDueAt = 0;
    });
    repairBeforeMelt.addEventListener('change', () => {
      saveSettings({ repairBeforeMelt: repairBeforeMelt.checked });
      state.meltDueAt = 0;
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
    toggle.textContent = state.settings.enabled ? 'Stop' : 'Start';
    toggle.classList.toggle('running', state.settings.enabled);
    host.querySelector('#ul-simple-crimes').checked = state.settings.crimes;
    host.querySelector('#ul-simple-gta').checked = state.settings.gta;
    host.querySelector('#ul-simple-jailbust').checked = state.settings.jailBust;
    host.querySelector('#ul-simple-melt').checked = state.settings.melt;
    host.querySelector('#ul-simple-melt-common').checked = state.settings.meltCommon;
    host.querySelector('#ul-simple-melt-common').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-melt-rare').checked = state.settings.meltRare;
    host.querySelector('#ul-simple-melt-rare').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-repair-before-melt').checked = state.settings.repairBeforeMelt;
    host.querySelector('#ul-simple-repair-before-melt').disabled = !state.settings.melt;
    host.querySelector('#ul-simple-min-delay').value = String(state.settings.minDelayMs);
    host.querySelector('#ul-simple-max-delay').value = String(state.settings.maxDelayMs);
    const tabMode = host.querySelector('#ul-simple-tab-mode');
    tabMode.textContent = state.botTab ? 'Release bot tab' : 'Use as bot tab';
    tabMode.classList.toggle('active', state.botTab);
    for (const control of host.querySelectorAll('#ul-simple-body button, #ul-simple-body input')) {
      control.disabled = !state.botTab;
    }
    if (state.botTab) {
      host.querySelector('#ul-simple-melt-common').disabled = !state.settings.melt;
      host.querySelector('#ul-simple-melt-rare').disabled = !state.settings.melt;
      host.querySelector('#ul-simple-repair-before-melt').disabled = !state.settings.melt;
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
    state.settings = sanitiseSettings({ ...DEFAULT_SETTINGS, ...(newValue || {}) });
    if (state.settings.enabled) wakeAll();
    render();
  });

  createPanel();
  if (state.botTab) startControllerElection();
  setInterval(tick, 50);
})();
