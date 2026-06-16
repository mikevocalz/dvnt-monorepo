import type { ApiResponse } from '@dvnt/types';

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | Promise<string | undefined> | undefined;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<TData>(path: string, init: RequestInit = {}): Promise<ApiResponse<TData>> {
    const token = await this.options.getAccessToken?.();
    const response = await fetch(new URL(path, this.options.baseUrl), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json() as Promise<ApiResponse<TData>>;
  }
}

export function createApiClient(options: ApiClientOptions) {
  return new ApiClient(options);
}
