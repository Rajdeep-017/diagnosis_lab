import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const themes = ['clarity', 'large', 'night'] as const;
const languages = ['en', 'te', 'hi'] as const;
const widths = [360, 1280] as const;
const routes = [
  { path: '/', name: 'patient-home', kind: 'patient' },
  { path: '/login', name: 'patient-login', kind: 'patient' },
  { path: '/verify?challenge_id=visual-challenge', name: 'patient-verify', kind: 'patient' },
  { path: '/patients', name: 'patient-family-picker', kind: 'patient' },
  { path: '/orders?patient_id=1', name: 'patient-orders', kind: 'patient' },
  { path: '/report/1', name: 'patient-report', kind: 'patient' },
  { path: '/r/visual-expired-token', name: 'patient-expired-link', kind: 'patient' },
  { path: '/privacy', name: 'patient-privacy', kind: 'patient' },
  { path: '/staff', name: 'staff-orders', kind: 'staff' },
  { path: '/staff/login', name: 'staff-login', kind: 'staff' },
] as const;

async function installApiFixtures(page: Page) {
  await page.route(/^http:\/\/127\.0\.0\.1:4173\/api\//, async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === '/api/staff/me') {
      const signedIn = new URL(page.url()).pathname !== '/staff/login';
      return route.fulfill({
        status: signedIn ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(signedIn
          ? { user: { id: 1, email: 'frontdesk@example.test', role: 'front_desk' } }
          : { detail: 'Please sign in to continue.' }),
      });
    }
    if (pathname === '/api/staff/orders' || pathname === '/api/staff/orders/') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orders: [{
            id: 1, order: 'VISUAL-001', patient: 'Visual Test Patient', mobile: '90••••0001',
            doctor: 'Demo Clinician', signed_at: '2026-11-05T00:00:00Z', status: 'ready',
            delivery_state: 'queued', delivery_at: '2026-11-05T00:00:00Z', link_expires_at: '2026-11-08T00:00:00Z',
          }],
          pagination: { page: 1, page_size: 20, total: 1, pages: 1 },
        }),
      });
    }
    if (pathname === '/api/staff/orders/1') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1, order: 'VISUAL-001', patient: 'Visual Test Patient', doctor: 'Demo Clinician',
          status: 'ready', signed_at: '2026-11-05T00:00:00Z', link_expires_at: '2026-11-08T00:00:00Z',
          delivery_timeline: [{ status: 'queued', created_at: '2026-11-05T00:00:00Z' }],
          callback_task: null,
        }),
      });
    }
    if (pathname === '/api/staff/orders/1/access-logs') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_logs: [] }) });
    }
    if (pathname === '/api/staff/summaries/review') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [] }) });
    }
    if (pathname === '/api/staff/outbox') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) });
    }
    if (pathname === '/api/staff/callback-tasks') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) });
    }
    if (pathname === '/api/patient/me' || pathname === '/api/patient/patients') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: { id: 1 },
          patients: [
            { id: 1, name: 'Visual Test Patient', dob: null },
            { id: 2, name: 'Visual Family Member B', dob: null },
            { id: 3, name: 'Visual Family Member C', dob: null },
          ],
        }),
      });
    }
    if (pathname === '/api/patient/patients/1/orders') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [{ id: 1, order_no: 'VISUAL-001', status: 'ready', signed_at: '2026-11-05T00:00:00Z', created_at: '2026-11-05T00:00:00Z' }] }),
      });
    }
    if (pathname === '/api/patient/orders/1') {
      const language = url.searchParams.get('lang') ?? 'en';
      const summaries = {
        en: 'This result is below the usual range.',
        te: 'ఈ ఫలితం సాధారణ పరిధి కంటే తక్కువగా ఉంది.',
        hi: 'यह परिणाम सामान्य सीमा से कम है।',
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order: { id: 1, order_no: 'VISUAL-001', patient: 'Visual Test Patient', status: 'ready', signed_at: '2026-11-05T00:00:00Z' },
          language,
          pdf_url: '/api/patient/orders/1/pdf',
          results: [{
            id: 1, name: 'Haemoglobin', value: '10.2', unit: 'g/dL', reference_range: '12.0-15.5',
            flag: 'low', summary_id: 1, summary: summaries[language as keyof typeof summaries], flagged: false,
          }],
        }),
      });
    }
    if (pathname.startsWith('/api/auth/links/')) {
      return route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'link_expired', message: 'This report link has expired.' } }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function visualDefects(page: Page, patientRoute: boolean) {
  return page.evaluate(({ isPatient }) => {
    const parseColor = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    };
    const luminance = (color: [number, number, number, number]) => {
      const channels = color.slice(0, 3).map((part) => {
        const normalized = part / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground: [number, number, number, number], background: [number, number, number, number]) => {
      const top = Math.max(luminance(foreground), luminance(background));
      const bottom = Math.min(luminance(foreground), luminance(background));
      return (top + 0.05) / (bottom + 0.05);
    };
    const backgroundFor = (element: Element): [number, number, number, number] => {
      let current: Element | null = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color[3] > 0.98) return color;
        current = current.parentElement;
      }
      return [255, 255, 255, 1];
    };
    const errors: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) {
      errors.push(`document width ${document.documentElement.scrollWidth} exceeds viewport ${window.innerWidth}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || !node.parentElement) continue;
      const element = node.parentElement;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
      if (style.textOverflow === 'ellipsis' && element.hasAttribute('title')) continue;
      if ((style.overflowX === 'hidden' || style.overflowX === 'clip') && element.scrollWidth > element.clientWidth + 1) {
        errors.push(`clipped horizontal text: ${element.tagName}.${element.className}`);
      }
      if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && element.scrollHeight > element.clientHeight + 1) {
        errors.push(`clipped vertical text: ${element.tagName}.${element.className}`);
      }
      const color = parseColor(style.color);
      if (color && contrast(color, backgroundFor(element)) < 4.5) {
        errors.push(`contrast below 4.5: ${element.tagName}.${element.className} (${contrast(color, backgroundFor(element)).toFixed(2)}:1)`);
      }
    }
    if (isPatient && window.innerWidth < 768) {
      for (const control of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea')) {
        const label = control instanceof HTMLInputElement && control.type === 'checkbox'
          ? control.closest('label')
          : null;
        const target = label ?? control;
        const style = getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
        if (rect.width < 48 || rect.height < 48) {
          errors.push(`tap target under 48px: ${control.tagName}.${control.className} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
        }
      }
    }
    return errors;
  }, { isPatient: patientRoute });
}

test('patient and staff routes render without visual accessibility defects', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  const screenshotDirectory = path.resolve(process.cwd(), '..', 'docs', 'screens');
  mkdirSync(screenshotDirectory, { recursive: true });
  const consoleErrors: string[] = [];
  let activeRouteName = '';
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const expectedExpiredResource = activeRouteName === 'patient-expired-link' && message.text().includes('410 (Gone)');
      const expectedStaffSession = activeRouteName === 'staff-login' && message.text().includes('401 (Unauthorized)');
      if (!expectedExpiredResource && !expectedStaffSession) consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await installApiFixtures(page);
  await page.addInitScript(() => {
    if (window.location.origin === 'null') return;
    const url = new URL(window.location.href);
    const theme = url.searchParams.get('__visual_theme');
    const language = url.searchParams.get('__visual_language');
    if (theme) localStorage.setItem('lab-theme', theme);
    if (language) localStorage.setItem('lab-language', language);
  });

  for (const theme of themes) {
    for (const language of languages) {
      for (const width of widths) {
        for (const route of routes) {
          consoleErrors.length = 0;
          activeRouteName = route.name;
          await page.setViewportSize({ width, height: 900 });
          const target = new URL(route.path, 'http://127.0.0.1:4173');
          target.searchParams.set('__visual_theme', theme);
          target.searchParams.set('__visual_language', language);
          await page.goto(target.toString());
          const readyByRoute = {
            'patient-home': page.locator('input[name="mobile"]'),
            'patient-login': page.locator('input[name="mobile"]'),
            'patient-verify': page.getByRole('heading', { name: 'Enter your code' }),
            'patient-family-picker': page.getByRole('heading', { name: 'Choose a patient' }),
            'patient-orders': page.getByText('VISUAL-001'),
            'patient-report': page.getByText('10.2', { exact: true }),
            'patient-expired-link': page.getByRole('heading', { name: 'This link has expired' }),
            'patient-privacy': page.locator('.patient-shell > .card h1'),
            'staff-orders': page.getByRole('heading', { name: 'Report orders' }),
            'staff-login': page.getByRole('heading', { name: 'Sign in' }),
          }[route.name];
          await expect(readyByRoute, route.name).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
          await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(language === 'te' ? 'te-IN' : language === 'hi' ? 'hi-IN' : 'en-IN');
          await page.evaluate(() => document.fonts.ready);
          if (route.name === 'patient-orders') await expect(page.getByText('VISUAL-001')).toBeVisible();
          if (route.name === 'patient-report') await expect(page.getByText('10.2', { exact: true })).toBeVisible();
          if (route.name === 'staff-orders') await expect(page.getByRole('heading', { name: 'Report orders' })).toBeVisible();
          if (route.name === 'staff-login') await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
          if (route.name === 'patient-expired-link') await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
          const defects = await visualDefects(page, route.kind === 'patient');
          expect(defects, `${route.name}/${theme}/${language}/${width}`).toEqual([]);
          expect(consoleErrors, `${route.name}/${theme}/${language}/${width} console errors`).toEqual([]);
          const filename = `${route.name}-${theme}-${language}-${width}.png`;
          await page.screenshot({ path: path.join(screenshotDirectory, filename), fullPage: true, animations: 'disabled' });
        }
      }
    }
  }
});
