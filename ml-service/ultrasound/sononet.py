"""CPU inference for the published SonoNet16 research plane classifier."""
import argparse
from hashlib import sha256
from io import BytesIO
import os
from pathlib import Path
import tempfile

import numpy as np
from PIL import Image
from scipy.special import softmax
from threadpoolctl import threadpool_limits

from .imaging import quality

BUNDLED_WEIGHTS = Path(__file__).resolve().parent / "assets/SonoNet16.npz"
RUNTIME = "numpy-v1"
WEIGHTS_SHA256 = "bbbf9dde2b3af686c247a3074d890ceb685cd63fc1fc2af7e704edc07810c53f"
CLASSES = ("three_vessel", "four_chamber", "abdomen", "background", "brain_cerebellum",
           "brain_transventricular", "femur", "kidneys", "lips", "left_outflow",
           "profile", "right_outflow", "spine_coronal", "spine_sagittal")


def verify_weights(data):
    if sha256(data).hexdigest() != WEIGHTS_SHA256:
        raise ValueError("SonoNet16 checkpoint checksum mismatch")
    return data


def install(destination):
    destination = Path(destination)
    if destination.is_file():
        try:
            verify_weights(destination.read_bytes())
            return
        except ValueError:
            pass
    data = verify_weights(BUNDLED_WEIGHTS.read_bytes())
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
        scratch = Path(temporary.name)
        try:
            temporary.write(data)
            temporary.close()
            os.replace(scratch, destination)
        finally:
            scratch.unlink(missing_ok=True)


def load(weights):
    layers = []
    # The Lasagne checkpoint stores convolution weights followed by beta,
    # gamma, running mean and inverse standard deviation. Fold batch
    # normalization into the convolution for inference.
    with np.load(BytesIO(verify_weights(Path(weights).read_bytes())), allow_pickle=False) as archive:
        for layer in range(15):
            weight, beta, gamma, mean, inv_std = (archive[f"arr_{5*layer+i}"] for i in range(5))
            scale = gamma * inv_std
            kernel = np.ascontiguousarray((weight * scale[:, None, None, None]).reshape(len(scale), -1).T)
            layers.append((kernel, beta - mean * scale, weight.shape[-1]))

    def forward(image):
        # NHWC patches flattened in channel, kernel row, kernel column order
        # match the checkpoint's OIHW filters. The convolutions use zero padding.
        activation = image.transpose(1, 2, 0)
        for index, (kernel, bias, size) in enumerate(layers):
            height, width, _ = activation.shape
            if size > 1:
                pad = size // 2
                padded = np.pad(activation, ((pad, pad), (pad, pad), (0, 0)))
                patches = np.lib.stride_tricks.sliding_window_view(padded, (size, size), axis=(0, 1))
            else:
                patches = activation
            activation = (patches.reshape(height * width, -1) @ kernel + bias).reshape(height, width, -1)
            if index < len(layers) - 1:
                np.maximum(activation, 0, out=activation)
            if index in (1, 3, 6, 9):
                activation = activation.reshape(height//2, 2, width//2, 2, -1).max(axis=(1, 3))
        return activation.mean(axis=(0, 1), dtype=np.float64)

    def predict(frames):
        # Cap BLAS threads on developer laptops and shared demo servers.
        with threadpool_limits(limits=2, user_api="blas"):
            logits = np.stack([forward(image) for image in frames])
        return softmax(logits, axis=1)

    return predict


def panels(image):
    """Detect a bright horizontal page gutter between two stacked views."""
    width, height = image.size
    # Sample the central width so narrow outer print borders have no vote.
    gray = np.asarray(image.convert("L"))[:, width//10:width-width//10]
    filled = (gray >= 230).mean(axis=1) >= .92
    edges = np.flatnonzero(np.diff(np.r_[False, filled, False]))
    candidates = [(int(top), int(bottom)) for top, bottom in zip(edges[::2], edges[1::2])
                  if top >= max(96, height * .25) and height - bottom >= max(96, height * .25)
                  and 3 <= bottom - top <= height * .08]
    if len(candidates) != 1:
        return [("whole", image)]
    top, bottom = candidates[0]
    return [("top", image.crop((0, 0, width, top))),
            ("bottom", image.crop((0, bottom, width, height)))]


def preprocess(image):
    # Reproduce the source example for its original uncropped scanner layout.
    if image.size == (975, 735):
        image = image.crop((81, 115, 874, 734))
    rgb = np.asarray(image.resize((288, 224), Image.Resampling.BILINEAR), dtype=np.float32)
    gray = rgb.mean(axis=2)
    spread = float(gray.std())
    if spread < 1e-6:
        raise ValueError("Insufficient variation after plane preprocessing")
    return ((gray - gray.mean()) * np.float32(255.0 / spread))[None, :, :]


def classify(image, predictor, progress):
    progress("preprocessing")
    views = panels(image)
    usable = [(name, preprocess(view.convert("RGB"))) for name, view in views if not quality(view)[1]]
    if not usable:
        return [{"view": name, "state": "quality_issue"} for name, _ in views]
    progress("inference")
    probabilities = np.asarray(predictor(np.stack([tensor for _, tensor in usable])), dtype=float)
    if (probabilities.shape != (len(usable), len(CLASSES)) or not np.isfinite(probabilities).all()
            or (probabilities < 0).any() or (probabilities > 1).any()
            or not np.allclose(probabilities.sum(axis=1), 1, atol=1e-6, rtol=0)):
        raise ValueError("Invalid SonoNet16 probabilities")
    results = {}
    for (name, _), scores in zip(usable, probabilities, strict=True):
        index = int(scores.argmax())
        results[name] = {"view": name, "state": "classified", "label": CLASSES[index], "score": float(scores[index])}
    return [results.get(name, {"view": name, "state": "quality_issue"}) for name, _ in views]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Copy the bundled, verified SonoNet16 weights.")
    parser.add_argument("destination", type=Path)
    install(parser.parse_args().destination)
