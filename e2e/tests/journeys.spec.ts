import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { BACKEND_URL } from '../playwright.config';

// Each run uses a fresh tenant so tests are independent of leftover state
// (the backend DB is in-memory, but dev servers may be reused across runs).
const RUN_ID = Date.now();
const USER_EMAIL = `e2e-${RUN_ID}@example.com`;
const CLIENT_NAME = `E2E Client ${RUN_ID}`;

const authHeaders = { 'x-user-email': USER_EMAIL };

async function loginViaUi(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(USER_EMAIL);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function navigateTo(page: Page, item: 'Clients' | 'Work Entries' | 'Reports') {
  // The sidebar renders MUI ListItemButtons (role=button); the permanent drawer is the visible one.
  await page.getByRole('button', { name: item, exact: true }).locator('visible=true').first().click();
  await expect(page.getByRole('heading', { name: item, exact: true })).toBeVisible();
}

async function getClientId(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${BACKEND_URL}/api/clients`, { headers: authHeaders });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { clients: { id: number; name: string }[] };
  const client = body.clients.find((c) => c.name === CLIENT_NAME);
  expect(client, `client "${CLIENT_NAME}" should exist`).toBeDefined();
  return client!.id;
}

test.describe.configure({ mode: 'serial' });

test.describe('timesheet critical journeys', () => {
  test('login creates the user via x-user-email', async ({ page, request }) => {
    await loginViaUi(page);

    // The header-based auth must have created the user on the backend.
    const me = await request.get(`${BACKEND_URL}/api/auth/me`, { headers: authHeaders });
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user: { email: string } };
    expect(body.user.email).toBe(USER_EMAIL);

    // Dashboard summary for a brand-new user is empty.
    await expect(page.getByText('Total Work Entries')).toBeVisible();
    await expect(page.getByText('No work entries yet')).toBeVisible();
  });

  test('create a client', async ({ page }) => {
    await loginViaUi(page);
    await navigateTo(page, 'Clients');

    await page.getByRole('button', { name: 'Add Client' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Client Name').fill(CLIENT_NAME);
    await dialog.getByLabel('Department').fill('Engineering');
    await dialog.getByRole('button', { name: /create/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: CLIENT_NAME })).toBeVisible();
  });

  test('create, edit and delete a work entry', async ({ page }) => {
    await loginViaUi(page);
    await navigateTo(page, 'Work Entries');

    // Create
    await page.getByRole('button', { name: 'Add Work Entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: CLIENT_NAME }).click();
    await dialog.getByLabel('Hours').fill('2.5');
    await dialog.getByLabel('Description').fill('Initial e2e work');
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row').filter({ hasText: 'Initial e2e work' });
    await expect(row).toBeVisible();
    await expect(row.getByText('2.5 hours')).toBeVisible();

    // Edit
    await row.getByRole('button').first().click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Hours').fill('4');
    await dialog.getByLabel('Description').fill('Edited e2e work');
    await dialog.getByRole('button', { name: /update|save/i }).click();
    await expect(dialog).toBeHidden();

    const editedRow = page.getByRole('row').filter({ hasText: 'Edited e2e work' });
    await expect(editedRow).toBeVisible();
    await expect(editedRow.getByText('4 hours')).toBeVisible();
    await expect(page.getByText('Initial e2e work')).toHaveCount(0);

    // Add a second entry so the dashboard/report have something after the delete below.
    await page.getByRole('button', { name: 'Add Work Entry' }).click();
    await dialog.getByRole('combobox').first().click();
    await page.getByRole('option', { name: CLIENT_NAME }).click();
    await dialog.getByLabel('Hours').fill('1.5');
    await dialog.getByLabel('Description').fill('Second entry, "quoted", with, commas');
    await dialog.getByRole('button', { name: /create/i }).click();
    await expect(dialog).toBeHidden();

    // Delete the edited entry (confirm dialog is window.confirm)
    page.once('dialog', (d) => d.accept());
    await editedRow.getByRole('button').nth(1).click();
    await expect(page.getByText('Edited e2e work')).toHaveCount(0);
    await expect(page.getByText('Second entry, "quoted", with, commas')).toBeVisible();

    // Pagination control reflects the server-side total.
    await expect(page.getByText(/1–1 of 1/)).toBeVisible();
  });

  test('dashboard shows summary from the aggregate endpoint', async ({ page }) => {
    const summaryRequest = page.waitForResponse(
      (r) => r.url().includes('/api/work-entries/summary') && r.status() === 200
    );
    await loginViaUi(page);
    const summaryResponse = await summaryRequest;
    const summary = (await summaryResponse.json()) as {
      summary: { entryCount: number; totalHours: number };
    };
    expect(summary.summary.entryCount).toBe(1);
    expect(summary.summary.totalHours).toBe(1.5);

    // Dashboard must not request the full, unpaginated list.
    const listRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/work-entries?') || req.url().endsWith('/api/work-entries')) {
        listRequests.push(req.url());
      }
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Total Hours')).toBeVisible();
    await expect(page.getByText('1.50')).toBeVisible();
    await expect(page.getByText('Total Work Entries')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Work Entries' })).toBeVisible();
    await expect(page.getByText(CLIENT_NAME).first()).toBeVisible();

    expect(listRequests.length).toBeGreaterThan(0);
    for (const url of listRequests) {
      expect(url).toMatch(/limit=5/);
    }
  });

  test('client report shows totals and entries', async ({ page }) => {
    await loginViaUi(page);
    await navigateTo(page, 'Reports');

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: CLIENT_NAME }).click();

    const totalHoursCard = page.locator('.MuiCard-root').filter({ hasText: 'Total Hours' });
    await expect(totalHoursCard.getByText('1.50')).toBeVisible();
    const totalEntriesCard = page.locator('.MuiCard-root').filter({ hasText: 'Total Entries' });
    await expect(totalEntriesCard.getByText('1', { exact: true })).toBeVisible();
    await expect(page.getByText('Average Hours per Entry')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Second entry, "quoted", with, commas' })).toBeVisible();
  });

  test('CSV export downloads with the right headers and escaped content', async ({ page, request }) => {
    const clientId = await getClientId(request);

    const res = await request.get(`${BACKEND_URL}/api/reports/export/csv/${clientId}`, {
      headers: authHeaders,
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/^text\/csv/);
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=".*\.csv"$/);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Date,Hours,Description,Created At');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Second entry, ""quoted"", with, commas"');

    // Through the UI the export triggers a browser download.
    await loginViaUi(page);
    await navigateTo(page, 'Reports');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: CLIENT_NAME }).click();
    await expect(page.getByText('Average Hours per Entry')).toBeVisible();

    const csvResponse = page.waitForResponse((r) => r.url().includes('/api/reports/export/csv/'));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export as CSV' }).click();
    expect((await csvResponse).status()).toBe(200);
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('PDF export downloads with the right headers', async ({ page, request }) => {
    const clientId = await getClientId(request);

    const res = await request.get(`${BACKEND_URL}/api/reports/export/pdf/${clientId}`, {
      headers: authHeaders,
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    expect(res.headers()['content-disposition']).toMatch(/^attachment; filename=".*\.pdf"$/);
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');

    await loginViaUi(page);
    await navigateTo(page, 'Reports');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: CLIENT_NAME }).click();
    await expect(page.getByText('Average Hours per Entry')).toBeVisible();

    const pdfResponse = page.waitForResponse((r) => r.url().includes('/api/reports/export/pdf/'));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export as PDF' }).click();
    expect((await pdfResponse).status()).toBe(200);
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('other tenants cannot see this user data', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/work-entries`, {
      headers: { 'x-user-email': `other-${RUN_ID}@example.com` },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { workEntries: unknown[]; pagination: { total: number } };
    expect(body.workEntries).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });
});
