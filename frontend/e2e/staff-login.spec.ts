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
  await page.route('**/api/staff/orders', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ orders: [{ id: 1, order: 'ORD-1001', patient: 'Ananya Rao', status: 'ready', last_delivery: null }] }),
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

  await page.goto('/staff/login');
  await page.getByLabel('Work email').fill('staff@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Report orders' })).toBeVisible();
  await expect(page.getByText('ORD-1001')).toBeVisible();
  await page.getByRole('button', { name: 'Actions for ORD-1001' }).click();
  await page.getByRole('menuitem', { name: 'Queue delivery' }).click();
  await expect(page.getByRole('status')).toContainText('Report delivery has been queued.');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
