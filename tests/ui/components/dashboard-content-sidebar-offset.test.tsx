import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DashboardContent } from '@/components/layout/DashboardContent';

const authState = {
  isManager: false,
  isAdmin: false,
  isActualSuperAdmin: false,
};
const tabletState = {
  tabletModeEnabled: false,
};

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => authState,
}));

vi.mock('@/components/layout/tablet-mode-context', () => ({
  useTabletMode: () => ({
    tabletModeEnabled: tabletState.tabletModeEnabled,
  }),
}));

describe('DashboardContent sidebar offset', () => {
  beforeEach(() => {
    authState.isManager = false;
    authState.isAdmin = false;
    authState.isActualSuperAdmin = false;
    tabletState.tabletModeEnabled = false;
  });

  it('does not add sidebar offset for standard users', () => {
    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain('md:pl-16');
  });

  it('adds sidebar offset for admin users', () => {
    authState.isAdmin = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('md:pl-16');
  });

  it('adds sidebar offset for manager users', () => {
    authState.isManager = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('md:pl-16');
  });

  it('adds sidebar offset for superadmin users', () => {
    authState.isActualSuperAdmin = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('md:pl-16');
  });

  it('does not add sidebar offset in tablet mode', () => {
    authState.isManager = true;
    tabletState.tabletModeEnabled = true;

    const { container } = render(
      <DashboardContent>
        <div>content</div>
      </DashboardContent>
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain('md:pl-16');
  });
});
