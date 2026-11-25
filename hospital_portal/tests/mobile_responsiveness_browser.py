"""Run against the local synthetic DAI workspace with Playwright Chromium."""
import os
import re
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout, expect, sync_playwright

ORIGIN = os.getenv("DAI_TEST_URL", "http://localhost:3001")
VIEWPORTS = [(320, 568), (375, 667), (390, 844), (430, 932), (768, 1024), (1024, 768), (1440, 900)]
ROLES = {
    "patient": ("mother", "mother-syn-0000085", "dashboard.html"),
    "doctor": ("doctor", "doctor", "doctor.html"),
    "hospital": ("hospital", "hospital_admin", "hospital-admin"),
}


def login(page, role):
    form_role, account, destination = ROLES[role]
    page.goto(f"{ORIGIN}/auth.html?role={form_role}", wait_until="domcontentloaded")
    assert_fits(page, f"{role} sign-in")
    page.locator("#loginEmail").fill(f"{account}@dai-synthetic.invalid")
    page.locator("#loginPassword").fill(os.getenv("DAI_TEST_PASSWORD", "Dai-Synthetic-2026!"))
    page.locator("#loginSubmit").click()
    if role == "hospital":
        notice = page.locator("#hospitalOtpNotice")
        expect(notice).to_have_text(re.compile(r"\b\d{6}\b"))
        page.locator("#hospitalOtp").fill(re.search(r"\b\d{6}\b", notice.inner_text()).group())
        page.locator("#loginSubmit").click()
    page.wait_for_url(f"**/{destination}*", timeout=25000)


def assert_fits(page, label):
    viewport, scroll_width = page.evaluate(
        "() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]"
    )
    assert scroll_width <= viewport + 1, (label, viewport, scroll_width)
    assert page.evaluate("() => innerWidth") <= viewport + 1, label


def verify_dashboard(page, role, width, screenshots):
    mobile = width <= 1024
    if role == "hospital":
        shell = page.locator(".portal-shell")
        expect(shell).to_be_visible(timeout=25000)
        dismiss = page.get_by_role("button", name="Hide card (alert stays active)", exact=True)
        # The local synthetic fixture can contain active Golden Hour alerts.
        if width == VIEWPORTS[0][0]:
            try:
                dismiss.wait_for(timeout=2500)
            except PlaywrightTimeout:
                pass
        for _ in range(10):
            if not dismiss.is_visible():
                break
            assert_fits(page, "hospital incoming-patient dialog")
            dismiss.click()
        page.get_by_role("button", name="Operations", exact=True).click()
        expect(page.get_by_role("button", name="Operations", exact=True)).to_have_attribute("aria-pressed", "true")
        assert_fits(page, "hospital operations")
        if screenshots and width == 390:
            page.screenshot(path=screenshots / "dai-hospital-mobile.png", animations="disabled")
        page.get_by_role("button", name="Administration", exact=True).click()
        sidebar = page.locator("#hospital-navigation")
        if mobile:
            page.get_by_role("button", name="Open navigation", exact=True).tap()
            expect(sidebar).to_be_visible()
            page.keyboard.press("Escape")
            expect(sidebar).to_be_hidden()
            page.get_by_role("button", name="Open navigation", exact=True).tap()
        sidebar.get_by_role("button", name="Facility & staff management", exact=True).click()
        expect(sidebar.get_by_role("button", name="Facility & staff management", include_hidden=True)).to_have_attribute("aria-current", "page")
        assert_fits(page, "hospital administration")
        return

    nav = page.locator("[data-dai-mobile-nav]")
    if mobile:
        expect(nav).to_be_visible()
        for button in nav.get_by_role("button").all():
            assert button.bounding_box()["height"] >= 44
    else:
        expect(nav).to_be_hidden()
    if mobile:
        nav.locator('[data-mobile-panel="dashboard"]').tap()
    else:
        page.locator('.sidebar .nav-item[data-panel="dashboard"]').click()
    expect(page.locator("#panel-dashboard")).to_be_visible()
    assert_fits(page, f"{role} home")
    if screenshots and width == 390:
        if role == "patient":
            expect(page.locator("#homeGreetingSub")).to_have_text(re.compile(r"week \d+", re.I))
            expect(page.locator(".toast.is-show")).to_have_count(0, timeout=9000)
        page.screenshot(path=screenshots / f"dai-{role}-mobile.png", animations="disabled")
    panels = ["timeline", "records", "appointments", "profile"] if role == "patient" else [
        "patients", "appointments", "ultrasound"
    ]
    for panel in panels:
        if mobile:
            button = nav.locator(f'[data-mobile-panel="{panel}"]')
            button.tap()
            expect(button).to_have_attribute("aria-current", "page")
        elif panel == "profile":
            page.locator(".user-chip").click()
        else:
            target = page.locator(f'.sidebar .nav-item[data-panel="{panel}"]')
            group = target.locator("xpath=ancestor::details[not(@open)]")
            if group.count():
                group.locator("summary").click()
            target.click()
        expect(page.locator("#panel-" + panel)).to_be_visible()
        assert_fits(page, f"{role} {panel}")
    if mobile:
        more = nav.locator("[data-mobile-menu]")
        more.tap()
        sidebar = page.locator(".sidebar")
        expect(sidebar.get_by_role("button", name="Close navigation", exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(more).to_be_focused()
        more.tap()
        panel = "ultrasound" if role == "patient" else "settings"
        sidebar.locator(f'.nav-item[data-panel="{panel}"]').tap()
        expect(page.locator("#panel-" + panel)).to_be_visible()
        expect(more).to_have_attribute("aria-expanded", "false")
        assert_fits(page, f"{role} {panel}")


def main():
    screenshots = os.getenv("DAI_MOBILE_SCREENSHOTS")
    if screenshots:
        screenshots = Path(screenshots)
        screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.getenv("DAI_TEST_CHROMIUM"), args=["--no-sandbox"]
        )
        for role in os.getenv("DAI_TEST_MOBILE_ROLES", ",".join(ROLES)).split(","):
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                service_workers="block",
            )
            page = context.new_page()
            errors = []
            failed_apis = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("response", lambda response: failed_apis.append(
                (response.status, response.url.split("?")[0])
            ) if response.status >= 500 and "/api/" in response.url else None)
            login(page, role)
            if role == "hospital":
                expect(page.locator(".portal-shell")).to_be_visible(timeout=25000)
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                if role != "hospital":
                    page.reload(wait_until="domcontentloaded")
                verify_dashboard(page, role, width, screenshots)
                print(f"{role} {width}x{height} passed", flush=True)
            print(f"{role} uncaught errors: {sorted(set(errors))}", flush=True)
            print(f"{role} server errors: {sorted(set(failed_apis))}", flush=True)
            context.close()


if __name__ == "__main__":
    main()
