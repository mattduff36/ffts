import { describe, it, expect } from 'vitest';
import {
  employeeNavItems,
  managerNavItems,
  adminNavItems,
  dashboardNavItem,
} from '@/lib/config/navigation';
import { FORM_TYPES, getEnabledForms, getFormType, getFormTypeByPath } from '@/lib/config/forms';
import { MODULE_PAGES, getAllPageOptions, getPageUrl } from '@/lib/config/module-pages';
import { getParentHref } from '@/lib/config/backNavigation';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';

describe('Navigation Config — Inspection Rename Verification', () => {
  it('has Van Inspections as separate nav item pointing to /van-inspections', () => {
    const vanNav = employeeNavItems.find(n => n.href === '/van-inspections');
    expect(vanNav).toBeDefined();
    expect(vanNav!.label).toMatch(/Van (Daily Checks|Inspections)/i);
    expect(vanNav!.module).toBe('inspections');
  });

  it('has Plant Inspections as separate nav item pointing to /plant-inspections', () => {
    const plantNav = employeeNavItems.find(n => n.href === '/plant-inspections');
    expect(plantNav).toBeDefined();
    expect(plantNav!.label).toMatch(/Plant (Daily Checks|Inspections)/i);
    expect(plantNav!.module).toBe('plant-inspections');
  });

  it('no nav item uses a dropdown for inspections', () => {
    const withDropdown = employeeNavItems.filter(n => n.dropdownItems && n.dropdownItems.length > 0);
    expect(withDropdown).toHaveLength(0);
  });

  it('no nav items reference /inspections (old path)', () => {
    const allHrefs = [
      ...employeeNavItems.map(n => n.href),
      ...managerNavItems.map(n => n.href),
      ...adminNavItems.map(n => n.href),
      dashboardNavItem.href,
    ];
    const oldPaths = allHrefs.filter(h => h === '/inspections' || h.startsWith('/inspections/'));
    expect(oldPaths).toHaveLength(0);
  });

  it('no nav labels contain "Vehicle Inspection"', () => {
    const allLabels = [
      ...employeeNavItems.map(n => n.label),
      ...managerNavItems.map(n => n.label),
      ...adminNavItems.map(n => n.label),
    ];
    const forbidden = allLabels.filter(l => /vehicle\s+inspection/i.test(l));
    expect(forbidden).toHaveLength(0);
  });
});

describe('Forms Config — Inspection Rename Verification', () => {
  it('has Van Inspections form type with /van-inspections href', () => {
    const vanForm = FORM_TYPES.find(f => f.id === 'inspection');
    expect(vanForm).toBeDefined();
    expect(vanForm!.title).toMatch(/Van (Daily Checks|Inspections)/i);
    expect(vanForm!.href).toBe('/van-inspections');
    expect(vanForm!.listHref).toBe('/van-inspections');
    expect(vanForm!.enabled).toBe(true);
  });

  it('has Plant Inspections form type with /plant-inspections href', () => {
    const plantForm = FORM_TYPES.find(f => f.id === 'plant-inspection');
    expect(plantForm).toBeDefined();
    expect(plantForm!.title).toMatch(/Plant (Daily Checks|Inspections)/i);
    expect(plantForm!.href).toBe('/plant-inspections');
    expect(plantForm!.listHref).toBe('/plant-inspections');
    expect(plantForm!.enabled).toBe(true);
  });

  it('no form title contains "Vehicle Inspection"', () => {
    const forbidden = FORM_TYPES.filter(f => /vehicle\s+inspection/i.test(f.title));
    expect(forbidden).toHaveLength(0);
  });

  it('workshop tasks description says "van" not "vehicle"', () => {
    const wsForm = FORM_TYPES.find(f => f.id === 'workshop');
    expect(wsForm).toBeDefined();
    expect(wsForm!.description.toLowerCase()).toContain('van');
    expect(wsForm!.description.toLowerCase()).not.toMatch(/\bvehicle\b/);
  });

  it('getFormType resolves inspection forms', () => {
    expect(getFormType('inspection')?.href).toBe('/van-inspections');
    expect(getFormType('plant-inspection')?.href).toBe('/plant-inspections');
  });

  it('getFormTypeByPath resolves correctly', () => {
    expect(getFormTypeByPath('/van-inspections')?.id).toBe('inspection');
    expect(getFormTypeByPath('/van-inspections/new')?.id).toBe('inspection');
    expect(getFormTypeByPath('/plant-inspections')?.id).toBe('plant-inspection');
    expect(getFormTypeByPath('/plant-inspections/new')?.id).toBe('plant-inspection');
  });

  it('getEnabledForms includes both inspection types', () => {
    const enabled = getEnabledForms();
    const ids = enabled.map(f => f.id);
    expect(ids).toContain('inspection');
    expect(ids).toContain('plant-inspection');
  });
});

describe('Module Pages Config', () => {
  it('inspection URLs map to /van-inspections', () => {
    expect(getPageUrl('inspections-list')).toBe('/van-inspections');
    expect(getPageUrl('inspections-new')).toBe('/van-inspections/new');
    expect(getPageUrl('inspections-view')).toBe('/van-inspections/[id]');
  });

  it('module pages include inspections entry', () => {
    const inspMod = MODULE_PAGES.find(m => m.module === 'inspections');
    expect(inspMod).toBeDefined();
    expect(inspMod!.subPages.length).toBeGreaterThan(0);
  });

  it('getAllPageOptions includes inspection pages', () => {
    const options = getAllPageOptions();
    const inspOptions = options.filter(o => o.value.startsWith('inspections-'));
    expect(inspOptions.length).toBeGreaterThan(0);
  });
});

describe('Back Navigation', () => {
  it('/van-inspections/new goes back to /van-inspections', () => {
    expect(getParentHref('/van-inspections/new')).toBe('/van-inspections');
  });

  it('/van-inspections/[id] goes back to /van-inspections', () => {
    expect(getParentHref('/van-inspections/some-uuid')).toBe('/van-inspections');
  });

  it('does not reference old /inspections path', () => {
    const testPaths = [
      '/van-inspections', '/van-inspections/new', '/van-inspections/abc',
      '/plant-inspections', '/plant-inspections/new', '/plant-inspections/abc',
    ];
    for (const p of testPaths) {
      const parent = getParentHref(p);
      expect(parent).not.toBe('/inspections');
      expect(parent).not.toMatch(/^\/inspections\//);
    }
  });
});

describe('Accent From Route', () => {
  it('inspection routes return their specific accents', () => {
    expect(getAccentFromRoute('/van-inspections')).toBe('inspections');
    expect(getAccentFromRoute('/van-inspections/new')).toBe('inspections');
    expect(getAccentFromRoute('/van-inspections/some-id')).toBe('inspections');
    expect(getAccentFromRoute('/plant-inspections')).toBe('plant-inspections');
    expect(getAccentFromRoute('/hgv-inspections')).toBe('hgv-inspections');
  });

  it('other modules return their own accents (regression)', () => {
    expect(getAccentFromRoute('/timesheets')).toBe('timesheets');
    expect(getAccentFromRoute('/dashboard')).toBe('brand');
    expect(getAccentFromRoute('/fleet')).toBe('fleet');
    expect(getAccentFromRoute('/inventory')).toBe('inventory');
    expect(getAccentFromRoute('/reports')).toBe('reports');
    expect(getAccentFromRoute('/debug')).toBe('debug');
    expect(getAccentFromRoute('/debug?tab=notification-settings')).toBe('debug');
  });
});
