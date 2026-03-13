function parseCsvSet(value) {
    if (!value || typeof value !== 'string') {
        return new Set();
    }

    return new Set(
        value
            .split(',')
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    );
}

function isEnabled(value) {
    return String(value || '').trim().toLowerCase() === 'true';
}

function requireSupportAccess(req, res, next) {
    const auth = req.auth || {};
    const username =
        typeof auth.username === 'string' ? auth.username.trim().toLowerCase() : '';
    const role = typeof auth.role === 'string' ? auth.role.trim().toLowerCase() : '';

    const allowedRolesFromEnv = parseCsvSet(process.env.SUPPORT_ALLOWED_ROLES);
    const allowedRoles =
        allowedRolesFromEnv.size > 0
            ? allowedRolesFromEnv
            : new Set(['support_agent', 'support_admin', 'admin']);
    const allowedUsernames = parseCsvSet(process.env.SUPPORT_ALLOWED_USERNAMES);

    if (role && allowedRoles.has(role)) {
        return next();
    }

    if (username && allowedUsernames.size > 0 && allowedUsernames.has(username)) {
        return next();
    }

    const allowInsecureSupportAccess =
        process.env.NODE_ENV !== 'production' &&
        isEnabled(process.env.ALLOW_INSECURE_SUPPORT_ACCESS);

    if (allowInsecureSupportAccess) {
        return next();
    }

    return res.status(403).json({
        message: 'Forbidden'
    });
}

module.exports = {
    requireSupportAccess
};

