import { expect, test, type Page } from '@playwright/test';

const staffEmail = 'staff@example.com';
const staffPassword = 'password123';
const patientMobile = '9876543210';

function csvRow(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',');
}

function reportCsv(options: {
  order: string;
  patient: string;
  mobile?: string;
  parameter: string;
  value: string;
  unit: string;
  range: string;
  flag: 'normal' | 'low' | 'high' | 'critical';
  english: string;
  telugu: string;
  familyMember?: string;
}) {
  const header = [
    'order_no', 'patient_name', 'mobile', 'parameter', 'value', 'unit',
    'reference_range', 'flag', 'status', 'summary_en', 'summary_te', 'summary_hi',
  ];
  const record = (order: string, patient: string, parameter: string, value: string, status: string) => csvRow([
    order,
    patient,
    options.mobile ?? patientMobile,
    parameter,
    value,
    options.unit,
    options.range,
    options.flag,
    status,
    options.english,
    options.telugu,
    'పరీక్ష ఫలితం వివరణ.',
  ]);
  const rows = [
    record(options.order, options.patient, options.parameter, options.value, 'processing'),
    record(options.order, options.patient, options.parameter, options.value, 'ready'),
  ];
  if (options.familyMember) {
    rows.push(record(`${options.order}-FAMILY`, options.familyMember, 'Glucose', '92', 'processing'));
  }
  return [csvRow(header), ...rows].join('\n');
}

async function loginAsStaff(page: Page) {
  await page.goto('/staff');
  await expect(page.locator('.staff-login-card, .staff-content')).toBeVisible();
  if (await page.getByLabel('Work email').count()) {
    await page.getByLabel('Work email').fill(staffEmail);
    await page.getByLabel('Password').fill(staffPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Report orders' })).toBeVisible();
}

async function importReport(page: Page, csv: string) {
  await page.getByLabel('Orders CSV').setInputFiles({
    name: 'report-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await expect(page.getByRole('status')).toContainText('moved to Ready');
}

async function outboxLink(page: Page, orderNo: string) {
  const row = page.getByRole('row').filter({ hasText: orderNo });
  const link = row.getByRole('link', { name: 'Open patient link' });
  await expect(link).toBeVisible();
  return await link.getAttribute('href') as string;
}

async function verifyPatientOtp(page: Page, link: string, mobile: string) {
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?link_token=/);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  const demoBanner = page.locator('.demo-otp-banner');
  await expect(demoBanner).toContainText('Demo code');
  const code = (await demoBanner.innerText()).match(/\b\d{6}\b/)?.[0];
  expect(code, 'The code must come from the backend demo outbox banner.').toBeTruthy();
  await page.getByLabel('Verification code').fill(code!);
  await page.getByRole('button', { name: 'Verify code' }).click();
}

test('CSV ready delivery, family report, feedback, audit log, and expired link work end to end', async ({ page }) => {
  const orderNo = 'E2E-FLOW-001';
  await loginAsStaff(page);
  await importReport(page, reportCsv({
    order: orderNo,
    patient: 'Ananya Integration',
    familyMember: 'Ravi Integration',
    parameter: 'Haemoglobin',
    value: '10.2',
    unit: 'g/dL',
    range: '12.0-15.5',
    flag: 'low',
    english: 'Haemoglobin is below the usual range.',
    telugu: 'హీమోగ్లోబిన్ సాధారణ పరిధి కంటే తక్కువగా ఉంది.',
  }));
  const readyRow = page.locator('#orders .data-table').first().locator('tbody tr').filter({ hasText: 'Ananya Integration' });
  await expect(readyRow).toContainText('Ready');
  const link = await outboxLink(page, orderNo);
  expect(link).toMatch(/^\/r\/[A-Za-z0-9_-]+$/);

  await verifyPatientOtp(page, link, patientMobile);
  await expect(page.getByRole('heading', { name: 'Choose a patient' })).toBeVisible();
  const patientCard = page.locator('.patient-picker-list .card').filter({ hasText: 'Ananya Integration' });
  await patientCard.getByRole('button', { name: 'View reports' }).click();
  await page.getByRole('button', { name: 'Open report' }).click();
  await expect(page.getByText('10.2', { exact: true })).toBeVisible();
  await expect(page.getByText('Haemoglobin is below the usual range.')).toBeVisible();
  await page.getByRole('button', { name: 'TE', exact: true }).click();
  await expect(page.getByText('హీమోగ్లోబిన్ సాధారణ పరిధి కంటే తక్కువగా ఉంది.')).toBeVisible();

  await page.getByRole('button', { name: 'Report a problem with this summary' }).click();
  await page.getByLabel('What seems wrong? (optional)').fill('The Telugu wording is unclear.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('status')).toContainText('Thank you. The lab team will review your feedback.');

  await loginAsStaff(page);
  await expect(page.locator('#review').getByText('Patient flagged')).toBeVisible();
  await expect(page.getByText('The Telugu wording is unclear.')).toBeVisible();
  const orderRow = page.locator('#orders .data-table').first().locator('tbody tr').filter({ hasText: orderNo }).filter({ hasText: 'Ananya Integration' }).first();
  await orderRow.getByRole('button', { name: `Actions for ${orderNo}` }).click();
  await page.getByRole('menuitem', { name: 'View access log' }).click();
  await expect(page.getByRole('dialog').getByText('report_view', { exact: true }).first()).toBeVisible();

  const clockStatus = await page.evaluate(async () => {
    const response = await fetch('/api/test/clock/advance', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-E2E-Token': 'isocode-e2e-only-token' },
      body: JSON.stringify({ hours: 73 }),
    });
    return response.status;
  });
  expect(clockStatus).toBe(200);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
});

test('a different mobile cannot request access to an order link', async ({ page }) => {
  const orderNo = 'E2E-IDOR-001';
  await loginAsStaff(page);
  await importReport(page, reportCsv({
    order: orderNo,
    patient: 'IDOR Patient',
    parameter: 'LDL',
    value: '142',
    unit: 'mg/dL',
    range: '0-100',
    flag: 'high',
    english: 'LDL is above the usual range.',
    telugu: 'ఎల్‌డీఎల్ సాధారణ పరిధి కంటే ఎక్కువగా ఉంది.',
  }));
  const link = await outboxLink(page, orderNo);
  await page.goto(link);
  let mismatchStatus: number | undefined;
  page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/otp/request')) mismatchStatus = response.status();
  });
  await page.getByLabel('Mobile number').fill('9876543299');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await expect(page.getByRole('alert')).toContainText('Mobile number does not match this report');
  expect(mismatchStatus).toBe(403);
});

test('critical reports suppress values and create a staff callback task', async ({ page }) => {
  const orderNo = 'E2E-CRITICAL-001';
  await loginAsStaff(page);
  await importReport(page, reportCsv({
    order: orderNo,
    patient: 'Critical Patient',
    mobile: '9876543298',
    parameter: 'Potassium',
    value: '7.1',
    unit: 'mEq/L',
    range: '3.5-5.1',
    flag: 'critical',
    english: 'Critical result.',
    telugu: 'విమర్శనాత్మక ఫలితం.',
  }));
  const link = await outboxLink(page, orderNo);
  await verifyPatientOtp(page, link, '9876543298');
  await expect(page).toHaveURL(/\/orders\?patient_id=/);
  await page.getByRole('button', { name: 'Open report' }).click();
  await expect(page.getByText('Please contact the lab team to discuss your result.')).toBeVisible();
  await expect(page.getByText('7.1', { exact: true })).toHaveCount(0);

  await loginAsStaff(page);
  const callbackRow = page.locator('#callbacks .data-table tbody tr').filter({ hasText: orderNo }).first();
  await expect(callbackRow).toContainText('Critical result requires patient follow-up: Potassium.');
});
