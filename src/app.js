require('./config/env');

const express = require('express');
const routes = require('./routes');

const app = express();

app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), browsing-topics=()'
    );
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    return next();
});

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }));
app.use(routes);

app.use((req, res) => {
    return res.status(404).json({
        message: 'Not found'
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    console.error('[app.error] Unhandled request error', {
        message: error?.message
    });

    return res.status(500).json({
        message: 'Internal server error'
    });
});

module.exports = app;
