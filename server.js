const app = require('./src/app');
const { port } = require('./src/config/env');
const { initializeSupportSchema } = require('./src/config/db');

async function startServer() {
    try {
        await initializeSupportSchema();

        app.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });
    } catch (error) {
        if (
            error &&
            error.code === 'ENETUNREACH' &&
            String(process.env.DATABASE_URL || '').includes('supabase.co')
        ) {
            console.error(
                'Database network is unreachable from Docker (likely IPv6 route issue). ' +
                    'Use Supabase pooler URL (*.pooler.supabase.com) with sslmode=require.'
            );
        }
        console.error('Server startup failed:', error.message);
        process.exit(1);
    }
}

startServer();
