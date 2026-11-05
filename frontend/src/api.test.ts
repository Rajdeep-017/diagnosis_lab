import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api';
import { getPatientReport, PatientApiError, reportSummaryProblem, validateReportLink } from './api/patient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('sends same-origin credentials and returns a successful JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { email: 'staff@example.com' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/staff/me')).resolves.toEqual({
      user: { email: 'staff@example.com' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/staff/me', {
      credentials: 'include',
      headers: {},
    });
  });

  describe('patient API client', () => {
    it('posts summary feedback with the optional reason using the cookie session', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ summary_id: 7, flagged: true, reason: 'Unclear', created_at: '2026-11-05T00:00:00Z' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(reportSummaryProblem(7, 'Unclear')).resolves.toMatchObject({ flagged: true });
      expect(fetchMock).toHaveBeenCalledWith('/api/summaries/7/flag', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Unclear' }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('uses the cookie session and queries a report by language', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ order: { id: 1 }, results: [], language: 'te', pdf_url: '/pdf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(getPatientReport(1, 'te')).resolves.toMatchObject({ language: 'te' });
      expect(fetchMock).toHaveBeenCalledWith('/api/patient/orders/1?lang=te', {
        credentials: 'include',
        headers: {},
      });
    });

    it('exposes an expired report link as a typed 410 error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { code: 'link_expired', message: 'This report link has expired.' } }), {
          status: 410,
          headers: { 'Content-Type': 'application/json' },
        }),
      ));
      await expect(validateReportLink('expired-token')).rejects.toMatchObject({
        name: 'PatientApiError',
        status: 410,
        kind: 'expired',
        code: 'link_expired',
      } satisfies Partial<PatientApiError>);
    });
  });

  it('throws an ApiError containing the backend error detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Please sign in to continue.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    ));

    await expect(apiRequest('/staff/me')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Please sign in to continue.',
      status: 401,
    } satisfies Partial<ApiError>);
  });
});
