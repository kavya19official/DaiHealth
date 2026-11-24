"""Acceptance test against a running, synthetic DaiHealth instance."""

import io
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image
from playwright.sync_api import expect, sync_playwright


def main():
    origin = os.getenv("DAI_TEST_URL", "http://127.0.0.1:3001")
    email = os.getenv("DAI_TEST_PATIENT", "mother-syn-0000085@dai-synthetic.invalid")
    assert email.endswith("@dai-synthetic.invalid")
    password = os.getenv("DAI_TEST_PASSWORD", "Dai-Synthetic-2026!")
    token = str(uuid4())[:8]
    title = "A photo for our album " + token
    diary_title = "How today felt " + token
    letter_title = "Dear little one " + token
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.getenv("DAI_TEST_CHROMIUM"), args=["--no-sandbox"]
        )
        session = browser.new_context(viewport={"width":1280,"height":900})
        login = session.request.post(origin + "/api/auth/login", data={"email":email,"password":password})
        assert login.ok, login.text()
        page = session.new_page()
        page.goto(origin + "/dashboard.html", wait_until="domcontentloaded")
        home = page.locator("#pregnancyLibraryCard")
        expect(home.get_by_text("Week ",exact=False)).to_be_visible()
        home.get_by_role("button",name="Explore My Journey").click()
        panel = page.locator("#panel-pregnancy-library")
        expect(panel.get_by_role("heading",name="Your pregnancy timeline")).to_be_visible(timeout=12000)
        expect(panel.get_by_role("progressbar")).to_be_visible()
        if os.getenv("DAI_EXPECT_LIBRARY_DEMO") == "true":
            panel.get_by_role("button",name="Memory gallery").click()
            expect(panel.get_by_role("button",name="A first glimpse",exact=False)).to_be_visible()
            panel.get_by_role("button",name="Timeline").click()
        panel.get_by_text("First trimester · Weeks 1–12",exact=True).click()
        panel.get_by_role("button",name="Week 8",exact=True).click()
        expect(panel.get_by_role("heading",name="Week 8",exact=True)).to_be_visible()
        panel.get_by_role("button",name="+ Add a memory for this week").click()
        dialog = page.get_by_role("dialog")
        expect(dialog.get_by_label("Pregnancy week")).to_have_value("8")
        dialog.get_by_label("Title").fill(title)
        dialog.get_by_label("Description").fill("The light was peach this morning.")
        preview = io.BytesIO()
        Image.new("RGB",(80,120),"plum").save(preview,format="PNG")
        movie_path = Path(__file__).resolve().parents[2] / "backend/test-fixtures/pregnancy-library.mp4"
        dialog.get_by_label("Add photos or an MP4 video").set_input_files([
            {"name":"new-keepsake.png","mimeType":"image/png","buffer":preview.getvalue()},
            {"name":"another-keepsake.png","mimeType":"image/png","buffer":preview.getvalue()},
            {"name":"small-video.mp4","mimeType":"video/mp4","buffer":movie_path.read_bytes()},
        ])
        expect(dialog.get_by_alt_text("Photo preview")).to_have_count(2)
        dialog.get_by_role("button",name="Save memory").click()
        expect(panel.get_by_text("Memory saved.",exact=True)).to_be_visible()
        panel.get_by_role("button",name="Memory gallery").click()
        panel.get_by_role("button",name=title,exact=False).click()
        expect(dialog.get_by_role("img")).to_have_count(2)
        expect(dialog.get_by_text("The light was peach this morning.")).to_be_visible()
        page.wait_for_function("Array.from(document.querySelectorAll('#pl-dialog img')).every(img => img.complete && img.naturalWidth > 0)")
        video = dialog.locator("video")
        assert video.evaluate("async video => { video.muted = true; await video.play(); return video.videoWidth; }") > 0
        video.evaluate("video => video.pause()")
        media_path = video.get_attribute("src")
        assert session.request.get(origin + media_path,headers={"Range":"bytes=0-10"}).status == 206
        for account, expected in [("mother",404),("doctor",403)]:
            foreign = browser.new_context()
            other = foreign.request.post(origin + "/api/auth/login", data={
                "email":account + "@dai-synthetic.invalid","password":password,
            })
            assert other.ok, other.text()
            assert foreign.request.get(origin + media_path).status == expected
            foreign.close()
        dialog.get_by_role("button",name="Edit memory").click()
        dialog.get_by_label("Title").fill(title + " edited")
        dialog.get_by_role("button",name="Remove",exact=True).first.click()
        dialog.get_by_role("button",name="Save memory").click()
        expect(panel.get_by_role("button",name=title + " edited",exact=False)).to_be_visible()
        panel.get_by_role("button",name="Private diary").click()
        panel.get_by_role("button",name="Write a diary entry").click()
        dialog.get_by_label("Title").fill(diary_title)
        dialog.get_by_label("Diary entry",exact=True).fill("A little tired and excited.")
        dialog.get_by_role("button",name="Save diary entry").click()
        expect(panel.get_by_role("button",name=diary_title,exact=False)).to_be_visible()
        panel.get_by_role("button",name="Letters to My Baby").click()
        panel.get_by_role("button",name="Write a letter").click()
        dialog.get_by_label("Title").fill(letter_title)
        dialog.get_by_label("Letter",exact=True).fill("Dear little one, I have a song for you.")
        dialog.get_by_role("button",name="Save letter").click()
        expect(panel.get_by_role("button",name=letter_title,exact=False)).to_be_visible()
        panel.get_by_role("button",name="Milestones").click()
        ultrasound = panel.locator(".pl-moment").filter(has_text="First ultrasound")
        expect(ultrasound.get_by_text("Ready to record",exact=True)).to_be_visible()
        expect(panel.locator(".pl-moment").filter(has_text="Estimated delivery date").get_by_text("Estimated",exact=True)).to_be_visible()
        page.reload(wait_until="domcontentloaded")
        expect(panel.get_by_role("heading",name="Your pregnancy timeline")).to_be_visible()
        page.set_viewport_size({"width":390,"height":844})
        for tab, saved in [("Memory gallery",title + " edited"),("Private diary",diary_title),
                           ("Letters to My Baby",letter_title)]:
            panel.get_by_role("button",name=tab,exact=True).click()
            panel.get_by_role("button",name=saved,exact=False).click()
            expect(dialog).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            page.once("dialog",lambda popup: popup.accept())
            dialog.get_by_role("button",name="Delete").click()
            expect(panel.get_by_text("Entry deleted.",exact=True)).to_be_visible()
            expect(panel.get_by_role("button",name=saved,exact=False)).to_have_count(0)
        browser.close()
    print("PASS: Mother Dashboard, weekly timeline, multi-photo upload, video playback, owner-only media, edits, diary, letters, refresh and mobile layout.")


if __name__ == "__main__":
    main()
