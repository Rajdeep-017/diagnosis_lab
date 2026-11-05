import type { Language } from '../theme';

export type PatientApiErrorKind = 'unauthorized' | 'forbidden' | 'expired' | 'rate_limited' | 'network' | 'http';

type ErrorDetail = {
  code?: string;
  message?: string;
  attempts_remaining?: number;
  retry_after?: number;
};

export class PatientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: PatientApiErrorKind,
    readonly code?: string,
    readonly attemptsRemaining?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'PatientApiError';
  }
}

export type OtpRequestInput = {
  mobile: string;
  consent: boolean;
  consent_version?: string;
  link_token?: string;
};

export type OtpRequestResult = {
  challenge_id: string;
  masked_mobile: string;
  expires_at: string;
  demo_mode: boolean;
};

export type OtpVerifyResult = {
  status: 'verified';
  account: { id: number; mobile_masked: string };
  next_order_id: number | null;
  renewed_link_url: string | null;
};

export type Patient = { id: number; name: string; dob?: string | null };
export type PatientOrder = {
  id: number;
  order_no: string;
  status: string;
  signed_at: string | null;
  created_at: string | null;
};

export type PatientReportResult = {
  id: number;
  name: string;
  value: string | null;
  unit: string | null;
  reference_range: string | null;
  flag: 'normal' | 'low' | 'high' | 'critical';
  summary_id: number | null;
  summary: string | null;
  flagged: boolean;
};

export type PatientReport = {
  order: {
    id: number;
    order_no: string;
    patient: string;
    status: string;
    signed_at: string | null;
  };
  language: Language;
  pdf_url: string;
  results: PatientReportResult[];
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new PatientApiError(
      error instanceof Error ? error.message : 'Unable to reach the lab service.',
      0,
      'network',
      'network_error',
    );
  }

  if (!response.ok) {
    let detail: string | ErrorDetail = `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { detail?: string | ErrorDetail };
      if (body.detail) detail = body.detail;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const data = typeof detail === 'string' ? {} : detail;
    const message = typeof detail === 'string' ? detail : detail.message ?? `Request failed (${response.status}).`;
    const kind: PatientApiErrorKind = response.status === 401 ? 'unauthorized'
      : response.status === 403 ? 'forbidden'
        : response.status === 410 ? 'expired'
          : response.status === 429 ? 'rate_limited'
            : 'http';
    const retryAfterHeader = Number(response.headers.get('Retry-After'));
    throw new PatientApiError(
      message,
      response.status,
      kind,
      data.code,
      data.attempts_remaining,
      Number.isFinite(retryAfterHeader) && retryAfterHeader >= 0 ? retryAfterHeader : data.retry_after,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function validateReportLink(token: string) {
  return request<{ status: 'otp_required'; masked_mobile: string; expires_at: string }>(
    `/auth/links/${encodeURIComponent(token)}`,
  );
}

export function requestOtp(input: OtpRequestInput) {
  return postJson<OtpRequestResult>('/auth/otp/request', input);
}

export function verifyOtp(challengeId: string, code: string) {
  return postJson<OtpVerifyResult>('/auth/otp/verify', { challenge_id: challengeId, code });
}

export function getDemoOtp(challengeId: string) {
  return request<{ challenge_id: string; code: string }>(`/auth/demo/outbox/${encodeURIComponent(challengeId)}`);
}

export function getPatientSession() {
  return request<{ account: { id: number }; patients: Patient[] }>('/patient/me');
}

export function listPatients() {
  return request<{ patients: Patient[] }>('/patient/patients');
}

export function listPatientOrders(patientId: number) {
  return request<{ orders: PatientOrder[] }>(`/patient/patients/${patientId}/orders`);
}

export function getPatientReport(orderId: number, language: Language) {
  return request<PatientReport>(`/patient/orders/${orderId}?lang=${language}`);
}

export function reportSummaryProblem(summaryId: number, reason?: string) {
  return request<{ summary_id: number; flagged: boolean; reason: string | null; created_at: string }>(
    `/summaries/${summaryId}/flag`,
    { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
  );
}

export function createReportLink(orderId: number) {
  return postJson<{ url: string; expires_at: string }>(`/patient/orders/${orderId}/links`, {});
}

export async function downloadReportPdf(orderId: number): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`/api/patient/orders/${orderId}/pdf`, { credentials: 'include' });
  } catch (error) {
    throw new PatientApiError(
      error instanceof Error ? error.message : 'Unable to reach the lab service.',
      0,
      'network',
      'network_error',
    );
  }
  if (!response.ok) {
    let detail: string | ErrorDetail = `Request failed (${response.status}).`;
    try {
      const body = await response.json() as { detail?: string | ErrorDetail };
      if (body.detail) detail = body.detail;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const data = typeof detail === 'string' ? {} : detail;
    const kind: PatientApiErrorKind = response.status === 401 ? 'unauthorized'
      : response.status === 403 ? 'forbidden'
        : response.status === 410 ? 'expired'
          : response.status === 429 ? 'rate_limited'
            : 'http';
    throw new PatientApiError(
      typeof detail === 'string' ? detail : detail.message ?? `Request failed (${response.status}).`,
      response.status,
      kind,
      data.code,
      data.attempts_remaining,
      Number(response.headers.get('Retry-After')) || data.retry_after,
    );
  }
  return response.blob();
}
