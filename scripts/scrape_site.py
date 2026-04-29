"""
Scrape a target URL and save its rendered HTML to a .txt file.

Uses Playwright so single-page-apps render properly, and auto-clicks
common cookie-banner accept buttons before saving.

One-time setup:
    uv add playwright
    uv run playwright install chromium

Usage:
    Edit TARGET_URL below, then:
        uv run python scripts/scrape_site.py

    Or pass a URL on the command line:
        uv run python scripts/scrape_site.py https://example.com
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

TARGET_URL = "https://www.zahnspangen.de/?gad_source=1&gad_campaignid=71290859&gbraid=0AAAAAD13Cw99vnkzJKg3I84Q9mafTn9Fh&gclid=Cj4KCQjw2MbPBhCSARItAP3jP9yZQdITC6MqWeDLaWTbFKlDKmC09bTKmhw60CEPWj-5RxT9q6_nkYt-GgIuZhAC8P8HAQ"
OUTPUT_DIR = Path("scraped")
HEADLESS = True
PAGE_TIMEOUT_MS = 30_000
NETWORK_IDLE_TIMEOUT_MS = 10_000

ACCEPT_SELECTORS = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I accept")',
    'button:has-text("Allow all")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
    'button:has-text("Zustimmen")',
    'button:has-text("Einverstanden")',
    "#onetrust-accept-btn-handler",
    "#cookiescript_accept",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    ".cmp-button-accept",
    ".cookie-accept",
    '[data-testid="uc-accept-all-button"]',
    '[aria-label*="accept" i]',
]


def safe_filename(url: str) -> str:
    parsed = urlparse(url)
    base = (parsed.netloc + parsed.path).rstrip("/")
    cleaned = re.sub(r"[^a-zA-Z0-9.-]", "_", base)
    return cleaned or "page"


def dismiss_cookies(page) -> bool:
    for selector in ACCEPT_SELECTORS:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=500):
                locator.click(timeout=2_000)
                page.wait_for_timeout(500)
                print(f"  - Dismissed cookie banner via: {selector}")
                return True
        except Exception:
            continue
    print("  - No cookie banner detected (or already dismissed)")
    return False


def scrape(url: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = OUTPUT_DIR / f"{safe_filename(url)}.txt"

    print(f"-> Scraping {url}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = context.new_page()

        page.goto(url, timeout=PAGE_TIMEOUT_MS, wait_until="domcontentloaded")

        try:
            page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_TIMEOUT_MS)
        except Exception:
            pass

        dismiss_cookies(page)
        page.wait_for_timeout(1_000)

        html = page.content()
        browser.close()

    output_file.write_text(html, encoding="utf-8")
    print(f"-> Saved {len(html):,} chars to {output_file.resolve()}")
    return output_file


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else TARGET_URL
    if not target.startswith(("http://", "https://")):
        sys.exit("URL must start with http:// or https://")
    scrape(target)
