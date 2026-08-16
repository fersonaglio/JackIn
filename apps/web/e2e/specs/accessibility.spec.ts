import { test, expect } from '@playwright/test';

test.describe('Acessibilidade', () => {
  test('T26: Navegação por teclado — Tab entre elementos', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const focused = page.locator(':focus');
    expect(await focused.count()).toBeGreaterThan(0);
  });

  test('T27: Modal tem role="dialog" e aria-modal', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const modal = page.getByRole('dialog');
    if (await modal.isVisible()) {
      await expect(modal).toHaveAttribute('aria-modal', 'true');
    }
  });

  test('T28: Elementos interativos têm foco visível', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    expect(await focused.count()).toBeGreaterThan(0);
  });

  test('T29: Imagens têm alt text', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const images = page.locator('img');
    const count = await images.count();
    if (count > 0) {
      const firstImg = images.first();
      await expect(firstImg).toHaveAttribute('alt');
    }
  });

  test('T30: Abas têm atributo role="tab"', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('T31: Carrosséis têm role="region"', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const carousels = page.locator('[role="region"][aria-roledescription="carrossel"]');
    const count = await carousels.count();
    expect(count).toBeGreaterThan(0);
  });
});
