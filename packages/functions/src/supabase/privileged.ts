import type { SupabaseClient } from '@supabase/supabase-js';

export type UpdateProfileParams = {
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  location?: string;
  website?: string;
  links?: string[];
  avatarUrl?: string;
  pronouns?: string;
  gender?: string;
};

export type PrivilegedResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string } | string;
};

export type AuthTokenProvider = () => Promise<string | null | undefined>;

type PrivilegedOperationOptions = {
  supabase: SupabaseClient;
  getAuthToken: AuthTokenProvider;
};

export type UpdateProfilePrivilegedOptions = PrivilegedOperationOptions & {
  updates: UpdateProfileParams;
};

export type DeleteAccountPrivilegedOptions = PrivilegedOperationOptions & {
  beforeDelete?: () => void | Promise<void>;
};

function getPrivilegedErrorMessage<T>(
  response: PrivilegedResponse<T> | null | undefined,
  fallback: string,
) {
  if (!response?.error) {
    return fallback;
  }

  if (typeof response.error === 'string') {
    return response.error;
  }

  return response.error.message ?? fallback;
}

async function getBearerToken(getAuthToken: AuthTokenProvider) {
  const token = await getAuthToken();

  if (!token) {
    throw new Error('Not authenticated');
  }

  return token;
}

export async function updateProfilePrivileged<TUser = unknown>({
  supabase,
  getAuthToken,
  updates,
}: UpdateProfilePrivilegedOptions): Promise<TUser> {
  const token = await getBearerToken(getAuthToken);

  const { data, error } = await supabase.functions.invoke<
    PrivilegedResponse<{ user: TUser }>
  >('update-profile', {
    body: updates,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to update profile');
  }

  if (!data?.ok || !data?.data?.user) {
    throw new Error(getPrivilegedErrorMessage(data, 'Failed to update profile'));
  }

  return data.data.user;
}

export async function deleteAccountPrivileged({
  supabase,
  getAuthToken,
  beforeDelete,
}: DeleteAccountPrivilegedOptions): Promise<boolean> {
  const token = await getBearerToken(getAuthToken);

  await beforeDelete?.();

  const { data, error } = await supabase.functions.invoke<
    PrivilegedResponse<null>
  >('delete-account', {
    body: { confirm: true },
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) {
    throw new Error(error.message || 'Failed to delete account');
  }

  if (data && !data.ok) {
    throw new Error(getPrivilegedErrorMessage(data, 'Failed to delete account'));
  }

  return true;
}
