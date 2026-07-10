export const DEFAULT_ERROR_LOG_FILTERS = {
  hideLocalhost: true,
  hideAdminAccount: true,
} as const;

export const DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL = 'admin@mpdee.co.uk';

interface DefaultErrorLogFilterEntry {
  page_url: string | null;
  user_email: string | null;
}

export function isLocalhostErrorLog(log: Pick<DefaultErrorLogFilterEntry, 'page_url'>): boolean {
  return (log.page_url || '').toLowerCase().includes('localhost');
}

export function isHiddenAdminErrorLog(log: Pick<DefaultErrorLogFilterEntry, 'user_email'>): boolean {
  return log.user_email === DEBUG_ERROR_LOG_HIDDEN_ADMIN_EMAIL;
}

export function isVisibleWithDefaultErrorLogFilters(log: DefaultErrorLogFilterEntry): boolean {
  if (DEFAULT_ERROR_LOG_FILTERS.hideLocalhost && isLocalhostErrorLog(log)) {
    return false;
  }

  if (DEFAULT_ERROR_LOG_FILTERS.hideAdminAccount && isHiddenAdminErrorLog(log)) {
    return false;
  }

  return true;
}
