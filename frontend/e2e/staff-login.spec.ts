import { expect, test } from '@playwright/test';

test('staff login, database orders, delivery action, and logout respond to user actions', async ({ page }) => {
  let signedIn = false;
  await page.route('**/api/staff/me', (route) => route.fulfill({
    status: signedIn ? 200 : 401,
    contentType: 'application/json',
    body: JSON.stringify(signedIn
      ? { user: { id: 1, email: 'staff@example.com', role: 'front_desk' } }
      : { detail: 'Please sign in to continue.' }),
  }));
  await page.route('**/api/staff/login', async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string };
    expect(body).toEqual({ email: 'staff@example.com', password: 'password123' });
    signedIn = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, email: body.email, role: 'front_desk' } }) });
  });
  await page.route('**/api/staff/orders*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ orders: [{ id: 1, order: 'ORD-1001', patient: 'Demo Person One', mobile: '98••••3210', doctor: 'Demo Clinician', signed_at: '2026-11-05T00:00:00Z', status: 'ready', delivery_state: 'not_sent', delivery_at: null, link_expires_at: null }], pagination: { page: 1, page_size: 20, total: 1, pages: 1 } }),
  }));
  await page.route('**/api/staff/summaries/review', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ summaries: [] }),
  }));
  await page.route('**/api/staff/outbox', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ messages: [
      { id: 2, order_id: 1, order: 'ORD-1001', time: '2026-11-06T00:00:00Z', channel: 'sms', recipient: '+91******10', purpose: 'report-link', body: 'Report ORD-1001 is ready. Open your report: /r/sample-link-token', status: 'queued' },
      { id: 1, order_id: null, order: null, time: '2026-11-05T23:59:00Z', channel: 'sms', recipient: '+91******10', purpose: 'otp', body: 'Demo OTP: 123456 (valid for 5 minutes)', status: 'sent' },
    ] }),
  }));
  await page.route('**/api/staff/callback-tasks', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tasks: [] }),
  }));
  await page.route('**/api/staff/orders/1/resend', (route) => route.fulfill({
    status: 202,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'queued', message: 'Report delivery has been queued.' }),
  }));
  await page.route('**/api/staff/logout', (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/staff/login');
  await page.getByLabel('Work email', { exact: true }).fill('staff@example.com');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Report orders' })).toBeVisible();
  await expect(page.getByText('ORD-1001', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Outbox', exact: true }).click();
  await expect(page.getByText('Demo OTP: 123456 (valid for 5 minutes)')).toBeVisible();
  await page.getByRole('button', { name: 'Copy code' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('123456');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/r/sample-link-token');
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for ORD-1001' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Resend link' }).click();
  await expect(page.getByRole('status')).toContainText('Report delivery has been queued.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
