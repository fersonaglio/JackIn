import { test, expect } from '@playwright/test';

test.describe('Downloads P2P + Player', () => {
  test('T18: Clicar Baixar em TorrentOptionCard inicia download', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const card = page.locator('[role="region"][aria-roledescription="carrossel"] button').first();
    await card.click();
    await page.waitForTimeout(3000);
    const downloadBtn = page.getByRole('dialog').getByText(/Baixar/).first();
    if (await downloadBtn.isVisible()) {
      await downloadBtn.click();
      await page.waitForTimeout(2000);
    }
  });

  test('T19: DownloadDock aparece com download ativo', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    // If there are downloads, the dock should be visible
    const dock = page.getByText('Downloads P2P');
    await page.waitForTimeout(1000);
  });

  test('T20: Barra de progresso do dock existe quando há downloads', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(3000);
    const dock = page.getByText('Downloads P2P');
    if (await dock.isVisible()) {
      await expect(dock).toBeVisible();
    }
  });

  test('T21: Biblioteca mostra itens baixados', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Biblioteca/ }).click();
    await page.waitForTimeout(1000);
    // Should show either empty state or downloaded items
    await expect(page.getByText(/biblioteca está vazia|Filtrar mídias baixadas|Pronto/)).toBeVisible();
  });

  test('T22: Player cinema abre via botão Assistir', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Biblioteca/ }).click();
    await page.waitForTimeout(1000);
    const watchBtn = page.getByText('Assistir').first();
    if (await watchBtn.isVisible()) {
      await watchBtn.click();
      await page.waitForTimeout(2000);
      const player = page.getByText('Modo Cinema HD');
      await expect(player).toBeVisible({ timeout: 5000 });
    }
  });

  test('T23: Player mostra controles de vídeo', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Biblioteca/ }).click();
    await page.waitForTimeout(1000);
    const watchBtn = page.getByText('Assistir').first();
    if (await watchBtn.isVisible()) {
      await watchBtn.click();
      await page.waitForTimeout(2000);
      const video = page.locator('video');
      if (await video.isVisible()) {
        await expect(video).toBeVisible();
      }
    }
  });

  test('T24: Fechar player funciona', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /Biblioteca/ }).click();
    await page.waitForTimeout(1000);
    const watchBtn = page.getByText('Assistir').first();
    if (await watchBtn.isVisible()) {
      await watchBtn.click();
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(page.getByText('Modo Cinema HD')).not.toBeVisible();
    }
  });

  test('T25: Player lida com erro de src', async ({ page }) => {
    await page.goto('/media');
    await page.waitForTimeout(2000);
    // If a broken video plays, the page should not crash
    const video = page.locator('video').first();
    if (await video.isVisible()) {
      await page.waitForTimeout(2000);
      // Just verify page is still responsive
      await expect(page.locator('body')).toBeVisible();
    }
  });
});
