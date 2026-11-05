import { expect, test } from '@playwright/test';

const widths = [320, 360, 390, 768, 1024, 1440];
const themes = ['clarity', 'large', 'night', 'console'];
const screens: { path: string; name: string; layout?: string; fixture?: string }[] = [
  { path: '/', name: 'home' },
  { path: '/report/1', name: 'report' },
  { path: '/staff', name: 'staff' },
  { path: '/staff/login', name: 'staff-login' },
  { path: '/styleguide', name: 'styleguide' },
  { path: '/styleguide/report', name: 'report-focus' },
  { path: '/styleguide/report', name: 'report-large', layout: 'Large' },
  { path: '/styleguide/report', name: 'report-compact', layout: 'Compact' },
  { path: '/styleguide/report', name: 'fixture-normal', fixture: 'normal' },
  { path: '/styleguide/report', name: 'fixture-high', fixture: 'high' },
  { path: '/styleguide/report', name: 'fixture-critical', fixture: 'critical' },
  { path: '/styleguide/report', name: 'fixture-missing-summary', fixture: 'missingSummary' },
  { path: '/styleguide/report', name: 'fixture-long-telugu', fixture: 'longTelugu' },
];

for (const theme of themes) {
  for (const width of widths) {
    for (const screen of screens) {
      test(`${screen.name} has no viewport overflow at ${width}px in ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.route('**/api/staff/me', async (route) => {
          if (screen.path === '/staff/login') {
            await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Please sign in to continue.' }) });
            return;
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, email: 'staff@example.com', role: 'front_desk' } }) });
        });
        await page.route('**/api/staff/orders', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ orders: [{ id: 1, order: 'ORD-1001', patient: 'Ananya Rao', status: 'ready', last_delivery: null }] }),
        }));
        await page.route('**/api/staff/summaries/review', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summaries: [] }),
        }));
        await page.route('**/api/staff/outbox', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: [] }),
        }));
        await page.route('**/api/staff/callback-tasks', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tasks: [] }),
        }));
        await page.route('**/api/patient/me', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ account: { id: 1 }, patients: [{ id: 1, name: 'Ananya Rao' }] }),
        }));
        await page.route('**/api/patient/orders/1*', (route) => route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            order: { id: 1, order_no: 'ORD-1001', patient: 'Ananya Rao', status: 'ready', signed_at: '2026-11-05T00:00:00Z' },
            language: 'en',
            pdf_url: '/api/patient/orders/1/pdf',
            results: [{ id: 1, name: 'Haemoglobin', value: '10.2', unit: 'g/dL', reference_range: '12.0-15.5', flag: 'low', summary_id: 1, summary: 'Below the usual range.', flagged: false }],
          }),
        }));
        await page.goto(screen.path);
        await page.evaluate((activeTheme) => { document.documentElement.dataset.theme = activeTheme; }, theme);
        if (screen.name === 'styleguide') await page.waitForFunction(() => document.querySelector('.language-sample h3')?.textContent !== 'Loading preview…');
        if (screen.layout) await page.getByRole('button', { name: screen.layout, exact: true }).click();
        if (screen.fixture) await page.getByLabel('Report fixture').selectOption(screen.fixture);
        if (screen.name === 'fixture-long-telugu') await page.getByRole('button', { name: 'TE', exact: true }).click();
        if (screen.name === 'fixture-missing-summary') await expect(page.getByText('See full report.')).toBeVisible();
        if (screen.name === 'fixture-critical') await expect(page.getByText('10.2', { exact: true })).toHaveCount(0);
        if (screen.name === 'report') await expect(page.getByRole('img', { name: /10\.2 g\/dL, below the normal range/ })).toBeVisible();
        await page.screenshot({ path: `test-results/screenshots/${theme}-${width}-${screen.name}.png`, fullPage: true });
        const dimensions = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          overflowing: [...document.querySelectorAll<HTMLElement>('*')]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.right > window.innerWidth + 1 || rect.left < -1;
            })
            .slice(0, 8)
            .map((element) => `${element.tagName.toLowerCase()}.${element.className} (${Math.round(element.getBoundingClientRect().left)}..${Math.round(element.getBoundingClientRect().right)})`),
        }));
        expect(dimensions.document, `${screen.path} overflows at ${width}px: ${dimensions.overflowing.join(', ')}`).toBeLessThanOrEqual(dimensions.viewport);
      });
    }
  }
}
