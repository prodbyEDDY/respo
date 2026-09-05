import { expect, type Page } from '@playwright/test'

export async function openSettings(page: Page, section: string): Promise<void> {
  // Radix temporarily hides the parent dialog from the accessibility tree
  // until a nested select unmounts. Wait before looking for the dialog/trigger.
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0)
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  if ((await dialog.count()) > 0 && (await dialog.getAttribute('data-state')) === 'closed')
    await expect(dialog).toHaveCount(0)
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(dialog).toBeVisible()
  }
  const mobile = dialog.getByRole('combobox', { name: 'Settings section', exact: true })
  if (await mobile.isVisible()) await mobile.selectOption({ label: section })
  else if (
    (await dialog
      .getByRole('button', { name: section, exact: true })
      .getAttribute('aria-current')) !== 'page'
  )
    await dialog
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: section, exact: true })
      .click()
}

export async function settingsAction(page: Page, section: string, action: string): Promise<void> {
  await openSettings(page, section)
  await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
