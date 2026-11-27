/**
 * Сиды Астаны (ТЗ 14): район «Есиль», 25 контейнерных площадок, объекты, перевозчики, машины.
 *
 * Адреса — настоящие улицы левобережья; координаты приблизительные (в пределах квартала),
 * их можно уточнить точкой на карте в админке. Объекты и перевозчики — тестовые,
 * помечены «(тест)»: реальных данных перевозчиков и заводов пока нет.
 * Координаты — [lon, lat] (WGS 84).
 */
import type { WasteType } from '../src/model.ts';

export const CITY = {
  slug: 'astana', name_ru: 'Астана', name_kk: 'Астана', timezone: 'Asia/Almaty',
  center: [71.4304, 51.1282] as [number, number],
};

export const DISTRICT = { name_ru: 'Есиль', name_kk: 'Есіл' };

/** Граница района — упрощённый полигон левобережья (для фильтра дашборда и карты) */
export const DISTRICT_BOUNDARY: [number, number][] = [
  [71.385, 51.145], [71.470, 51.140], [71.480, 51.080], [71.390, 51.075], [71.385, 51.145],
];

export interface SiteSeed {
  key: string;
  address: string;
  lonlat: [number, number];
  /** типы контейнеров на площадке (mixed есть всегда) */
  containers: WasteType[];
  /** «грязная» площадка: в раздельные контейнеры часто кладут чужое (сценарий нарушений) */
  dirty?: boolean;
}

export const SITES: SiteSeed[] = [
  { key: 's01', address: 'ул. Достык, 5',                     lonlat: [71.4282, 51.1281], containers: ['mixed', 'plastic', 'paper'] },
  { key: 's02', address: 'ул. Достык, 13',                    lonlat: [71.4255, 51.1248], containers: ['mixed', 'plastic', 'glass'] },
  { key: 's03', address: 'пр. Кабанбай батыра, 11',           lonlat: [71.4180, 51.1236], containers: ['mixed', 'plastic', 'paper', 'glass'] },
  { key: 's04', address: 'пр. Кабанбай батыра, 21',           lonlat: [71.4226, 51.1180], containers: ['mixed', 'plastic'] },
  { key: 's05', address: 'пр. Кабанбай батыра, 43',           lonlat: [71.4296, 51.1112], containers: ['mixed', 'plastic', 'paper'], dirty: true },
  { key: 's06', address: 'пр. Кабанбай батыра, 53',           lonlat: [71.4352, 51.1065], containers: ['mixed', 'plastic', 'paper', 'metal'] },
  { key: 's07', address: 'ул. Сыганак, 10',                   lonlat: [71.4120, 51.1172], containers: ['mixed', 'plastic', 'glass'] },
  { key: 's08', address: 'ул. Сыганак, 25',                   lonlat: [71.4245, 51.1158], containers: ['mixed', 'paper'] },
  { key: 's09', address: 'ул. Сыганак, 47',                   lonlat: [71.4390, 51.1142], containers: ['mixed', 'plastic', 'paper', 'glass'] },
  { key: 's10', address: 'пр. Туран, 19',                     lonlat: [71.4122, 51.1290], containers: ['mixed', 'plastic'] },
  { key: 's11', address: 'пр. Туран, 37',                     lonlat: [71.4108, 51.1205], containers: ['mixed', 'plastic', 'paper'], dirty: true },
  { key: 's12', address: 'пр. Туран, 55',                     lonlat: [71.4090, 51.1118], containers: ['mixed', 'plastic', 'glass', 'metal'] },
  { key: 's13', address: 'ул. Орынбор, 8',                    lonlat: [71.4165, 51.1093], containers: ['mixed', 'paper'] },
  { key: 's14', address: 'ул. Орынбор, 20',                   lonlat: [71.4280, 51.1086], containers: ['mixed', 'plastic', 'paper'] },
  { key: 's15', address: 'ул. Хусейн бен Талал, 25',          lonlat: [71.4198, 51.1031], containers: ['mixed', 'plastic', 'glass'] },
  { key: 's16', address: 'ул. Хусейн бен Талал, 39',          lonlat: [71.4310, 51.1022], containers: ['mixed', 'plastic', 'paper', 'glass'] },
  { key: 's17', address: 'ул. Керей, Жанибек хандар, 14',     lonlat: [71.4402, 51.1003], containers: ['mixed', 'plastic'], dirty: true },
  { key: 's18', address: 'ул. Керей, Жанибек хандар, 28',     lonlat: [71.4475, 51.0988], containers: ['mixed', 'plastic', 'paper'] },
  { key: 's19', address: 'пр. Мангилик Ел, 19',               lonlat: [71.4402, 51.1110], containers: ['mixed', 'plastic', 'glass'] },
  { key: 's20', address: 'пр. Мангилик Ел, 33',               lonlat: [71.4425, 51.1050], containers: ['mixed', 'paper', 'metal'] },
  { key: 's21', address: 'пр. Мангилик Ел, 47',               lonlat: [71.4445, 51.0960], containers: ['mixed', 'plastic', 'paper', 'glass'] },
  { key: 's22', address: 'ул. Акмешит, 9',                    lonlat: [71.4235, 51.1195], containers: ['mixed', 'plastic'] },
  { key: 's23', address: 'ул. Акмешит, 17',                   lonlat: [71.4300, 51.1185], containers: ['mixed', 'plastic', 'paper'] },
  { key: 's24', address: 'ул. Сауран, 5',                     lonlat: [71.4160, 51.1140], containers: ['mixed', 'glass'] },
  { key: 's25', address: 'ул. Сауран, 20',                    lonlat: [71.4205, 51.1075], containers: ['mixed', 'plastic', 'paper'] },
];

export type FacilityKey = 'sorting' | 'rec_pet' | 'rec_paper' | 'landfill' | 'cp1' | 'cp2' | 'cp3';

export interface FacilitySeed {
  key: FacilityKey;
  type: 'sorting' | 'recycling' | 'landfill' | 'collection_point' | 'composting' | 'energy';
  name: string;
  address: string;
  lonlat: [number, number];
  accepted: WasteType[];
  capacity_tpd?: number;
  opening_hours?: Record<string, string>;
}

const HOURS = { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: '10:00-16:00' };

export const FACILITIES: FacilitySeed[] = [
  { key: 'sorting', type: 'sorting', name: 'Сортировочный комплекс (тест)', address: 'промзона, юго-восток', lonlat: [71.5310, 51.0710],
    accepted: ['mixed', 'plastic', 'paper', 'glass', 'metal'], capacity_tpd: 600 },
  { key: 'rec_pet', type: 'recycling', name: 'Переработчик ПЭТ и полимеров (тест)', address: 'индустриальный парк', lonlat: [71.3720, 51.1830],
    accepted: ['plastic'], capacity_tpd: 40 },
  { key: 'rec_paper', type: 'recycling', name: 'Переработчик макулатуры (тест)', address: 'промзона, восток', lonlat: [71.5180, 51.1490],
    accepted: ['paper'], capacity_tpd: 60 },
  { key: 'landfill', type: 'landfill', name: 'Полигон ТБО (тест)', address: 'за городом, юго-восток', lonlat: [71.5900, 51.0300],
    accepted: ['mixed', 'plastic', 'paper', 'glass', 'metal', 'organic'], capacity_tpd: 1500 },
  { key: 'cp1', type: 'collection_point', name: 'Пункт приёма «Есиль» (тест)', address: 'ул. Сыганак, 32', lonlat: [71.4310, 51.1150],
    accepted: ['plastic', 'paper', 'glass', 'metal'], opening_hours: HOURS },
  { key: 'cp2', type: 'collection_point', name: 'Пункт приёма «Туран» (тест)', address: 'пр. Туран, 44', lonlat: [71.4098, 51.1170],
    accepted: ['plastic', 'paper', 'metal'], opening_hours: HOURS },
  { key: 'cp3', type: 'collection_point', name: 'Пункт приёма «Мангилик Ел» (тест)', address: 'пр. Мангилик Ел, 40', lonlat: [71.4436, 51.1000],
    accepted: ['plastic', 'glass', 'paper'], opening_hours: HOURS },
];

/** Базы перевозчиков — точка старта рейса (не объекты цепочки, поэтому не в facilities) */
export const DEPOTS: Record<'c1' | 'c2', [number, number]> = { c1: [71.4720, 51.0880], c2: [71.3950, 51.1450] };

export const CARRIERS = [
  { key: 'c1', name: 'ТОО «ЭкоВывоз Астана» (тест)', bin: '000000000001', phone: '+7 700 000 0001' },
  { key: 'c2', name: 'ТОО «ТазаКала Сервис» (тест)', bin: '000000000002', phone: '+7 700 000 0002' },
] as const;

export interface VehicleSeed {
  key: string;
  carrier: 'c1' | 'c2';
  plate: string;
  type: string;
  capacity_kg: number;
  /** номер демо-водителя demo.driver.<n> */
  driver: number;
  /** тип рейса по дням: функция от дня недели (0 = вс) */
  plan: (weekday: number) => WasteType | null;
  /** какие площадки обслуживает (ключи SITES); для раздельных — только где есть контейнер этого типа */
  sites: string[] | 'all';
}

const mixedA = ['s01', 's02', 's03', 's10', 's22', 's23', 's04', 's07', 's24'];
const mixedB = ['s05', 's06', 's08', 's09', 's19', 's14', 's13', 's11'];
const mixedC = ['s12', 's15', 's16', 's17', 's18', 's20', 's21', 's25'];

export const VEHICLES: VehicleSeed[] = [
  { key: 'v1', carrier: 'c1', plate: '001 AST 01', type: 'rear_loader', capacity_kg: 8000, driver: 1, plan: () => 'mixed', sites: mixedA },
  { key: 'v2', carrier: 'c1', plate: '002 AST 01', type: 'rear_loader', capacity_kg: 8000, driver: 2, plan: () => 'mixed', sites: mixedB },
  { key: 'v3', carrier: 'c2', plate: '101 TKS 01', type: 'side_loader', capacity_kg: 10000, driver: 3, plan: () => 'mixed', sites: mixedC },
  { key: 'v4', carrier: 'c2', plate: '102 TKS 01', type: 'rear_loader', capacity_kg: 6000, driver: 4,
    plan: (wd) => (wd === 0 ? null : 'plastic'), sites: 'all' },
  { key: 'v5', carrier: 'c1', plate: '003 AST 01', type: 'rear_loader', capacity_kg: 6000, driver: 5,
    plan: (wd) => (wd === 0 ? 'metal' : wd % 2 === 1 ? 'paper' : 'glass'), sites: 'all' },
];

/** Объёмы контейнеров, л */
export const VOLUME_L: Record<WasteType, number> = { mixed: 1100, plastic: 1100, paper: 1100, glass: 660, metal: 660, organic: 240 };

/** Аккаунты (демо-вход по роли и номеру) */
export const ACCOUNTS = { admin: 1, akimat: 1, driver: 5, operator: 3, resident: 20 } as const;
/** operator 1 — сортировка, 2 — переработчик ПЭТ, 3 — пункт приёма «Есиль» */
export const OPERATOR_FACILITY: Record<number, FacilityKey> = { 1: 'sorting', 2: 'rec_pet', 3: 'cp1' };
