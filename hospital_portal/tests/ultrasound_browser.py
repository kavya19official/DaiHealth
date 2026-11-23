"""Run separately against a started local DaiHealth demo with no ultrasound model configured."""
import argparse
from io import BytesIO
import os
import random
import sqlite3

from PIL import Image
from playwright.sync_api import expect, sync_playwright


def png(flat):
    rng = random.Random(71)
    image = Image.new("L", (128, 128), 120)
    if not flat:
        image.putdata([rng.randrange(30, 230) for _ in range(128 * 128)])
    result = BytesIO()
    image.save(result, "PNG")
    return result.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:3001")
    parser.add_argument("--db", default=".local/portal.db")
    args = parser.parse_args()
    with sqlite3.connect(args.db) as conn:
        staff, patient, patient_name = conn.execute("""
            SELECT u.email, m.source_id, json_extract(m.details, '$.name')
            FROM mother m JOIN portal_user u
            ON u.facility_id=m.registered_facility_id AND u.unit_id=m.assigned_unit_id
            WHERE u.role='consultant' AND u.verified=1
            AND lower(json_extract(m.details, '$.stage')) IN ('t1','t2','t3')
            AND NOT EXISTS(SELECT 1 FROM ultrasound_analysis a WHERE a.mother_id=m.id)
            ORDER BY m.id LIMIT 1
        """).fetchone()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.getenv("DAI_TEST_CHROMIUM"), args=["--no-sandbox"],
        )
        context = browser.new_context()
        base = args.url + "/hospital-admin"
        headers = {"x-dai-client": "portal"}
        result = context.request.post(base + "/api/auth/login", headers=headers, data={
            "email": staff, "password": "Dai-Synthetic-2026!",
        })
        assert result.ok, result.text()
        challenge = result.json()
        result = context.request.post(base + "/api/auth/otp", headers=headers, data={
            "challenge_id": challenge["challenge_id"], "code": challenge["demo_otp"],
        })
        assert result.ok, result.text()
        page = context.new_page()
        page.set_default_timeout(25000)
        page.goto(base, wait_until="domcontentloaded")
        expect(page.get_by_role("button", name="Ultrasound AI Review")).to_be_visible()

        def open_patient():
            page.get_by_role("button", name="Patient registry").click()
            search = page.get_by_label("Find a mother")
            with page.expect_response(lambda response:
                "/api/patients?" in response.url and ("q=" + patient) in response.url) as response:
                search.fill(patient)
            assert response.value.ok
            row = page.get_by_role("row").filter(has=page.get_by_text(patient_name, exact=True))
            row.get_by_role("button", name="Open record").click()
            expect(page.get_by_role("heading", name="Upload ultrasound for review")).to_be_visible()

        open_patient()
        upload = page.get_by_role("region", name="Upload ultrasound")
        upload.get_by_label("Ultrasound image").set_input_files({
            "name": "invalid.png", "mimeType": "image/png", "buffer": b"invalid",
        })
        upload.get_by_role("button", name="Upload for review").click()
        expect(upload.get_by_role("alert")).to_contain_text("Invalid")
        upload.get_by_label("Ultrasound image").set_input_files({
            "name": "flat.png", "mimeType": "image/png", "buffer": png(True),
        })
        upload.get_by_role("button", name="Upload for review").click()
        review = page.get_by_role("region", name="Ultrasound AI Review")
        expect(review.get_by_text("Image quality issue", exact=True)).to_be_visible()
        review.get_by_role("button", name="View ultrasound image").click()
        preview = review.get_by_role("img", name="Ultrasound frame submitted for clinician review")
        expect(preview).to_be_visible()
        assert preview.get_attribute("src").startswith("blob:")
        page.wait_for_function("() => [...document.images].some(i => i.src.startsWith('blob:') && i.naturalWidth === 128)")
        review.get_by_label("Review decision").select_option("replacement_requested")
        review.get_by_label("Clinician comments").fill("Synthetic browser fixture: replacement requested.")
        review.get_by_role("button", name="Record ultrasound review").click()
        expect(review.get_by_text("Reviewed by clinician", exact=True)).to_be_visible()

        open_patient()
        upload.get_by_label("Ultrasound image").set_input_files({
            "name": "frame.png", "mimeType": "image/png", "buffer": png(False),
        })
        upload.get_by_role("button", name="Upload for review").click()
        expect(review.get_by_text("Model unavailable", exact=True)).to_be_visible()
        expect(review.get_by_text("Passed raster checks", exact=True)).to_be_visible()
        with page.expect_response(lambda response: response.url.endswith("/retry")) as retried:
            review.get_by_role("button", name="Retry analysis").click()
        assert retried.value.ok and retried.value.json()["state"] == "model_unavailable"
        review.get_by_role("button", name="Back to review queue").click()
        review.get_by_label("Review status").select_option("true")
        expect(review.get_by_text("Image quality issue", exact=True)).to_be_visible()
        review.get_by_role("button", name="Open ultrasound review").first.click()
        expect(review.get_by_text("Synthetic browser fixture: replacement requested.")).to_be_visible()
        browser.close()
    print("PASS: live gateway, clinician login, patient upload, invalid image, quality issue, private preview, "
          "review persistence, no-model fallback and inference retry")


if __name__ == "__main__":
    main()
