const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PER_IP = 100;
const DEFAULT_MAX_PER_USERNAME_IP = 10;
const MAX_USERNAME_KEY_LENGTH = 128;
const MAX_TRACKED_RATE_KEYS = 10000;

const ipAttempts = new Map();
const usernameIpAttempts = new Map();

function toPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nowMs() {
    return Date.now();
}

function normalizeUsername(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const normalized = value.trim().toLowerCase();
    return normalized.slice(0, MAX_USERNAME_KEY_LENGTH);
}

function getClientIp(req) {
    if (!req || typeof req.ip !== 'string') {
        return 'unknown';
    }
    return req.ip;
}

function getUsernameIpKey(req, username) {
    return `${getClientIp(req)}::${normalizeUsername(username)}`;
}

function ensureState(map, key, timestamp, windowMs) {
    const state = map.get(key);
    if (!state) {
        const nextState = {
            windowStart: timestamp,
            count: 0,
            lockUntil: 0
        };
        map.set(key, nextState);
        return nextState;
    }

    if (state.windowStart + windowMs <= timestamp) {
        state.windowStart = timestamp;
        state.count = 0;
    }

    if (state.lockUntil && state.lockUntil <= timestamp) {
        state.lockUntil = 0;
    }

    return state;
}

function isLocked(map, key, timestamp, windowMs) {
    const state = ensureState(map, key, timestamp, windowMs);
    return state.lockUntil > timestamp;
}

function registerFailure(map, key, timestamp, limits) {
    const state = ensureState(map, key, timestamp, limits.windowMs);
    state.count += 1;

    if (state.count >= limits.maxAttempts) {
        state.lockUntil = timestamp + limits.lockoutMs;
        state.count = 0;
        state.windowStart = timestamp;
    }
}

function clearKey(map, key) {
    if (key) {
        map.delete(key);
    }
}

function pruneMap(map, timestamp, windowMs, lockoutMs) {
    if (map.size <= MAX_TRACKED_RATE_KEYS) {
        return;
    }

    for (const [key, state] of map.entries()) {
        const windowExpired = state.windowStart + windowMs + lockoutMs <= timestamp;
        const lockExpired = !state.lockUntil || state.lockUntil <= timestamp;

        if (windowExpired && lockExpired) {
            map.delete(key);
        }

        if (map.size <= MAX_TRACKED_RATE_KEYS) {
            return;
        }
    }

    while (map.size > MAX_TRACKED_RATE_KEYS) {
        const firstKey = map.keys().next().value;
        if (!firstKey) {
            return;
        }
        map.delete(firstKey);
    }
}

function getLimits() {
    return {
        windowMs: toPositiveNumber(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
        lockoutMs: toPositiveNumber(process.env.LOGIN_RATE_LIMIT_LOCKOUT_MS, DEFAULT_LOCKOUT_MS),
        maxPerIp: toPositiveNumber(process.env.LOGIN_RATE_LIMIT_MAX_PER_IP, DEFAULT_MAX_PER_IP),
        maxPerUsernameIp: toPositiveNumber(
            process.env.LOGIN_RATE_LIMIT_MAX_PER_USERNAME_IP,
            DEFAULT_MAX_PER_USERNAME_IP
        )
    };
}

function enforceLoginRateLimit(req, res, next) {
    const limits = getLimits();
    const now = nowMs();
    pruneMap(ipAttempts, now, limits.windowMs, limits.lockoutMs);
    pruneMap(usernameIpAttempts, now, limits.windowMs, limits.lockoutMs);

    const ipKey = getClientIp(req);
    const username = normalizeUsername(req.body?.username);
    const usernameIpKey = username ? getUsernameIpKey(req, username) : '';

    const ipLocked = isLocked(ipAttempts, ipKey, now, limits.windowMs);
    const usernameIpLocked = usernameIpKey
        ? isLocked(usernameIpAttempts, usernameIpKey, now, limits.windowMs)
        : false;

    if (ipLocked || usernameIpLocked) {
        return res.status(429).json({
            message: 'Too many login attempts. Try again later.'
        });
    }

    return next();
}

function registerLoginFailure(req, username) {
    const limits = getLimits();
    const now = nowMs();
    pruneMap(ipAttempts, now, limits.windowMs, limits.lockoutMs);
    pruneMap(usernameIpAttempts, now, limits.windowMs, limits.lockoutMs);

    const ipKey = getClientIp(req);
    const normalizedUsername = normalizeUsername(username || req.body?.username);
    const usernameIpKey = normalizedUsername ? getUsernameIpKey(req, normalizedUsername) : '';

    registerFailure(ipAttempts, ipKey, now, {
        windowMs: limits.windowMs,
        lockoutMs: limits.lockoutMs,
        maxAttempts: limits.maxPerIp
    });

    if (usernameIpKey) {
        registerFailure(usernameIpAttempts, usernameIpKey, now, {
            windowMs: limits.windowMs,
            lockoutMs: limits.lockoutMs,
            maxAttempts: limits.maxPerUsernameIp
        });
    }
}

function clearLoginFailures(req, username) {
    const normalizedUsername = normalizeUsername(username || req.body?.username);
    const usernameIpKey = normalizedUsername ? getUsernameIpKey(req, normalizedUsername) : '';

    clearKey(usernameIpAttempts, usernameIpKey);
}

module.exports = {
    enforceLoginRateLimit,
    registerLoginFailure,
    clearLoginFailures
};
