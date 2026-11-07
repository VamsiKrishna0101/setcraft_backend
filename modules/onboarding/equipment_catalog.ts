import { z } from 'zod';
import { Equipment } from '@prisma/client';

// Stable IDs shared with the mobile catalog; images never determine access.
export const EQUIPMENT_CATEGORIES = {
  bodyweight_only: Equipment.OTHER,
  dumbbells: Equipment.DUMBBELLS,
  barbell: Equipment.BARBELLS,
  squat_rack: Equipment.OTHER,
  adjustable_bench: Equipment.BENCH,
  kettlebells: Equipment.OTHER,
  resistance_bands: Equipment.OTHER,
  pullup_bar: Equipment.OTHER,
  dip_bars: Equipment.OTHER,
  cable_station: Equipment.CABLE,
  smith_machine: Equipment.MACHINES,
  leg_press: Equipment.MACHINES,
  hack_squat: Equipment.MACHINES,
  chest_press: Equipment.MACHINES,
  shoulder_press: Equipment.MACHINES,
  leg_extension: Equipment.MACHINES,
  leg_curl: Equipment.MACHINES,
  lat_pulldown: Equipment.MACHINES,
  seated_row: Equipment.MACHINES,
  pec_deck: Equipment.MACHINES,
  rear_delt: Equipment.MACHINES,
  assisted_pullup_dip: Equipment.MACHINES,
} as const;
export const equipmentIdsSchema = z.array(z.enum(Object.keys(EQUIPMENT_CATEGORIES) as
  [keyof typeof EQUIPMENT_CATEGORIES, ...(keyof typeof EQUIPMENT_CATEGORIES)[]]))
  .min(1).max(22)
  .refine(ids => new Set(ids).size === ids.length, 'Equipment choices must be unique')
  .refine(ids => !ids.includes('bodyweight_only') || ids.length === 1,
    'No equipment cannot be combined with equipment choices');

export function equipmentCategories(ids: string[]): Equipment[] {
  return [...new Set(ids.map(id => EQUIPMENT_CATEGORIES[id as keyof typeof EQUIPMENT_CATEGORIES]))].sort();
}
