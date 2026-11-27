// Проверка: ключи ru.json и kk.json совпадают (все тексты — через файлы переводов).
import fs from 'node:fs';
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, p + k + '.') : [p + k]));
const ru = new Set(flat(JSON.parse(fs.readFileSync(new URL('../src/messages/ru.json', import.meta.url)))));
const kk = new Set(flat(JSON.parse(fs.readFileSync(new URL('../src/messages/kk.json', import.meta.url)))));
const miss = [...[...ru].filter((k) => !kk.has(k)).map((k) => 'kk: ' + k), ...[...kk].filter((k) => !ru.has(k)).map((k) => 'ru: ' + k)];
if (miss.length) { console.error('Нет перевода:\n' + miss.join('\n')); process.exit(1); }
console.log(`i18n: ${ru.size} ключей, ru = kk ✅`);
