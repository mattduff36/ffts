/**
 * Route-to-Accent Resolver
 * 
 * Maps route paths to their corresponding accent color identifier.
 * Employee modules get their own module colors, while non-module areas use brand yellow.
 */

export type AccentType = 
  | 'timesheets'
  | 'inspections'
  | 'plant-inspections'
  | 'hgv-inspections'
  | 'rams'
  | 'absence'
  | 'maintenance'
  | 'fleet'
  | 'workshop'
  | 'inventory'
  | 'reminders'
  | 'reports'
  | 'debug'
  | 'brand'; // yellow for Dashboard, Manager/Admin, Help

/**
 * Determine the accent color for a given route
 * 
 * @param pathname - Current route pathname (e.g. "/timesheets")
 * @param searchParams - URL search parameters (for detecting tab queries)
 * @returns AccentType identifier
 */
export function getAccentFromRoute(
  pathname: string,
  searchParams?: URLSearchParams | null
): AccentType {
  void searchParams;
  // Normalize pathname
  const path = pathname.toLowerCase();

  // Employee module routes → module colors
  if (path.startsWith('/timesheets')) return 'timesheets';
  if (path.startsWith('/van-inspections')) return 'inspections';
  if (path.startsWith('/plant-inspections')) return 'plant-inspections';
  if (path.startsWith('/hgv-inspections')) return 'hgv-inspections';
  if (path.startsWith('/projects')) return 'rams';
  if (path.startsWith('/rams')) return 'rams';
  if (path.startsWith('/absence')) return 'absence';
  if (path.startsWith('/maintenance')) return 'maintenance';
  if (path.startsWith('/workshop-tasks')) return 'workshop';
  if (path.startsWith('/inventory')) return 'inventory';
  if (path.startsWith('/reminders')) return 'reminders';
  if (path.startsWith('/debug')) return 'debug';
  if (path.startsWith('/reports')) return 'reports';

  // Fleet pages → use fleet accent (rust/brick, distinct from maintenance red)
  if (path.startsWith('/fleet')) return 'fleet';

  // All other routes → brand yellow
  // This includes:
  // - /dashboard
  // - /help
  // - /approvals
  // - /actions
  // - /toolbox-talks
  // - /suggestions/manage
  // - /admin/*
  return 'brand';
}
