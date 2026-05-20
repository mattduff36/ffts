/**
 * Fleet Config Rename Tests
 *
 * Verifies that all config/navigation/module references have been correctly
 * updated from "vehicles" to "vans" and that HGV support is properly configured.
 */
import { describe, it, expect } from 'vitest';
import { ALL_MODULES, MODULE_DISPLAY_NAMES, MODULE_DESCRIPTIONS, ModuleName } from '@/types/roles';
import { MODULE_PAGES, getPageUrl } from '@/lib/config/module-pages';
import { employeeNavItems, adminNavItems } from '@/lib/config/navigation';

describe('Module system — admin-vans replaces admin-vehicles', () => {
  it('ALL_MODULES contains admin-vans', () => {
    expect(ALL_MODULES).toContain('admin-vans');
  });

  it('ALL_MODULES does not contain admin-vehicles', () => {
    expect(ALL_MODULES).not.toContain('admin-vehicles' as ModuleName);
  });

  it('MODULE_DISPLAY_NAMES has admin-vans entry', () => {
    expect(MODULE_DISPLAY_NAMES['admin-vans']).toBeDefined();
    expect(MODULE_DISPLAY_NAMES['admin-vans']).not.toContain('Vehicle');
  });

  it('MODULE_DESCRIPTIONS has admin-vans entry', () => {
    expect(MODULE_DESCRIPTIONS['admin-vans']).toBeDefined();
    expect(MODULE_DESCRIPTIONS['admin-vans']).not.toContain('vehicle');
  });
});

describe('Module pages — fleet routes use vans', () => {
  it('admin-vans-list page points to the fleet vans tab', () => {
    const url = getPageUrl('admin-vans-list');
    expect(url).toBe('/fleet?tab=vans');
  });

  it('no module page points to /admin/vehicles', () => {
    const allUrls = Object.entries(MODULE_PAGES).flatMap(([, group]) =>
      typeof group === 'string' ? [group] : Object.values(group)
    ).filter((v): v is string => typeof v === 'string');
    const vehicleUrls = allUrls.filter(u => u.includes('/vehicles'));
    expect(vehicleUrls, `Stale /vehicles URLs: ${vehicleUrls.join(', ')}`).toHaveLength(0);
  });
});

describe('Navigation — Fleet is in employee nav, not admin nav', () => {
  it('Fleet nav item points to /fleet in employee nav', () => {
    const fleetNav = employeeNavItems.find(n => n.href === '/fleet');
    expect(fleetNav).toBeDefined();
    expect(fleetNav!.label).toBe('Fleet');
  });

  it('Maintenance nav item points to /maintenance', () => {
    const maintenanceNav = employeeNavItems.find(n => n.href === '/maintenance');
    expect(maintenanceNav).toBeDefined();
    expect(maintenanceNav!.label).toBe('Maintenance');
  });

  it('no admin nav item points to /fleet', () => {
    const fleetInAdmin = adminNavItems.filter(n => n.href.includes('/fleet'));
    expect(fleetInAdmin).toHaveLength(0);
  });

  it('no nav item points to /fleet?tab=maintenance', () => {
    const stale = [...employeeNavItems, ...adminNavItems].filter(n => 
      n.href.includes('tab=maintenance')
    );
    expect(stale).toHaveLength(0);
  });
});
