import { WASTE_TYPES, ROLES } from '@kaida/contracts';
import type { EntityConfig } from '@/components/CrudTable';

/** Справочники админки (ТЗ 11.3). Подписи — ключи i18n f.<поле>. */
const FACILITY_TYPES = ['sorting', 'recycling', 'landfill', 'collection_point', 'composting', 'energy'] as const;

export const ENTITIES: Record<string, EntityConfig> = {
  sites: {
    table: 'sites', titleKey: 'admin.sites', order: { column: 'address' },
    fields: [
      { key: 'address', type: 'text', required: true },
      { key: 'residential_complex', type: 'text' },
      { key: 'district_id', type: 'fk', fk: { table: 'districts', label: 'name_ru' }, required: true },
      { key: 'location', type: 'point', required: true },
      { key: 'qr_code', type: 'text', table: true, readOnly: true },
      { key: 'cleanliness_score', type: 'number', readOnly: true },
      { key: 'is_active', type: 'bool', table: false, default: true },
    ],
  },
  containers: {
    table: 'containers', titleKey: 'admin.containers', order: { column: 'waste_type' },
    fields: [
      { key: 'waste_type', type: 'enum', options: WASTE_TYPES, optionsI18n: 'waste', required: true },
      { key: 'volume_l', type: 'number', default: 1100, required: true },
      { key: 'fill_level', type: 'number', default: 0 },
      { key: 'qr_code', type: 'text' },
      { key: 'is_active', type: 'bool', default: true },
    ],
  },
  facilities: {
    table: 'facilities', titleKey: 'admin.facilities', order: { column: 'name' },
    fields: [
      { key: 'name', type: 'text', required: true },
      { key: 'type', type: 'enum', options: FACILITY_TYPES, optionsI18n: 'facilityType', required: true },
      { key: 'city_id', type: 'fk', fk: { table: 'cities', label: 'name_ru' } },
      { key: 'address', type: 'text' },
      { key: 'location', type: 'point', required: true },
      { key: 'accepted_waste_types', type: 'enum[]', options: WASTE_TYPES, optionsI18n: 'waste' },
      { key: 'capacity_tpd', type: 'number' },
      { key: 'geofence_radius_m', type: 'number', default: 300 },
      { key: 'opening_hours', type: 'json', table: false },
      { key: 'model_3d_url', type: 'text', table: false },
      { key: 'is_active', type: 'bool', table: false, default: true },
    ],
  },
  carriers: {
    table: 'carriers', titleKey: 'admin.carriers', order: { column: 'name' },
    fields: [
      { key: 'name', type: 'text', required: true },
      { key: 'bin', type: 'text' },
      { key: 'phone', type: 'text' },
      { key: 'city_id', type: 'fk', fk: { table: 'cities', label: 'name_ru' } },
    ],
  },
  vehicles: {
    table: 'vehicles', titleKey: 'admin.vehicles', order: { column: 'plate_number' },
    fields: [
      { key: 'plate_number', type: 'text', required: true },
      { key: 'carrier_id', type: 'fk', fk: { table: 'carriers', label: 'name' }, required: true },
      { key: 'vehicle_type', type: 'text', default: 'rear_loader' },
      { key: 'capacity_kg', type: 'number' },
      { key: 'driver_id', type: 'text' },
      { key: 'is_active', type: 'bool', default: true },
    ],
  },
  routes: {
    table: 'routes', titleKey: 'admin.routes', order: { column: 'route_date', ascending: false },
    fields: [
      { key: 'route_date', type: 'date', required: true },
      { key: 'vehicle_id', type: 'fk', fk: { table: 'vehicles', label: 'plate_number' }, required: true },
      { key: 'waste_type', type: 'enum', options: WASTE_TYPES, optionsI18n: 'waste', required: true },
      { key: 'site_ids', type: 'fk[]', fk: { table: 'sites', label: 'address' } },
      { key: 'planned_facility_id', type: 'fk', fk: { table: 'facilities', label: 'name' } },
    ],
  },
  cities: {
    table: 'cities', titleKey: 'admin.cities', order: { column: 'name_ru' },
    fields: [
      { key: 'name_ru', type: 'text', required: true },
      { key: 'name_kk', type: 'text' },
      { key: 'slug', type: 'text', required: true },
      { key: 'timezone', type: 'text', default: 'Asia/Almaty' },
    ],
  },
  districts: {
    table: 'districts', titleKey: 'admin.districts', order: { column: 'name_ru' },
    fields: [
      { key: 'name_ru', type: 'text', required: true },
      { key: 'name_kk', type: 'text' },
      { key: 'city_id', type: 'fk', fk: { table: 'cities', label: 'name_ru' }, required: true },
    ],
  },
  rules: {
    table: 'waste_rules', titleKey: 'admin.rules', order: { column: 'sort_order' },
    fields: [
      { key: 'ai_class', type: 'text', required: true },
      { key: 'label_ru', type: 'text', required: true },
      { key: 'label_kk', type: 'text', required: true },
      { key: 'bin', type: 'enum', labelKey: 'f.bin_type', options: WASTE_TYPES, optionsI18n: 'waste', required: true },
      { key: 'is_recyclable', type: 'bool' },
      { key: 'special_handling', type: 'bool' },
      { key: 'hint_ru', type: 'textarea', table: false },
      { key: 'hint_kk', type: 'textarea', table: false },
      { key: 'usage_ru', type: 'textarea', table: false },
      { key: 'usage_kk', type: 'textarea', table: false },
      { key: 'color', type: 'color' },
      { key: 'city_id', type: 'fk', fk: { table: 'cities', label: 'name_ru' } },
      { key: 'sort_order', type: 'number', table: false },
    ],
  },
  bonus: {
    table: 'bonus_rules', titleKey: 'admin.bonus', order: { column: 'code' },
    fields: [
      { key: 'code', type: 'text', required: true },
      { key: 'waste_type', type: 'enum', options: WASTE_TYPES, optionsI18n: 'waste' },
      { key: 'rate_per_kg', type: 'number' },
      { key: 'fixed_amount', type: 'number' },
      { key: 'params', type: 'json' },
      { key: 'is_active', type: 'bool', default: true },
    ],
  },
  settings: {
    table: 'app_settings', titleKey: 'admin.settings', pk: 'key', order: { column: 'key' },
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'value', type: 'json', required: true },
      { key: 'description', type: 'text' },
    ],
  },
};

export const ADMIN_TABS = ['sites', 'facilities', 'carriers', 'vehicles', 'routes', 'cities', 'districts', 'rules', 'bonus', 'payouts', 'users', 'qr', 'settings', 'simulator'] as const;
export { ROLES };
