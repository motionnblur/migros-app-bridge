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
        console.error('Server startup failed:', error.message);
        process.exit(1);
    }
}

startServer();
