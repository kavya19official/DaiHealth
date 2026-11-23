"""Train an auditable archive-label classifier only after an eligible dataset audit."""
import argparse
from collections import Counter
import hashlib
from pathlib import Path
import os
import random
from zipfile import ZipFile

import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp, softmax
from sklearn.metrics import (average_precision_score, classification_report, confusion_matrix,
                             f1_score, log_loss, roc_auc_score)

from .audit import CLASSES, SPLITS, audit, dump, sha_file
from .imaging import PREPROCESS, QUALITY, decode, preprocess

WEIGHTS = "efficientnet_b0_state.pt"
LOW_CONFIDENCE = .80
NON_NORMAL_SCORE = .30


def fit_temperature(logits, labels):
    def nll(log_temperature):
        scaled = logits / np.exp(log_temperature)
        return (logsumexp(scaled, axis=1) - scaled[np.arange(len(labels)), labels]).mean()
    result = minimize_scalar(nll, bounds=(-3, 3), method="bounded")
    if not result.success or not np.isfinite(result.fun):
        raise ValueError("Temperature fitting failed")
    return float(np.exp(result.x))


def metrics(labels, probabilities):
    predicted = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    retained = (predicted == 0) & (confidence >= LOW_CONFIDENCE) & (probabilities[:, 1:].sum(axis=1) < NON_NORMAL_SCORE)
    class_ids = list(range(len(CLASSES)))
    targets = np.eye(len(CLASSES))[labels]
    bins = []
    ece = 0.
    for low, high in zip(np.arange(0., 1., 0.1), np.arange(0.1, 1.01, 0.1)):
        inside = (confidence >= low) & ((confidence < high) if high < 0.999 else (confidence <= 1))
        if inside.any():
            accuracy = float((predicted[inside] == labels[inside]).mean())
            average = float(confidence[inside].mean())
            n = int(inside.sum())
            ece += n / len(labels) * abs(accuracy-average)
            bins.append(dict(lower=float(low), upper=float(high), count=n, accuracy=accuracy, confidence=average))
    auc, ap = {}, {}
    for i, label in enumerate(CLASSES):
        usable = len(np.unique(targets[:, i])) == 2
        auc[label] = float(roc_auc_score(targets[:, i], probabilities[:, i])) if usable else None
        ap[label] = float(average_precision_score(targets[:, i], probabilities[:, i])) if usable else None
    macro_auc = float(np.mean(list(auc.values()))) if all(v is not None for v in auc.values()) else None
    report = classification_report(labels, predicted, labels=class_ids, target_names=CLASSES,
                                   output_dict=True, zero_division=0)
    return dict(per_class=report, macro_f1=report["macro avg"]["f1-score"],
        weighted_f1=report["weighted avg"]["f1-score"],
        confusion_matrix=confusion_matrix(labels, predicted, labels=class_ids).tolist(),
        class_order=CLASSES, roc_auc_ovr=auc, macro_roc_auc_ovr=macro_auc, pr_auc_average_precision=ap,
        brier_multi=float(((probabilities-targets)**2).sum(axis=1).mean()),
        log_loss=float(log_loss(labels,probabilities,labels=class_ids)),
        top_label_ece=ece,reliability_bins=bins,samples=int(len(labels)),
        research_threshold_only=dict(retained_count=int(retained.sum()),
            non_normal_labels_among_retained=int(((labels!=0)&retained).sum()),
            note="Score-only policy exercise on prefiltered records; excludes the image quality gate."))


def approve_dataset(archive, groups, review):
    report = audit(archive, groups)
    if report["blockers"]:
        raise ValueError("Training blocked: " + "; ".join(report["blockers"]))
    for key in ("grouping_provenance", "label_reference_standard", "reviewer"):
        if not isinstance(review.get(key), str) or not review[key].strip():
            raise ValueError("Dataset review must document " + key)
    if (review.get("archive_sha256") != report["archive_sha256"] or
        review.get("group_map_sha256") != report["group_map_sha256"] or review.get("approved_for_research") is not True):
        raise ValueError("Written research approval must match the archive and group map")
    return report


def train(args):
    import json
    review = json.loads(args.review.read_text(encoding="utf-8"))
    report = approve_dataset(args.archive,args.groups,review)
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    import torch
    from torch import nn
    import torchvision
    from torchvision.models import efficientnet_b0, EfficientNet_B0_Weights

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(args.threads)
    device = torch.device(args.device)
    records = {split:[row for row in report["records"] if row["split"]==split and "excluded" not in row]
               for split in SPLITS}

    class Images(torch.utils.data.Dataset):
        def __init__(self, rows):
            self.rows = rows
            self.archive = ZipFile(args.archive)

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, key):
            row = self.rows[key]
            raw = self.archive.read(row["path"])
            if hashlib.sha256(raw).hexdigest()!=row["bytes_sha256"]:
                raise ValueError("Image bytes changed after audit")
            return torch.from_numpy(preprocess(decode(raw))), CLASSES.index(row["label"])

    class_weights = Counter(row["label"] for row in records["train"])
    weights = [len(records["train"])/(len(CLASSES)*class_weights[label]) for label in CLASSES]
    criterion = nn.CrossEntropyLoss(weight=torch.tensor(weights,device=device,dtype=torch.float32))
    model = efficientnet_b0(weights=EfficientNet_B0_Weights.IMAGENET1K_V1)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features,len(CLASSES))
    model.to(device)

    datasets = [Images(records[split]) for split in SPLITS]
    try:
        rng = torch.Generator().manual_seed(args.seed)
        train_loader,val_loader,test_loader = [
            torch.utils.data.DataLoader(ds,batch_size=args.batch_size,shuffle=(index==0),
                                        generator=rng if index==0 else None)
            for index,ds in enumerate(datasets)]
        history,best_state,best_f1 = [],None,-1.
        for mode, epochs, lr in (("head", args.head_epochs, 1e-3), ("last_block",args.fine_epochs,1e-4)):
            model.features.requires_grad_(False)
            if mode=="last_block":
                model.features[-2:].requires_grad_(True)
            optimizer=torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),lr=lr)
            for epoch in range(1, epochs+1):
                model.train()
                model.features.eval()  # Fixed batch-normalization statistics on the small cohort.
                total=0.
                for image,label in train_loader:
                    optimizer.zero_grad(set_to_none=True)
                    loss=criterion(model(image.to(device)),label.to(device))
                    loss.backward()
                    optimizer.step()
                    total += float(loss.detach())*len(label)
                logit,true = collect(model,val_loader,device,torch)
                macro=float(f1_score(true,logit.argmax(axis=1),labels=list(range(len(CLASSES))),
                                     average="macro",zero_division=0))
                history.append(dict(phase=mode,epoch=epoch,loss=total/len(datasets[0]),validation_macro_f1=macro))
                if macro>best_f1:
                    best_f1=macro
                    best_state={key:value.detach().cpu().clone() for key,value in model.state_dict().items()}
            model.load_state_dict(best_state)

        val_logits,val_labels=collect(model,val_loader,device,torch)
        temperature=fit_temperature(val_logits,val_labels)
        test_logits,test_labels=collect(model,test_loader,device,torch)
        evaluation={"validation_calibration":metrics(val_labels,softmax(val_logits/temperature,axis=1)),
                    "test_uncalibrated":metrics(test_labels,softmax(test_logits,axis=1)),
                    "test_calibrated":metrics(test_labels,softmax(test_logits/temperature,axis=1))}
    finally:
        for ds in datasets:
            ds.archive.close()
    args.output.mkdir(parents=True,exist_ok=False)
    torch.save(best_state,args.output/WEIGHTS)
    dump(args.output/"report.json",dict(history=history,**evaluation))
    dump(args.output/"dataset_audit.json",report)
    dump(args.output/"model.json",dict(schema=1,architecture="efficientnet_b0",weights_sha256=sha_file(args.output/WEIGHTS),
        classes=CLASSES,preprocess=PREPROCESS,quality=QUALITY,temperature=temperature,seed=args.seed,
        report_sha256=sha_file(args.output/"report.json"),archive_sha256=report["archive_sha256"],
        audit_sha256=sha_file(args.output/"dataset_audit.json"),
        audit_version=report["audit_version"],group_map_sha256=report["group_map_sha256"],review_sha256=sha_file(args.review),
        torch_version=torch.__version__,torchvision_version=torchvision.__version__,training_pretrained="IMAGENET1K_V1",
        class_weights=weights,epochs=[args.head_epochs,args.fine_epochs],batch_size=args.batch_size,
        review_policy={"low_confidence":LOW_CONFIDENCE,"non_normal_score":NON_NORMAL_SCORE},research_only=True))


def collect(model, loader, device, torch):
    model.eval()
    logits,labels=[],[]
    with torch.inference_mode():
        for image,target in loader:
            logits.append(model(image.to(device)).cpu().numpy().astype(np.float64))
            labels.append(target.numpy())
    return np.concatenate(logits),np.concatenate(labels)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("archive",type=Path)
    parser.add_argument("--groups",type=Path,required=True)
    parser.add_argument("--review",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--head-epochs",type=int,default=5)
    parser.add_argument("--fine-epochs",type=int,default=10)
    parser.add_argument("--batch-size",type=int,default=24)
    parser.add_argument("--threads",type=int,default=4)
    parser.add_argument("--seed",type=int,default=713)
    parser.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    args=parser.parse_args()
    if args.head_epochs<1 or args.fine_epochs<0 or args.batch_size<1 or args.threads<1:
        parser.error("Positive head epochs, batch size and threads required; fine epochs may be zero")
    if args.output.exists():
        parser.error("Choose a new artifact directory")
    try:
        train(args)
    except ValueError as e:
        parser.error(str(e))


if __name__=="__main__":
    main()
