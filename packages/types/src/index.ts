export type ID = string;

export type PlatformTarget = 'native' | 'web';

export interface ApiResponse<TData> {
  data: TData;
  meta?: Record<string, unknown>;
}

export interface ApiErrorShape {
  message: string;
  code?: string;
  status?: number;
}

export interface EventSummary {
  id: ID;
  title: string;
  startsAt: string;
  venueName?: string;
}

export interface LeadCaptureValues {
  email: string;
  name?: string;
  source?: string;
}

export interface AuthFormValues {
  email: string;
  password: string;
}

export interface RouteDescriptor {
  pathname: string;
  params?: Record<string, string | number | boolean | undefined>;
}
