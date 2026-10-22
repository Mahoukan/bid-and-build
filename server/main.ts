import { createRuntime } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const runtime = createRuntime(config);
  runtime.httpServer.once('error', (error) => {
    console.error(`Server failed to listen: ${error.message}`);
    void runtime.close().finally(() => { process.exitCode = 1; });
  });
  runtime.httpServer.listen(config.port, config.host, () => {
    console.log(`Bid & Build server listening on ${config.host}:${config.port} (${config.mode}).`);
    console.log(`Health: http://localhost:${config.port}/health`);
  });
  const shutdown = () => {
    console.log('Closing Bid & Build.');
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    void runtime.close().then(() => clearTimeout(timeout));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Startup failed.');
  process.exitCode = 1;
}
