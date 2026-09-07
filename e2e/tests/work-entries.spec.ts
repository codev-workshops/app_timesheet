import { test, expect, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001';

async function seedClient(email: string, name: string): Promise<void> {
  const res = await fetch(`${API}/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-email': email },
    body: JSON.stringify({ name, department: 'Engineering' }),
  });
  if (!res.ok) throw new Error(`Failed to seed client: ${res.status} ${await res.text()}`);
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Time Tracker' })).toBeVisible();
  await page.getByLabel('Email Address').fill(email);
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Work entries workflow', () => {
  const email = `e2e-${Date.now()}@example.com`;
  const clientName = `Acme ${Date.now()}`;

  test.beforeAll(async () => {
    await seedClient(email, clientName);
  });

  test('login, create, verify, edit and delete a work entry', async ({ page }) => {
    await test.step('login', async () => {
      await login(page, email);
    });

    await test.step('navigate to work entries', async () => {
      await page.goto('/work-entries');
      await expect(page.getByRole('heading', { name: 'Work Entries' })).toBeVisible();
      await expect(page.getByText('No work entries found')).toBeVisible();
    });

    const dialog = page.getByRole('dialog');

    await test.step('create a work entry', async () => {
      await page.getByRole('button', { name: 'Add Work Entry' }).click();
      await expect(dialog.getByText('Add New Work Entry')).toBeVisible();

      await dialog.getByRole('combobox').first().click();
      await page.getByRole('option', { name: clientName }).click();
      await dialog.getByLabel('Hours').fill('3.5');
      await dialog.getByLabel('Description').fill('Initial implementation');
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(dialog).toBeHidden();
    });

    const row = page.getByRole('row').filter({ hasText: clientName });

    await test.step('verify entry appears in list', async () => {
      await expect(row).toHaveCount(1);
      await expect(row.getByText('3.5 hours')).toBeVisible();
      await expect(row.getByText('Initial implementation')).toBeVisible();
    });

    await test.step('edit the work entry', async () => {
      await row.getByRole('button').first().click();
      await expect(dialog.getByText('Edit Work Entry')).toBeVisible();
      await expect(dialog.getByLabel('Hours')).toHaveValue('3.5');

      await dialog.getByLabel('Hours').fill('5');
      await dialog.getByLabel('Description').fill('Updated implementation');
      await dialog.getByRole('button', { name: 'Update' }).click();
      await expect(dialog).toBeHidden();

      await expect(row.getByText('5 hours')).toBeVisible();
      await expect(row.getByText('Updated implementation')).toBeVisible();
      await expect(row.getByText('3.5 hours')).toHaveCount(0);
    });

    await test.step('delete the work entry', async () => {
      page.once('dialog', (d) => {
        expect(d.message()).toContain(clientName);
        d.accept();
      });
      await row.getByRole('button').nth(1).click();

      await expect(row).toHaveCount(0);
      await expect(page.getByText('No work entries found')).toBeVisible();
    });
  });
});
