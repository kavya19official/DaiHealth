"""Browser acceptance test against the running full local synthetic application."""
import io
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image
from playwright.sync_api import expect, sync_playwright


def frame(live):
    assets = Path(__file__).resolve().parents[2]/"frontend/assets/ultrasound-demo"
    if live:
        top = Image.open(assets / "abdomen_1427.png").convert("RGB")
        bottom = Image.open(assets / "thorax_1466.png").convert("RGB")
        image = Image.new("RGB", (top.width, top.height + bottom.height + 12), "white")
        image.paste(top, (0, 0))
        image.paste(bottom, (0, top.height + 12))
    else:
        image = Image.open(assets / "brain_1013.png").convert("RGB")
    # Give each acceptance run a new digest without changing the scan content.
    image.putpixel((0, 0), tuple(uuid4().bytes[:3]))
    png = io.BytesIO()
    image.save(png, "PNG")
    return {"name":"scan-views.png","mimeType":"image/png","buffer":png.getvalue()}, image.width


def main():
    origin = os.getenv("DAI_TEST_URL", "http://127.0.0.1:3001")
    patient_email = os.environ["DAI_TEST_PATIENT"]
    doctor_email = os.environ["DAI_TEST_DOCTOR"]
    password = os.getenv("DAI_TEST_PASSWORD", "Dai-Synthetic-2026!")
    assert patient_email.endswith("@dai-synthetic.invalid") and doctor_email.endswith("@dai-synthetic.invalid")
    live = os.getenv("DAI_TEST_EXPECT_SONONET") == "true"
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
        missing_route = "**/api/patient/ultrasound/options"
        page.route(missing_route, lambda route: route.fulfill(
            status=404, content_type="text/html", body="Cannot GET /api/patient/ultrasound/options",
        ))
        page.get_by_role("button", name="Ultrasound scans", exact=True).click()
        expect(page.locator("#pageTitle")).to_have_text("Ultrasound scans")
        expect(page.get_by_role("alert").filter(has_text="does not have the ultrasound route")).to_be_visible()
        page.unroute(missing_route)
        page.get_by_role("button", name="Try again", exact=True).click()
        if live:
            expect(page.get_by_text("Live AI ready · SonoNet16",exact=True)).to_be_visible(timeout=15000)
        form = page.locator("#panel-ultrasound form")
        test_frame, width = frame(live)
        form.get_by_label("Ultrasound image").set_input_files(test_frame)
        expect(form.get_by_role("img",name="Selected ultrasound frame")).to_be_visible()
        doctor_select = form.get_by_role("combobox")
        doctor_id = doctor.request.get(origin+"/api/auth/me").json()["user"]["id"]
        doctor_select.select_option(str(doctor_id))
        form.get_by_role("checkbox").check()
        with page.expect_response(lambda r: "/api/patient/ultrasound?doctor=" in r.url and
                                  r.request.method == "POST") as result:
            form.get_by_role("button",name="Upload & analyze").click()
        assert result.value.ok, result.value.text()
        expect(page.get_by_text("Scan uploaded for review.",exact=True)).to_be_visible(timeout=20000)
        scan_id = result.value.json()["id"]
        patient_scan = page.locator(f'[data-scan-id="{scan_id}"]')
        expect(patient_scan.get_by_text("Your scan is in your doctor’s review queue.",exact=False)).to_be_visible(timeout=30000)
        patient_api = origin+"/api/patient/ultrasound"
        before = patient.request.get(patient_api).json()["items"][0]
        assert before["status"] == "pending" and before["report"] is None
        assert "analysis" not in before and "note" not in before
        assert before["assessment"]["grade"] in ("good","acceptable"), before
        if live:
            assert before["assessment"]["state"] == "plane_analysis", before
            assert "inference" in before["assessment"]["steps"] and before["assessment"]["model_ran"]
            assert [view["label"] for view in before["assessment"]["planes"]] == ["abdomen", "four_chamber"]
            expect(patient_scan.get_by_text("Abdominal view",exact=True)).to_be_visible()
            expect(patient_scan.get_by_text("Four-chamber heart view",exact=True)).to_be_visible()
        else:
            assert before["assessment"]["state"] == "model_unavailable", before
            assert before["assessment"]["steps"] == ["quality","report"], before
            assert not before["assessment"]["model_ran"]
        assert scan_id == before["id"] and not result.value.json()["duplicate"]
        assert before["assessment"]["flag"]["category"] == "review_recommended"
        assert before["assessment"]["started_at"] <= before["assessment"]["finished_at"]
        upload_url = patient_api + "?doctor=" + str(doctor_id)
        upload_headers = {"Content-Type":"image/png", "x-dai-ultrasound":"upload",
                          "x-dai-ultrasound-consent":"yes"}
        assert patient.request.post(upload_url, data=b"invalid PNG", headers=upload_headers).status == 422
        duplicate = patient.request.post(upload_url, data=test_frame["buffer"], headers=upload_headers)
        assert duplicate.json() == {"id":scan_id,"duplicate":True}
        if not live:
            patient_scan.get_by_role("button",name="Retry AI analysis").click()
            expect(page.get_by_text("Analysis queued for this scan.",exact=True)).to_be_visible()
            expect(patient_scan.get_by_text("AI analysis unavailable.",exact=False)).to_be_visible(timeout=35000)
        page.reload(wait_until="domcontentloaded")
        page.get_by_role("button", name="Ultrasound scans", exact=True).click()
        expect(patient_scan.get_by_text("Review recommended",exact=True)).to_be_visible()

        doctor_image = doctor.request.get(origin + f"/api/doctor/patients/{mother_id}/ultrasound/{scan_id}/image")
        assert doctor_image.ok, doctor_image.status
        original = Image.open(io.BytesIO(test_frame["buffer"])).convert("RGB")
        private = Image.open(io.BytesIO(doctor_image.body())).convert("RGB")
        assert private.tobytes() == original.tobytes()
        clinical = doctor.new_page()
        clinical.goto(origin+"/doctor.html",wait_until="domcontentloaded")
        clinical.get_by_role("button",name="Ultrasound Review",exact=True).click()
        clinical.locator("#panel-ultrasound").get_by_role("combobox",name="Choose a patient").select_option(str(mother_id))
        review = clinical.locator("#panel-ultrasound article").first
        expect(review.get_by_text("Scan views analyzed" if live else "Model unavailable",exact=True)).to_be_visible()
        expect(review.get_by_text("Passed basic image checks",exact=False)).to_be_visible()
        expect(review.get_by_role("img",name="Uploaded ultrasound frame")).to_be_visible()
        clinical.wait_for_function("document.querySelector('#panel-ultrasound article img').naturalWidth === %d" % width)
        review.get_by_role("button",name="Start review").click()
        expect(review.get_by_text("Under review",exact=True)).to_be_visible()
        review.get_by_role("combobox",name="Choose a decision").select_option("follow_up_needed")
        if live:
            review.get_by_role("combobox",name="Choose how you reviewed the scan").select_option("corrected")
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
        page.bring_to_front()
        report = page.locator("#panel-ultrasound article").first
        expect(report.get_by_text("Reviewed by doctor",exact=True)).to_be_visible(timeout=15000)
        expect(report.get_by_text("Bring the original report to your next visit.",exact=True)).to_be_visible()
        expect(report.get_by_text("Private clinician test note.",exact=True)).to_have_count(0)
        page.wait_for_function("document.querySelector('#panel-ultrasound article img').naturalWidth === %d" % width)
        page.set_viewport_size({"width": 390, "height": 844})
        assert report.locator(".uw-scan-layout").evaluate(
            "(layout) => getComputedStyle(layout).gridTemplateColumns.split(' ').length === 1"
        )
        assert patient.request.get(patient_api+"/"+scan_id+"/image").headers["content-type"] == "image/png"
        assert playwright.request.new_context().get(patient_api).status == 401
        poor_frame = io.BytesIO()
        poor_image = Image.new("RGB", (128, 128), (48, 48, 48))
        poor_image.putpixel((0, 0), tuple(uuid4().bytes[:3]))
        poor_image.save(poor_frame, format="PNG")
        poor_upload = patient.request.post(upload_url, data=poor_frame.getvalue(), headers=upload_headers)
        assert poor_upload.status == 201, poor_upload.text()
        poor_id = poor_upload.json()["id"]
        page.get_by_role("button", name="Refresh scans").click()
        poor = page.locator(f'[data-scan-id="{poor_id}"]')
        expect(poor.get_by_text("Poor", exact=True)).to_be_visible(timeout=15000)
        assert patient.request.get(patient_api+"/"+poor_id).json()["assessment"]["model_ran"] is False
        browser.close()
    print("PASS: patient and doctor dashboards, private image previews, clinical draft isolation and release.")


if __name__ == "__main__":
    main()
