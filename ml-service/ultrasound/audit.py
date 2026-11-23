"""Audit original ZIP splits. Never extracts or executes archive members."""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
from io import StringIO
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import BadZipFile, ZipFile

import numpy as np
from scipy.fft import dctn
from PIL import Image

from .imaging import MAX_BYTES, QUALITY, decode, gray, quality

CLASSES = ["normal", "benign", "malignant"]
SPLITS = ("train", "validation", "test")
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
DERIVATIVE = re.compile(r"(?:^|[ _.-])(annotation|annotations|mask|masked|overlay|overlayed|segmentation)(?:[ _.-]|$)", re.I)
DISTANCE = 6
VERSION = "fetal-ultrasound-audit-v1"


def sha_file(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def dump(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def pack(bits):
    return np.packbits(bits).tobytes().hex()


def compare(records, key, radius):
    hashes = np.array([int(r[key], 16) for r in records], dtype=np.uint64)
    for i, value in enumerate(hashes):
        for j in np.flatnonzero(np.bitwise_count(hashes[i + 1:] ^ value) <= radius):
            yield i, i + 1 + int(j)


def label_metadata(z, entries):
    findings = []
    for info in entries:
        if not info.filename.lower().endswith(".csv") or info.file_size > 10_000_000:
            continue
        reader = csv.reader(StringIO(z.read(info).decode("utf-8-sig", errors="replace")))
        header = next(reader, [])
        columns = {key.strip().casefold().replace(" ", "_") for key in header}
        findings.append({"file": PurePosixPath(info.filename).name, "columns": header,
                         "rows": sum(1 for _ in reader),
                         "patient_or_study_column": bool(columns & {"patient_id", "study_id", "case_id", "subject_id"})})
    return findings


def audit(archive, groups_path=None):
    records, corrupt, unexpected, derivative_errors = [], [], [], []
    raw_counts = Counter()
    folders = Counter()
    split_roots = set()
    with ZipFile(archive) as z:
        entries = sorted((item for item in z.infolist() if not item.is_dir()), key=lambda x: x.filename)
        if len({x.filename for x in entries}) != len(entries):
            raise ValueError("Ambiguous archive with repeated paths")
        metadata = label_metadata(z, entries)
        for info in entries:
            p = PurePosixPath(info.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in info.filename:
                raise ValueError("Unsafe archive member path")
            if p.suffix.lower() not in EXTENSIONS or len(p.parts) < 3:
                continue
            split, label = p.parts[-3].lower(), p.parts[-2].lower()
            folders[split] += 1
            if split not in SPLITS:
                continue
            split_roots.add(p.parts[:-3])
            if label not in CLASSES:
                unexpected.append(info.filename)
                continue
            raw_counts[split, label] += 1
            if DERIVATIVE.search(p.stem):
                records.append(dict(path=info.filename, split=split, label=label, excluded="derivative"))
                try:
                    if info.file_size > MAX_BYTES:
                        raise ValueError("Oversized derivative")
                    decode(z.read(info))
                except (BadZipFile, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
                    derivative_errors.append(dict(path=info.filename, error=type(exc).__name__))
                continue
            try:
                if info.file_size > MAX_BYTES:
                    raise ValueError("Oversized archive image")
                raw = z.read(info)
                image = decode(raw)
                stats, defects = quality(image)
                frequency = dctn(gray(image, 32), norm="ortho")[:8, :8].flatten()
                diff = np.asarray(image.convert("L").resize((9, 8), Image.Resampling.BILINEAR))
                rgb = np.asarray(image)
                color_fraction = float(np.any(rgb != rgb[:, :, :1], axis=2).mean())
                records.append(dict(path=info.filename, split=split, label=label,
                    bytes_sha256=hashlib.sha256(raw).hexdigest(),
                    pixel_sha256=hashlib.sha256(f"{image.width}x{image.height}:".encode()+image.tobytes()).hexdigest(),
                    phash=pack(frequency > np.median(frequency[1:])),
                    dhash=pack((diff[:, 1:] > diff[:, :-1]).flatten()),
                    color_fraction=round(color_fraction, 5), quality=stats,
                    quality_reasons=defects))
            except (BadZipFile, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
                corrupt.append(dict(path=info.filename, error=type(exc).__name__))

    clean = [r for r in records if "pixel_sha256" in r]
    parents = list(range(len(clean)))
    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    def union(i, j):
        parents[root(j)] = root(i)

    exact, original = defaultdict(list), defaultdict(list)
    for i, row in enumerate(clean):
        exact[row["pixel_sha256"]].append(i)
        original[row["bytes_sha256"]].append(i)
    for values in exact.values():
        for i in values[1:]:
            union(values[0], i)
    near_pairs = []
    for i, j in compare(clean, "phash", DISTANCE):
        if clean[i]["pixel_sha256"] == clean[j]["pixel_sha256"]:
            continue
        delta = (int(clean[i]["dhash"],16) ^ int(clean[j]["dhash"],16)).bit_count()
        if delta <= DISTANCE:
            union(i,j)
            near_pairs.append((i,j))

    # Unrelated files often reuse numeric filename stems. Never treat filenames as patient IDs.
    group_map = {}
    if groups_path:
        with open(groups_path, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            if not {"path", "group_id"} <= set(reader.fieldnames or []):
                raise ValueError("Group CSV must contain path and group_id columns")
            for row in reader:
                if row["path"] in group_map or not row["group_id"].strip():
                    raise ValueError("Missing group identifier or repeated path")
                group_map[row["path"]] = row["group_id"].strip()
    grouped = defaultdict(list)
    for i, row in enumerate(clean):
        if row["path"] in group_map:
            grouped[group_map[row["path"]]].append(i)

    def summarize(mapping):
        return {"groups":sum(len(ids)>1 for ids in mapping.values()),
                "cross_split_groups":sum(len({clean[i]["split"] for i in ids})>1 for ids in mapping.values()),
                "cross_label_groups":sum(len({clean[i]["label"] for i in ids})>1 for ids in mapping.values())}

    clusters = defaultdict(list)
    for i in range(len(clean)):
        clusters[root(i)].append(i)
    duplicate_components = []
    for ids in clusters.values():
        rows = [clean[i] for i in ids]
        across = len({r["split"] for r in rows}) > 1
        conflict = len({r["label"] for r in rows}) > 1
        if len(rows)>1:
            duplicate_components.append({"cross_split":across,"cross_label":conflict,
                "members":[{"path":r["path"],"split":r["split"],"label":r["label"]} for r in rows]})
        if across or conflict:
            for r in rows:
                r["excluded"] = "duplicate_quarantine"
        else:
            best = min(rows,key=lambda r:(bool(r["quality_reasons"]),r["path"]))
            for r in rows:
                if r is not best:
                    r["excluded"] = "within_split_repeat"
    for row in clean:
        if row["quality_reasons"] and "excluded" not in row:
            row["excluded"] = "quality_heuristic"
    group_stats = summarize(grouped)
    group_complete = bool(clean) and len(clean) == sum(len(ids) for ids in grouped.values())
    accepted = [r for r in clean if "excluded" not in r]
    found = Counter((r["split"],r["label"]) for r in accepted)
    def counts(freq):
        return {s:{label:freq[s,label] for label in CLASSES} for s in SPLITS}
    blockers = []
    if len(split_roots)!=1:
        blockers.append("Archive must contain one unambiguous train/validation/test root")
    if unexpected:
        blockers.append("Unrecognized label folders")
    if not group_complete:
        blockers.append("No complete independently verified patient/study group map")
    if group_stats["cross_split_groups"]:
        blockers.append("Patient/study groups cross original splits")
    if not all(found[s,label]>0 for s in SPLITS for label in CLASSES):
        blockers.append("At least one split lost a class")
    if any(x["cross_label"] for x in duplicate_components):
        blockers.append("Cross-label pixel/near-duplicate candidates require source-label adjudication")
    dimensions = Counter((r["quality"]["width"],r["quality"]["height"]) for r in clean)
    return dict(audit_version=VERSION, archive_sha256=sha_file(archive),
        group_map_sha256=sha_file(groups_path) if groups_path else None,
        frequent_image_sizes=[dict(width=w,height=h,images=n) for (w,h),n in dimensions.most_common(10)],
        original_counts=counts(raw_counts), eligible_counts=counts(found), image_folders=dict(folders),
        derivative_counts=counts(Counter((r["split"],r["label"]) for r in records if r.get("excluded")=="derivative")),
        corrupt=corrupt, derivative_errors=derivative_errors, unexpected=unexpected, metadata=metadata,
        exact_bytes=summarize(original), exact_pixels=summarize(exact),
        near_duplicate_pairs=len(near_pairs),
        near_cross_split_pairs=sum(clean[i]["split"]!=clean[j]["split"] for i,j in near_pairs),
        duplicate_components=duplicate_components,
        quality_counts=counts(Counter((r["split"],r["label"]) for r in clean if r["quality_reasons"])),
        quality_thresholds=QUALITY, perceptual_distance=DISTANCE,
        colored_counts=counts(Counter((r["split"],r["label"]) for r in clean if r["color_fraction"]>0.01)),
        patient_groups={**group_stats,"complete":group_complete},
        blockers=blockers, records=records)


def main():
    p=argparse.ArgumentParser()
    p.add_argument("archive",type=Path)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--groups",type=Path)
    args=p.parse_args()
    result=audit(args.archive,args.groups)
    dump(args.output,result)
    print(json.dumps({k:v for k,v in result.items() if k not in {"records","duplicate_components"}},indent=2))


if __name__ == "__main__":
    main()
