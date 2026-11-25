"""Two signed-in browsers exercising Doctor Connect in the local synthetic workspace."""
import os
import re

from playwright.sync_api import expect, sync_playwright

ORIGIN = os.getenv("DAI_TEST_URL", "http://localhost:3001")
PASSWORD = os.getenv("DAI_TEST_PASSWORD", "Dai-Synthetic-2026!")
EXPECT_CONNECTED = os.getenv("DAI_TEST_EXPECT_CONNECTED", "true") == "true"


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.getenv("DAI_TEST_CHROMIUM"),
            args=["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        )
        pages = []
        signals = set()
        for role, account, path in [
            ("doctor", "doctor", "doctor.html"),
            ("mother", "mother", "dashboard.html"),
        ]:
            context = browser.new_context(
                viewport={"width": 390 if role == "mother" else 768, "height": 844},
                is_mobile=True, has_touch=True, permissions=["microphone"], service_workers="block",
            )
            page = context.new_page()

            def record_signal(response):
                if response.ok and response.request.method == "POST" and response.url.endswith("/signals"):
                    signals.add(response.request.post_data_json["type"])

            page.on("response", record_signal)
            page.goto(f"{ORIGIN}/auth.html?role={role}", wait_until="domcontentloaded")
            page.locator("#loginEmail").fill(f"{account}@dai-synthetic.invalid")
            page.locator("#loginPassword").fill(PASSWORD)
            page.locator("#loginSubmit").click()
            # A delivered demo patient's sign-in may open the child workspace.
            page.wait_for_url(re.compile(r"/(doctor|dashboard|child-dashboard)\.html"))
            if not page.url.endswith(path):
                page.goto(f"{ORIGIN}/{path}", wait_until="domcontentloaded")
            pages.append(page)
        doctor, mother = pages

        doctor.get_by_role("button", name="Open consultation inbox").tap()
        inbox = doctor.get_by_role("dialog", name="Incoming Patient Requests")
        inbox.get_by_label("Availability for new requests").select_option("available")
        expect(inbox.get_by_text("Current status", exact=False)).to_contain_text("available")
        mother.get_by_role("button", name="Talk to a Doctor Now").tap()
        connect = mother.get_by_role("dialog", name="Connect to a Doctor")
        expect(connect).to_be_visible()
        assert connect.evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")

        connect.get_by_label("What would you like help with?").fill("Synthetic demo: discuss a report with the clinician.")
        connect.get_by_label("Concern category").select_option("report")
        connect.get_by_label("I think this may be an emergency", exact=False).check()
        expect(connect.get_by_role("link", name="call 112 in India")).to_have_attribute("href", "tel:112")
        connect.get_by_label("Share my concern and identity", exact=False).check()
        connect.get_by_role("button", name="Send request").tap()
        expect(connect.get_by_text("Request sent to a doctor", exact=True)).to_be_visible(timeout=15000)
        expect(inbox.get_by_text("Synthetic demo: discuss a report", exact=False)).to_have_count(0)
        inbox.get_by_role("button", name="Accept request").tap()
        expect(connect.get_by_text("Doctor has accepted.", exact=False)).to_be_visible(timeout=15000)
        expect(inbox.get_by_text("Patient’s concern", exact=True)).to_be_visible(timeout=15000)
        expect(inbox.get_by_text("Synthetic demo: discuss a report", exact=False).first).to_be_visible()
        assert inbox.evaluate("(el) => el.scrollWidth <= el.clientWidth + 1")

        mother_button = connect.get_by_role("button", name="Join audio call")
        doctor_button = inbox.locator("[data-connect-clinical]").get_by_role("button", name="Join audio call")
        for page, button in [(mother,mother_button),(doctor,doctor_button)]:
            button.tap()
            media = page.locator("dialog").filter(has=page.get_by_role("heading", name="Doctor Connect audio call"))
            expect(media).to_be_visible()
            media.get_by_role("button", name="Join audio call").tap()
        if EXPECT_CONNECTED:
            for page in pages:
                expect(page.get_by_text("Audio or video connected.", exact=True)).to_be_visible(timeout=35000)
        else:
            # Some headless runners expose no ICE network interfaces. The app must keep
            # this state distinct from a connected consultation.
            for _ in range(40):
                if {"offer", "answer"} <= signals:
                    break
                mother.wait_for_timeout(250)
            assert {"offer", "answer"} <= signals
            expect(inbox.get_by_text("Consultation started", exact=False)).to_have_count(0)
            expect(connect.get_by_text("Consultation started", exact=True)).to_have_count(0)
        for page in pages:
            page.get_by_role("button", name="Close remote follow-up").tap()

        clinical = inbox.locator("[data-connect-clinical]")
        clinical.get_by_label("Clinical observations").fill("Synthetic observation recorded during the demo call.")
        clinical.get_by_label("Guidance provided").fill("Synthetic demo follow-up guidance.")
        clinical.get_by_label("Outcome").select_option("follow_up" if EXPECT_CONNECTED else "unable_to_connect")
        clinical.get_by_label("Recommend a Nearby Care facility").select_option(index=1)
        clinical.get_by_role("button", name="Release guidance and complete").tap()
        summary = connect.locator("summary").filter(has_text="Consultation completed").first
        expect(summary).to_be_visible(timeout=15000)
        summary.tap()
        expect(connect.get_by_text("Synthetic demo follow-up guidance.", exact=False)).to_be_visible()
        expect(connect.get_by_text("Recommended facility", exact=True)).to_be_visible()
        connect.get_by_role("button", name="Nearby Care").tap()
        expect(mother.locator("#panel-facilities")).to_be_visible(timeout=12000)
        mother.evaluate("location.hash = 'records'")
        mother.get_by_role("button", name="Doctor Connect history").tap()
        expect(connect.get_by_text("Consultation history", exact=True)).to_be_visible()
        browser.close()
    transport = "real WebRTC peer connection" if EXPECT_CONNECTED else "WebRTC offer/answer and honest unconnected state"
    print(f"PASS: mobile sign-in, {transport}, clinician release, history and Nearby Care.")


if __name__ == "__main__":
    main()
