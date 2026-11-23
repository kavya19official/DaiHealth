"""Shared raster decoding, quality heuristics, and preprocessing."""
from io import BytesIO
import warnings

import numpy as np
from PIL import Image, ImageOps

FORMATS = {"PNG", "JPEG", "BMP", "TIFF", "WEBP"}
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 16_000_000
PREPROCESS = {"size": 224, "mode": "grayscale_replicated_rgb", "resize": "bilinear_letterbox_black",
              "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]}
QUALITY = {"min_side": 96, "min_std": 8.0, "min_dynamic_range": 28, "min_focus": 2.0}


def decode(raw):
    if not raw or len(raw) > MAX_BYTES:
        raise ValueError("Empty image or image exceeds the byte limit")
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(raw)) as image:
            if image.format not in FORMATS or getattr(image, "n_frames", 1) != 1:
                raise ValueError("A supported single-frame raster image is required")
            if image.width * image.height > MAX_PIXELS:
                raise ValueError("Image exceeds the pixel limit")
            image.load()
            return ImageOps.exif_transpose(image).convert("RGB")


def gray(image, size):
    return np.asarray(image.convert("L").resize((size, size), Image.Resampling.BILINEAR),
                      dtype=np.float32)


def quality(image):
    a = gray(image, 128)
    p5, p95 = np.percentile(a, [5, 95])
    core = a[1:-1, 1:-1]
    laplacian = a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4 * core
    stats = {"width": image.width, "height": image.height, "std": round(float(a.std()), 3),
             "dynamic_range": round(float(p95-p5), 3), "focus": round(float(laplacian.var()), 3)}
    reasons = []
    if min(image.size) < QUALITY["min_side"]:
        reasons.append("small_image")
    if stats["std"] < QUALITY["min_std"] or stats["dynamic_range"] < QUALITY["min_dynamic_range"]:
        reasons.append("low_contrast")
    if stats["focus"] < QUALITY["min_focus"]:
        reasons.append("low_detail")
    return stats, reasons


def preprocess(image):
    sized = ImageOps.pad(image.convert("L"), (PREPROCESS["size"],) * 2,
                         method=Image.Resampling.BILINEAR, color=0).convert("RGB")
    tensor = np.asarray(sized, dtype=np.float32).transpose(2, 0, 1) / 255
    mean = np.asarray(PREPROCESS["mean"], dtype=np.float32)[:, None, None]
    std = np.asarray(PREPROCESS["std"], dtype=np.float32)[:, None, None]
    return (tensor - mean) / std
