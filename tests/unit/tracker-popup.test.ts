import { describe, expect, it } from 'vitest';
import { buildTrackerPopupHtml } from '@/lib/utils/tracker-popup';

describe('buildTrackerPopupHtml', () => {
  it('includes van nickname on a new line under the registration', () => {
    const html = buildTrackerPopupHtml({
      regLabel: 'NV75 WYM',
      vrn: 'NV75 WYM',
      nickname: 'Frank Barlow',
      speed: 16,
      lastSeen: '26/05/2026, 11:43:05',
    });

    expect(html).toContain('<strong>NV75 WYM</strong><br/>');
    expect(html).toContain('[Frank Barlow]<br/>');
    expect(html).toContain('VRN: NV75 WYM<br/>');
    expect(html).toContain('Speed: 16 mph<br/>');
    expect(html).toContain('Last seen: 26/05/2026, 11:43:05');
  });

  it('omits nickname line when nickname is absent', () => {
    const html = buildTrackerPopupHtml({
      regLabel: 'P-101',
      vrn: 'P-101',
      speed: 0,
      lastSeen: '26/05/2026, 11:43:05',
    });

    expect(html).not.toContain('[');
    expect(html).toContain('<strong>P-101</strong><br/>');
  });

  it('escapes HTML in popup values', () => {
    const html = buildTrackerPopupHtml({
      regLabel: 'AB12 CDE',
      nickname: '<script>alert(1)</script>',
      speed: 0,
      lastSeen: 'today',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('[&lt;script&gt;alert(1)&lt;/script&gt;]');
  });
});
