/**
 * Van Inspection Checklists Configuration
 * 
 * This file defines inspection checklist items for different vehicle categories.
 * To add a new checklist or modify an existing one, update the appropriate array below.
 */

export type VehicleCategory = 'Artic' | 'Trailer' | 'Truck' | 'Van';

// Truck/Artic/Trailer checklist (26 items)
const TRUCK_CHECKLIST_ITEMS = [
  'Fuel - and ad-blu',
  'Mirrors - includes Class V & Class VI',
  'Safety Equipment - Cameras & Audible Alerts',
  'Warning Signage - VRU Sign',
  'FORS Stickers',
  'Oil',
  'Water',
  'Battery',
  'Tyres',
  'Brakes',
  'Steering',
  'Lights',
  'Reflectors',
  'Indicators',
  'Wipers',
  'Washers',
  'Horn',
  'Markers',
  'Sheets / Ropes / Chains',
  'Security of Load',
  'Side underbar/Rails',
  'Transmission',
  'Brake Hoses',
  'Couplings Secure',
  'Electrical Connections',
  'Trailer No. Plate',
];

const HGV_ARTIC_ONLY_START_ITEM = 23;
const HGV_ARTIC_ONLY_END_ITEM = TRUCK_CHECKLIST_ITEMS.length;

// Van checklist (15 items)
const VAN_CHECKLIST_ITEMS = [
  'Oil, Fuel & Coolant Levels/Leaks',
  'Wheels & Nuts',
  'Tyres',
  'Windows & Wipers',
  'Mirrors',
  'Visual Body Condition',
  'Lights/Flashing Beacons',
  'Instrument Gauges/Horns',
  'Seat Belt',
  'Visual Interior Condition',
  'Locking Devices',
  'Steering',
  'Parking Brake',
  'Brake Test',
  'Transmission',
];

/**
 * Maps vehicle categories to their inspection checklist items
 */
const VEHICLE_CHECKLISTS: Record<VehicleCategory, string[]> = {
  Artic: TRUCK_CHECKLIST_ITEMS,
  Trailer: TRUCK_CHECKLIST_ITEMS,
  Truck: TRUCK_CHECKLIST_ITEMS,
  Van: VAN_CHECKLIST_ITEMS,
};

/**
 * Get the inspection checklist items for a specific vehicle category
 * @param category - The vehicle category (e.g., 'Artic', 'Van', etc.)
 * @returns Array of inspection item descriptions
 */
export function getChecklistForCategory(category: string): string[] {
  // Normalize category string (case-insensitive match)
  const normalizedCategory = category as VehicleCategory;
  
  // Return the appropriate checklist or default to truck checklist
  return VEHICLE_CHECKLISTS[normalizedCategory] || TRUCK_CHECKLIST_ITEMS;
}

/**
 * Check if a vehicle category uses the Van checklist
 * @param category - The vehicle category
 * @returns True if the category uses the Van checklist
 */
export function isVanCategory(category: string): boolean {
  return category === 'Van';
}

/**
 * Legacy export for backward compatibility
 * @deprecated Use getChecklistForCategory() instead
 */
export const INSPECTION_ITEMS = TRUCK_CHECKLIST_ITEMS;

// Named exports for specific checklists
export { TRUCK_CHECKLIST_ITEMS, VAN_CHECKLIST_ITEMS, HGV_ARTIC_ONLY_START_ITEM, HGV_ARTIC_ONLY_END_ITEM };


