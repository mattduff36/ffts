/**
 * Plant Inspection Checklists Configuration
 * 
 * This file defines inspection checklist items for plant machinery/equipment.
 * Based on the physical Plant Inspection Pad form, extended with current checklist additions.
 */

/**
 * Standard plant inspection checklist (23 items)
 * Based on the operated plant inspection pad form
 */
export const PLANT_INSPECTION_ITEMS = [
  'Oil, fuel & coolant levels/leaks',
  'Wheels & nuts',
  'Tyres/Tracks',
  'Windows & Wipers',
  'Mirrors',
  'Steps & Handrails',
  'Lights/Flashing Beacons',
  'Instrument Gauges/Horns',
  'Seat Belt',
  'Fire Extinguisher',
  'TV Camera',
  'Body-Up Buzzer',
  'Steering',
  'Reverse Alarm',
  'Parking Brake',
  'Brake Test',
  'Hoses/Overload Devices',
  'Lifting Attachments',
  'Lift & Crowd Operation',
  'Blade/Bucket',
  'Spill Kit',
  'Greased',
  'Transmission',
];

/**
 * Get the plant inspection checklist items
 * @returns Array of inspection item descriptions for plant
 */
export function getPlantChecklist(): string[] {
  return PLANT_INSPECTION_ITEMS;
}

/**
 * Get the number of items in the plant checklist
 * @returns Total number of checklist items
 */
export function getPlantChecklistCount(): number {
  return PLANT_INSPECTION_ITEMS.length;
}
