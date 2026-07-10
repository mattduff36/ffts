export async function notifyTimesheetDidNotWorkExceptions(timesheetId: string): Promise<void> {
  const response = await fetch(`/api/timesheets/${timesheetId}/did-not-work-notification`, {
    method: 'POST',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || 'Failed to notify managers about Did Not Work entries');
  }
}
