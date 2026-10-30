import { buildApp, createServices } from './app.ts';

const services = createServices();
const app = await buildApp(services);

await app.listen({ host: services.cfg.host, port: services.cfg.port });
console.log(`NORO Social AI: http://${services.cfg.host === '0.0.0.0' ? '127.0.0.1' : services.cfg.host}:${services.cfg.port}`);
if (services.setupToken) {
  console.log(`Первый запуск: создайте администратора в браузере. Код первичной настройки (нужен только при входе не с этого компьютера): ${services.setupToken}`);
}
if (services.cfg.schedulerEnabled) services.scheduler.start();
else console.log('Планировщик выключен (NORO_SCHEDULER=off)');

const shutdown = async (signal: string) => {
  console.log(`Получен ${signal}, останавливаюсь…`);
  services.scheduler.stop();
  await app.close();
  services.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
