import axios from 'axios';

interface ApiErrorBody {
  error?: { message?: string; fieldErrors?: Array<{ message?: string }> };
  message?: string;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return fallback;
  const body: ApiErrorBody | undefined = error.response?.data;
  return body?.error?.message
    || body?.error?.fieldErrors?.[0]?.message
    || body?.message
    || fallback;
}
