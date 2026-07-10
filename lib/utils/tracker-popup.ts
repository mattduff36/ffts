export function escapeTrackerPopupHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface TrackerPopupOptions {
  regLabel: string;
  vrn?: string;
  nickname?: string | null;
  speed?: number | null;
  lastSeen: string;
}

export function buildTrackerPopupHtml({
  regLabel,
  vrn,
  nickname,
  speed,
  lastSeen,
}: TrackerPopupOptions): string {
  const title = escapeTrackerPopupHtml(regLabel);
  const nicknameLine = nickname?.trim()
    ? `[${escapeTrackerPopupHtml(nickname.trim())}]<br/>`
    : '';
  const vrnLine = vrn ? `VRN: ${escapeTrackerPopupHtml(vrn)}<br/>` : '';

  return `<div style="color: #1e293b; padding: 4px; font-size: 13px;">
    <strong>${title}</strong><br/>
    ${nicknameLine}
    ${vrnLine}
    Speed: ${speed ?? 0} mph<br/>
    Last seen: ${lastSeen}
  </div>`;
}
