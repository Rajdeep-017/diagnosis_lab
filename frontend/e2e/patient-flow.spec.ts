import { expect, test } from '@playwright/test';

test('patient home requires mobile consent before displaying any patient information', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'View your lab reports' })).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await expect(page.getByRole('link', { name: 'privacy notice' })).toHaveAttribute('href', '/privacy');
  await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Staff login' })).toHaveAttribute('href', '/staff');
  await expect(page.getByText(/DEMO-100\d|Visual Test Patient|lab report card/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Aa appearance/ })).toBeVisible();
  for (const language of ['EN', 'TE', 'HI']) await expect(page.getByRole('button', { name: language, exact: true })).toBeVisible();
});

test('report link verifies through demo OTP and opens the database-backed report', async ({ page }) => {
  let submittedLinkToken = '';
  await page.route('**/api/auth/links/valid-token', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'otp_required', masked_mobile: '+91******10', expires_at: '2026-11-06T00:00:00Z' }),
  }));
  await page.route('**/api/auth/otp/request', async (route) => {
    const body = route.request().postDataJSON() as { link_token?: string; consent: boolean };
    submittedLinkToken = body.link_token ?? '';
    expect(body.consent).toBe(true);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ challenge_id: 'a-valid-challenge-reference-12345', masked_mobile: '+91******10', expires_at: '2026-11-05T20:00:00Z', demo_mode: true }),
    });
  });
  await page.route('**/api/auth/demo/outbox/a-valid-challenge-reference-12345', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ challenge_id: 'a-valid-challenge-reference-12345', code: '123456' }),
  }));
  await page.route('**/api/auth/otp/verify', async (route) => {
    const body = route.request().postDataJSON() as { code: string };
    if (body.code !== '123456') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'invalid_otp', message: 'That code is not correct.', attempts_remaining: 4 } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'verified', account: { id: 1, mobile_masked: '+91******10' }, next_order_id: 1, renewed_link_url: null }),
    });
  });
  await page.route('**/api/patient/orders/1*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      order: { id: 1, order_no: 'DEMO-1002', patient: 'Demo Family Member B', status: 'ready', signed_at: '2026-11-05T00:00:00Z' },
      language: 'en',
      pdf_url: '/api/patient/orders/1/pdf',
      results: [{ id: 1, name: 'Haemoglobin', value: '10.2', unit: 'g/dL', reference_range: '12.0-15.5', flag: 'low', summary_id: 1, summary: 'Below the usual range.', flagged: false }],
    }),
  }));
  await page.route('**/api/patient/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: { id: 1 }, patients: [{ id: 1, name: 'Demo Family Member B' }] }),
  }));
  await page.route('**/api/patient/patients/1/orders', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ orders: [{ id: 1, order_no: 'ORD-1001', status: 'ready', signed_at: '2026-11-05T00:00:00Z' }] }),
  }));
  let flagAttempts = 0;
  await page.route('**/api/summaries/1/flag', async (route) => {
    flagAttempts += 1;
    const body = route.request().postDataJSON() as { reason: string | null };
    expect(body.reason).toBe('This explanation is unclear.');
    if (flagAttempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Feedback could not be saved.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ summary_id: 1, flagged: true, reason: body.reason, created_at: '2026-11-05T20:00:00Z' }),
    });
  });

  await page.goto('/r/valid-token');
  await expect(page).toHaveURL(/\/login\?link_token=valid-token$/);
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  expect(submittedLinkToken).toBe('valid-token');
  await expect(page.getByRole('status')).toContainText('Demo: code is in the outbox.');
  const demoOtp = await page.evaluate(async () => {
    const response = await fetch('/api/auth/demo/outbox/a-valid-challenge-reference-12345');
    return response.json() as Promise<{ code: string }>;
  });
  expect(demoOtp.code).toBe('123456');
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page.getByRole('alert')).toContainText('4 attempts remaining');
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL(/\/orders\?patient_id=1$/);
  await page.getByRole('button', { name: 'Open report' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Family Member B' })).toBeVisible();
  await expect(page.getByText('Below the usual range.')).toBeVisible();
  await page.getByRole('button', { name: 'Report a problem with this summary' }).click();
  await page.getByLabel('What seems wrong? (optional)').fill('This explanation is unclear.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Feedback could not be saved.');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Report a problem with this summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Report a problem with this summary' }).click();
  await page.getByLabel('What seems wrong? (optional)').fill('This explanation is unclear.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('status')).toContainText('Thank you. The lab team will review your feedback.');
});

test('expired report link offers OTP renewal without disclosing report data', async ({ page }) => {
  await page.route('**/api/auth/links/expired-token', (route) => route.fulfill({
    status: 410,
    contentType: 'application/json',
    body: JSON.stringify({ detail: { code: 'link_expired', message: 'This report link has expired.', renewal_available: true } }),
  }));
  await page.route('**/api/auth/otp/request', async (route) => {
    const body = route.request().postDataJSON() as { link_token?: string };
    expect(body.link_token).toBe('expired-token');
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ challenge_id: 'expired-link-challenge-reference', masked_mobile: '+91******10', expires_at: '2026-11-05T20:00:00Z', demo_mode: true }),
    });
  });
  await page.route('**/api/auth/demo/outbox/expired-link-challenge-reference', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ challenge_id: 'expired-link-challenge-reference', code: '123456' }),
  }));
  await page.goto('/r/expired-token');
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await page.getByRole('button', { name: 'Get a new link with OTP' }).click();
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
});
