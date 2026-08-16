import { test, expect } from '@playwright/test';

test.describe('Catálogo — Hero Banner + Carrosséis', () => {
  test('T1: Página carrega com HeroBanner visível', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const hero = page.locator('.rounded-3xl.overflow-hidden').first();
    await expect(hero).toBeVisible({ timeout: 15000 });
  });

  test('T2: CategoryRows renderizam com títulos', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const rows = page.locator('[role="region"][aria-roledescription="carrossel"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('T3: Scroll horizontal via setas funciona', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const row = page.locator('[role="region"][aria-roledescription="carrossel"]').first();
    const initialScroll = await row.evaluate((el) => el.scrollLeft);
    await row.hover();
    const rightArrow = page.locator('[aria-label="Rolar para direita"]').first();
    if (await rightArrow.isVisible()) {
      await rightArrow.click();
      await page.waitForTimeout(500);
      const newScroll = await row.evaluate((el) => el.scrollLeft);
      expect(newScroll).toBeGreaterThan(initialScroll);
    }
  });

  test('T4: Hover nos MediaCards mostra overlay com informações', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.hover();
    await expect(card.locator('.opacity-0.group-hover\\:opacity-100')).toBeVisible();
  });

  test('T5: Alternância entre abas funciona', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: 'Filmes' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('tab', { name: 'Filmes' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Séries' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('tab', { name: 'Séries' })).toHaveAttribute('aria-selected', 'true');
  });

  test('T6: Aba Biblioteca mostra grid de mídias baixadas', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Biblioteca/ }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText(/biblioteca está vazia|Filtrar mídias baixadas/)).toBeVisible();
  });
});
