"""Browser acceptance test against the running full local synthetic application."""
from io import BytesIO
import os
import random

from PIL import Image
from playwright.sync_api import expect, sync_playwright


def frame():
    pixels = random.SystemRandom().randbytes(160 * 160)
    data = BytesIO()
    Image.frombytes("L", (160, 160), pixels).save(data, "PNG")
    return {"name":"synthetic-frame.png","mimeType":"image/png","buffer":data.getvalue()}


def main():
    origin = os.getenv("DAI_TEST_URL", "http://127.0.0.1:3001")
    patient_email = os.environ["DAI_TEST_PATIENT"]
    doctor_email = os.environ["DAI_TEST_DOCTOR"]
    password = os.getenv("DAI_TEST_PASSWORD", "Dai-Synthetic-2026!")
    assert patient_email.endswith("@dai-synthetic.invalid") and doctor_email.endswith("@dai-synthetic.invalid")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.getenv("DAI_TEST_CHROMIUM"),
                                             args=["--no-sandbox"])
        patient, doctor = browser.new_context(), browser.new_context()
        for email, context in [(patient_email,patient),(doctor_email,doctor)]:
            login = context.request.post(origin+"/api/auth/login",data={"email":email,"password":password})
            assert login.ok, login.text()
        mother_id = patient.request.get(origin+"/api/auth/me").json()["user"]["id"]
        page = patient.new_page()
        page.goto(origin+"/dashboard.html",wait_until="domcontentloaded")
        page.get_by_role("button", name="Ultrasound scans", exact=True).click()
        form = page.locator("#panel-ultrasound form")
        form.get_by_label("Ultrasound image").set_input_files(frame())
        doctor_select = form.get_by_role("combobox")
        doctor_id = doctor.request.get(origin+"/api/auth/me").json()["user"]["id"]
        doctor_select.select_option(str(doctor_id))
        form.get_by_role("checkbox").check()
        with page.expect_response(lambda r: "/api/patient/ultrasound?doctor=" in r.url and
                                  r.request.method == "POST") as result:
            form.get_by_role("button",name="Upload for review").click()
        assert result.value.ok, result.value.text()
        expect(page.get_by_text("Scan uploaded for review.",exact=True)).to_be_visible(timeout=20000)
        patient_api = origin+"/api/patient/ultrasound"
        before = patient.request.get(patient_api).json()["items"][0]
        assert before["status"] == "pending" and before["report"] is None
        assert "analysis" not in before and "note" not in before
        scan_id = before["id"]

        clinical = doctor.new_page()
        clinical.goto(origin+"/doctor.html",wait_until="domcontentloaded")
        clinical.get_by_role("button",name="Ultrasound Review",exact=True).click()
        clinical.locator("#panel-ultrasound").get_by_role("combobox",name="Choose a patient").select_option(str(mother_id))
        review = clinical.locator("#panel-ultrasound article").first
        expect(review.get_by_text("Model unavailable",exact=True)).to_be_visible()
        expect(review.get_by_text("Passed raster checks.",exact=True)).to_be_visible()
        review.get_by_role("button",name="View scan image").click()
        expect(review.get_by_role("img",name="Uploaded ultrasound frame")).to_be_visible()
        clinical.wait_for_function("document.querySelector('#panel-ultrasound img').naturalWidth === 160")
        review.get_by_role("button",name="Start review").click()
        expect(review.get_by_text("Under review",exact=True)).to_be_visible()
        review.get_by_role("combobox",name="Choose a decision").select_option("follow_up_needed")
        review.get_by_label("Clinical findings to share").fill("Synthetic clinician findings for this frame.")
        review.get_by_label("Next steps to share").fill("Bring the original report to your next visit.")
        review.get_by_label("Private clinician notes").fill("Private clinician test note.")
        review.get_by_role("button",name="Save review draft").click()
        expect(review.get_by_role("button",name="Release report to patient")).to_be_visible()
        draft = patient.request.get(patient_api).json()["items"][0]
        assert draft["status"] == "under_review" and draft["report"] is None
        assert not ({"analysis","note","draft"} & draft.keys())
        clinical.once("dialog",lambda dialog:dialog.accept())
        review.get_by_role("button",name="Release report to patient").click()
        expect(review.get_by_text("Released clinician report")).to_be_visible()
        page.locator("#panel-ultrasound").get_by_role("button",name="Refresh scans").click()
        report = page.locator("#panel-ultrasound article").first
        expect(report.get_by_text("Reviewed",exact=True)).to_be_visible()
        expect(report.get_by_text("Bring the original report to your next visit.",exact=True)).to_be_visible()
        expect(report.get_by_text("Private clinician test note.",exact=True)).to_have_count(0)
        report.get_by_role("button",name="View scan image").click()
        page.wait_for_function("document.querySelector('#panel-ultrasound img').naturalWidth === 160")
        assert patient.request.get(patient_api+"/"+scan_id+"/image").headers["content-type"] == "image/png"
        assert playwright.request.new_context().get(patient_api).status == 401
        browser.close()
    print("PASS: patient and doctor dashboards, private image previews, clinical draft isolation and release.")


if __name__ == "__main__":
    main()
