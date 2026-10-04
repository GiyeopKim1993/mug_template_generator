"""Shared helpers for tests: the print-settings dialog is a modal now."""


async def open_print(page):
    await page.evaluate("document.getElementById('printModal').classList.add('open')")
    await page.wait_for_timeout(80)


async def close_print(page):
    await page.evaluate("document.getElementById('printModal').classList.remove('open')")
    await page.wait_for_timeout(80)
