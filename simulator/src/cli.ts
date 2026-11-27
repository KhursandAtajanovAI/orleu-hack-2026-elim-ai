#!/usr/bin/env -S node --experimental-strip-types --no-warnings
/**
 * Симулятор «Қайда?» (ТЗ 14). Команды:
 *   all      [--days 14]                — очистить симуляцию, сиды, история (одна команда → полные тестовые данные)
 *   seed     [--days 14] [--ahead 3]    — справочники, маршруты, аккаунты
 *   history  [--days 14] [--seed 42]    — история через публичное API
 *   live     [--speed 10] [--minutes 60] [--no-events] — режим реального времени
 *   control  --status running|paused|reset|stopped [--speed 1|10|60] — пульт (то же, что в админке)
 *   purge                               — удалить симулированные данные (справочники остаются)
 *   check                               — сводка: что есть в базе (для проверки после запуска)
 * Переменные: SUPABASE_URL, SUPABASE_ANON_KEY (+ API_URL); локально без Edge Function —
 * SUPABASE_SERVICE_ROLE_KEY и DEMO_PASSWORD. OSRM_URL — свой сервер маршрутов, OSRM_OFFLINE=1 — без него.
 */
import { fileURLToPath } from 'node:url';
import { Api, configFromEnv, callCount } from './client.ts';
import { Router } from './geo.ts';
import { seed, loginAll, ids } from './seed.ts';
import { history } from './history.ts';
import { live, setControl, readControl } from './live.ts';

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) out[k] = true;
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const a = args(rest);
  const num = (k: string, d: number) => (a[k] === undefined ? d : Number(a[k]));
  if (cmd === 'help' || cmd === '--help') {
    console.log(readHelp());
    return;
  }
  const api = new Api(configFromEnv());
  const router = new Router(fileURLToPath(new URL('../data/routes-cache.json', import.meta.url)));
  const days = num('days', 14);
  const t0 = Date.now();

  switch (cmd) {
    case 'seed':
      await seed(api, { days, ahead: num('ahead', 3) });
      break;
    case 'history': {
      const world = await loginAll(api);
      await history(api, world, router, { days, seed: num('seed', 42) });
      break;
    }
    case 'all': {
      const world0 = await loginAll(api);
      console.log('🧹 очистка прошлой симуляции:', await api.rpc(world0.admin, 'sim_purge'));
      const world = await seed(api, { days, ahead: num('ahead', 3) });
      await history(api, world, router, { days, seed: num('seed', 42) });
      break;
    }
    case 'live':
      await live(api, router, { speed: a.speed ? Number(a.speed) : undefined, minutes: num('minutes', 60), events: !a['no-events'], seed: num('seed', 42) });
      break;
    case 'control': {
      const world = await loginAll(api);
      const status = a.status as string | undefined;
      if (status && !['running', 'paused', 'reset', 'stopped'].includes(status)) throw new Error('--status running|paused|reset|stopped');
      console.log(await setControl(api, world.admin, { ...(status ? { status: status as 'running' } : {}), ...(a.speed ? { speed: Number(a.speed) } : {}) }));
      break;
    }
    case 'purge': {
      const world = await loginAll(api);
      console.log(await api.rpc(world.admin, 'sim_purge'));
      break;
    }
    case 'check': {
      const world = await loginAll(api);
      const summary = await api.rpc(world.akimat, 'dashboard_summary', { p_city_id: ids.city });
      console.log('пульт:', await readControl(api));
      console.log('дашборд (акимат, 30 дней):', JSON.stringify(summary, null, 2).slice(0, 2500));
      const path = await api.rpc(null, 'site_path', { p_site_id: ids.site('s05'), p_period_days: 7 });
      console.log('путь площадки s05: стадия', path?.latest?.stage, path?.latest?.stage_code, 'mixed_flag', path?.latest?.mixed_flag);
      break;
    }
    default:
      console.error(`Неизвестная команда ${cmd}\n` + readHelp());
      process.exit(2);
  }
  console.log(`готово за ${((Date.now() - t0) / 1000).toFixed(0)} с, запросов к API: ${callCount()}`);
}

function readHelp() {
  return `Симулятор «Қайда?»: node --experimental-strip-types simulator/src/cli.ts <all|seed|history|live|control|purge|check> [опции]
  см. simulator/README.md`;
}

main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
