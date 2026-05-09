// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Contact form', () => {
  test.beforeEach(async ({ page }) => {
    // Belt-and-suspenders: even though the real backend isn't running under
    // serve.mjs, abort any direct browser->external calls to make sure no
    // test ever talks to Supabase, Google Sheets, or Resend.
    await page.route(/supabase\.co/, (route) => route.abort());
    await page.route(/googleapis\.com/, (route) => route.abort());
    await page.route(/api\.resend\.com/, (route) => route.abort());
  });

  test('submits successfully and redirects to thank-you page', async ({ page }) => {
    let contactRequestBody = null;

    // Intercept the form's POST to /api/contact and return a mocked success.
    // This is what stands in for Supabase/Sheets/Resend — the request never
    // leaves the browser, so no external services are ever called.
    await page.route('**/api/contact', async (route) => {
      const request = route.request();
      expect(request.method()).toBe('POST');
      contactRequestBody = JSON.parse(request.postData() || '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/');

    const form = page.locator('#contact-form');
    await form.scrollIntoViewIfNeeded();

    await form.locator('#contact-name').fill('Ada Lovelace');
    await form.locator('#contact-email').fill('ada@example.com');
    await form.locator('#contact-message').fill('Hello from a Playwright test.');
    // Newsletter input is `sr-only` — the visible target is a styled label
    // that intercepts pointer events. `force: true` toggles the input directly.
    await form.locator('#contact-newsletter').check({ force: true });

    await Promise.all([
      page.waitForURL('**/thankyou.html'),
      form.locator('button[type="submit"]').click(),
    ]);

    expect(page.url()).toMatch(/\/thankyou\.html$/);
    await expect(page).toHaveTitle(/thank you/i);

    expect(contactRequestBody).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      message: 'Hello from a Playwright test.',
      newsletter: true,
      company: '', // honeypot must stay empty
    });
  });

  test('shows an error and stays on page when the API fails', async ({ page }) => {
    await page.route('**/api/contact', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not save your message. Please try again.' }),
      })
    );

    await page.goto('/');
    const form = page.locator('#contact-form');
    await form.scrollIntoViewIfNeeded();

    await form.locator('#contact-name').fill('Ada Lovelace');
    await form.locator('#contact-email').fill('ada@example.com');
    await form.locator('#contact-message').fill('This one should fail.');
    await form.locator('button[type="submit"]').click();

    const errorEl = page.locator('#contact-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText(/could not save/i);
    expect(page.url()).not.toMatch(/thankyou\.html/);
  });
});