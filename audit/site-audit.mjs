// Аудит живого сайта перед финалом: скриншоты, ошибки консоли, битые ссылки, вылезание по ширине.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = 'https://khursandatajanovai.github.io/orleu-hack-2026-elim-ai/';
const PREFIX = '/orleu-hack-2026-elim-ai/';
const OUT = process.env.OUT || 'audit/out'; fs.mkdirSync(OUT, { recursive: true });
const report = [];
const linkSet = new Map();
const log = (o) => { report.push(o); console.log(JSON.stringify(o)); };

async function visit(page, name, path, extraWait = 3500) {
  const errs = [], bad = [];
  const onErr = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); };
  const onPE = (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200));
  const onResp = (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 160)); };
  const onFail = (r) => bad.push('FAIL ' + (r.failure()?.errorText || '') + ' ' + r.url().slice(0, 160));
  page.on('console', onErr); page.on('pageerror', onPE); page.on('response', onResp); page.on('requestfailed', onFail);
  let status = null;
  try {
    const r = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(async (e) => { await page.waitForTimeout(5000); return null; });
    status = r?.status() ?? 'timeout-networkidle';
    await page.waitForTimeout(extraWait);
  } catch (e) { status = 'ERR ' + e.message.slice(0, 100); }
  const info = await page.evaluate((PREFIX) => {
    const de = document.documentElement;
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), abs: a.href, text: (a.textContent || '').trim().slice(0, 40) }));
    const wrongBase = links.filter((l) => l.href.startsWith('/') && !l.href.startsWith(PREFIX));
    // Элементы, вылезающие за ширину экрана
    const over = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 2 && getComputedStyle(el).position !== 'fixed') { over.push((el.tagName + '.' + (el.className?.toString?.() || '')).slice(0, 80)); if (over.length > 5) break; }
    }
    const imgsBroken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(0, 120));
    const untranslated = (document.body.innerText.match(/\b[a-z]+(\.[a-zA-Z]+)+\b/g) || []).filter((s) => !s.includes('github') && !s.includes('.io') && !s.includes('.kz') && !s.includes('.com')).slice(0, 10);
    return { title: document.title, h1: document.querySelector('h1')?.textContent?.trim(), scrollW: de.scrollWidth, clientW: de.clientWidth, links, wrongBase, over, imgsBroken, untranslated, text: document.body.innerText.slice(0, 1500) };
  }, PREFIX).catch((e) => ({ evalError: e.message }));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {});
  page.off('console', onErr); page.off('pageerror', onPE); page.off('response', onResp); page.off('requestfailed', onFail);
  for (const l of info.links || []) linkSet.set(l.abs, l.text);
  const { links, ...rest } = info;
  log({ name, path, status, errs: [...new Set(errs)].slice(0, 12), bad: [...new Set(bad)].slice(0, 12), ...rest });
  return info;
}

async function demoLogin(page, roleLabelIdx) {
  await page.goto(BASE + 'login/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // клик без согласия — проверяем, что видно сообщение
  const demoBtns = page.locator('.card').nth(1).locator('button');
  const n = await demoBtns.count();
  if (roleLabelIdx === 0) {
    await demoBtns.nth(0).click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/login-no-consent.png` });
  }
  await page.locator('input[type=checkbox]').first().check();
  await demoBtns.nth(roleLabelIdx).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login/'), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  return n;
}

const GUEST = ['', 'login/', 'scan/', 'map/', 'workshop/', 'recycling/', 'market/', 'shop/', 'bonuses/', 'dashboard/', 'driver/', 's/?q=TEST', 'api/', 'nonexistent-page/'];
const ROLES = [['resident', ['', 'scan/', 'bonuses/', 'shop/', 'map/']], ['driver', ['', 'driver/']], ['operator', ['', 'operator/']], ['akimat', ['', 'dashboard/', 'map/', 'workshop/']], ['admin', ['', 'admin/']]];

const browser = await chromium.launch();
for (const [vname, ctxOpts] of [['desk', { viewport: { width: 1440, height: 900 } }], ['mob', { ...devices['iPhone 13'] }], ['proj', { viewport: { width: 1280, height: 720 } }]]) {
  if (vname === 'proj') { // проектор 1280x720: только ключевые экраны демо
    const ctx = await browser.newContext(ctxOpts); const p = await ctx.newPage();
    for (const path of ['', 'map/', 'workshop/']) await visit(p, `${vname}-guest-${path.replace(/\W/g, '_') || 'home'}`, path, 8000);
    await ctx.close(); continue;
  }
  const ctx = await browser.newContext(ctxOpts); const p = await ctx.newPage();
  for (const path of GUEST) await visit(p, `${vname}-guest-${path.replace(/\W/g, '_') || 'home'}`, path, path.match(/map|workshop/) ? 8000 : 3500);
  await ctx.close();
  for (let i = 0; i < ROLES.length; i++) {
    const [role, paths] = ROLES[i];
    const c = await browser.newContext(ctxOpts); const pg = await c.newPage();
    try { const n = await demoLogin(pg, i); log({ name: `${vname}-login-${role}`, demoButtons: n, url: pg.url() }); } catch (e) { log({ name: `${vname}-login-${role}`, error: e.message.slice(0, 200) }); }
    for (const path of paths) await visit(pg, `${vname}-${role}-${path.replace(/\W/g, '_') || 'home'}`, path, path.match(/map|workshop|dashboard/) ? 8000 : 3500);
    await c.close();
  }
}
// Проверка всех найденных ссылок на сайт
const ctx = await browser.newContext(); const req = ctx.request;
for (const [abs, text] of linkSet) {
  if (!abs.startsWith('http')) continue;
  const r = await req.get(abs, { timeout: 20000, maxRedirects: 5 }).catch((e) => null);
  log({ link: abs, text, status: r ? r.status() : 'FAIL' });
}
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
