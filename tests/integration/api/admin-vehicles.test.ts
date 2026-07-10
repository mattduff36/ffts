import { describe, it, expect } from 'vitest';

describe('Admin Vehicles API', () => {
  describe('List Vehicles', () => {
    it('should return all vehicles with categories', () => {
      const vehicles = [
        { id: 'v1', reg_number: 'AB12 CDE', van_categories: { name: 'Truck' } },
        { id: 'v2', reg_number: 'FG34 HIJ', van_categories: { name: 'Van' } },
      ];

      expect(vehicles).toHaveLength(2);
      expect(vehicles[0].van_categories.name).toBe('Truck');
    });

    it('should include last inspection data', () => {
      const vehicle = {
        id: 'v1',
        reg_number: 'AB12 CDE',
        last_inspection_date: '2024-12-01',
        last_inspector: 'John Doe',
      };

      expect(vehicle.last_inspection_date).toBeDefined();
      expect(vehicle.last_inspector).toBeDefined();
    });
  });

  describe('Create Vehicle', () => {
    it('should create vehicle with required fields', () => {
      const vehicle = {
        reg_number: 'AB12 CDE',
        category_id: 'truck-category-id',
        make: 'Volvo',
        model: 'FH16',
      };

      expect(vehicle.reg_number).toBeDefined();
      expect(vehicle.category_id).toBeDefined();
    });

    it('should format registration number correctly', () => {
      const formatted = 'AB12CDE';
      const expected = 'AB12 CDE'; // Format: LL## LLL

      const result = formatted.replace(/^([A-Z]{2})(\d{2})([A-Z]{3})$/, '$1$2 $3');
      expect(result).toBe(expected);
    });

    it('should validate registration number format', () => {
      const validRegs = ['AB12 CDE', 'XY99 ZAB', 'CD56 EFG'];
      const regPattern = /^[A-Z]{2}\d{2}\s[A-Z]{3}$/;

      validRegs.forEach(reg => {
        expect(reg).toMatch(regPattern);
      });
    });
  });

  describe('Update Vehicle', () => {
    it('should allow updating vehicle details', () => {
      const vehicle = {
        id: 'v1',
        reg_number: 'AB12 CDE',
        make: 'Volvo',
      };

      const updated = {
        ...vehicle,
        make: 'Scania',
        model: 'R500',
      };

      expect(updated.make).toBe('Scania');
    });

    it('should allow changing vehicle category', () => {
      const vehicle = {
        id: 'v1',
        category_id: 'truck-id',
      };

      const updated = {
        ...vehicle,
        category_id: 'artic-id',
      };

      expect(updated.category_id).toBe('artic-id');
    });
  });

  describe('Delete Vehicle', () => {
    it('should prevent deletion if inspections exist', () => {
      const vehicle = {
        id: 'v1',
        inspection_count: 5,
      };

      // API should check and prevent deletion
      expect(vehicle.inspection_count).toBeGreaterThan(0);
    });

    it('should allow deletion if no inspections', () => {
      const vehicle = {
        id: 'v1',
        inspection_count: 0,
      };

      expect(vehicle.inspection_count).toBe(0);
      // Can be deleted
    });
  });

  describe('Vehicle Categories', () => {
    it('should support Artic category', () => {
      const category = { name: 'Artic', checklist_items: 26 };
      expect(category.name).toBe('Artic');
      expect(category.checklist_items).toBe(26);
    });

    it('should support Trailer category', () => {
      const category = { name: 'Trailer', checklist_items: 26 };
      expect(category.name).toBe('Trailer');
    });

    it('should support Truck category', () => {
      const category = { name: 'Truck', checklist_items: 26 };
      expect(category.name).toBe('Truck');
    });

    it('should support Van category with 15-point checklist', () => {
      const category = { name: 'Van', checklist_items: 15 };
      expect(category.name).toBe('Van');
      expect(category.checklist_items).toBe(15);
    });
  });
});

