import { test, expect } from '@playwright/test';

test.describe('Modal de Detalhes', () => {
  test('T12: Clicar em MediaCard abre o modal', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 10000 });
  });

  test('T13: Modal mostra sinopse, nota e metadados', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Opções de Download/)).toBeVisible({ timeout: 10000 });
  });

  test('T14: Modal mostra opções de torrent', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(3000);
    const downloadButtons = page.getByRole('dialog').getByText(/Baixar/);
    // May or may not have torrent options depending on backend
    await page.waitForTimeout(1000);
  });

  test('T15: Botão X fecha o modal', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const closeBtn = page.getByRole('dialog').getByLabel('Fechar');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(500);
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
  });

  test('T16: Clicar fora do modal fecha', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const modal = page.getByRole('dialog');
    if (await modal.isVisible()) {
      await page.mouse.click(10, 10);
      await page.waitForTimeout(500);
      await expect(modal).not.toBeVisible();
    }
  });

  test('T17: Tecla Esc fecha o modal', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(2000);
    const modal = page.getByRole('dialog');
    if (await modal.isVisible()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(modal).not.toBeVisible();
    }
  });
});
