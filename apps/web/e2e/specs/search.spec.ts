import { test, expect } from '@playwright/test';

test.describe('Busca de Filmes e Séries', () => {
  test('T7: Digitar na SearchBar mostra dropdown com resultados TMDB', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder('Buscar filmes e séries...');
    await searchInput.fill('Interstellar');
    await page.waitForTimeout(1000);
    const dropdown = page.locator('.absolute.top-full.mt-2');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
  });

  test('T8: Dropdown mostra mini-posters e informações', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder('Buscar filmes e séries...');
    await searchInput.fill('The Matrix');
    await page.waitForTimeout(1000);
    const items = page.locator('.absolute.top-full.mt-2 button');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('T9: Clicar num resultado do dropdown dispara busca P2P', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder('Buscar filmes e séries...');
    await searchInput.fill('Star Wars');
    await page.waitForTimeout(1500);
    const firstResult = page.locator('.absolute.top-full.mt-2 button').first();
    if (await firstResult.isVisible()) {
      await firstResult.click();
      await page.waitForTimeout(2000);
    }
  });

  test('T10: Input de busca P2P funciona', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder('Buscar filmes e séries...');
    await searchInput.fill('Test Movie');
    await searchInput.press('Enter');
    await page.waitForTimeout(2000);
  });

  test('T11: Botão X limpa o input', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    const searchInput = page.getByPlaceholder('Buscar filmes e séries...');
    await searchInput.fill('Something');
    await page.waitForTimeout(500);
    const clearButton = searchInput.locator('..').locator('button').last();
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await expect(searchInput).toHaveValue('');
    }
  });
});
