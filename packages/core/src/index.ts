import type { AuthFormValues, LeadCaptureValues, RouteDescriptor } from '@dvnt/types';
import { isEmail, requiredMessage } from '@dvnt/functions';

export const DVNT_QUERY_CACHE_KEY = 'dvnt-query-cache';

export const featureFlags = {
  dashboardTables: false,
  queryPersistence: true,
} as const;

export const authFormDefaults: AuthFormValues = {
  email: '',
  password: '',
};

export const leadCaptureFormDefaults: LeadCaptureValues = {
  email: '',
  name: '',
  source: 'public',
};

export function validateEmailField(value: string) {
  if (!value.trim()) {
    return requiredMessage('Email');
  }

  if (!isEmail(value)) {
    return 'Enter a valid email address';
  }

  return undefined;
}

export function validatePasswordField(value: string) {
  if (!value) {
    return requiredMessage('Password');
  }

  if (value.length < 8) {
    return 'Password must be at least 8 characters';
  }

  return undefined;
}

export function createDebouncedSearchConfig(wait = 250) {
  return {
    wait,
    leading: false,
    trailing: true,
  } as const;
}

export function createAutosavePacerConfig(wait = 1000) {
  return {
    wait,
    leading: false,
    trailing: true,
  } as const;
}

export function eventRoute(eventId: string): RouteDescriptor {
  return {
    pathname: '/events/$eventId',
    params: { eventId },
  };
}

export { platformTarget } from './platform';
