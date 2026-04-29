#!/usr/bin/env python3
"""Package report evidence artifacts into <=10 MB ZIP attachments."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import zipfile
from pathlib import Path


DEFAULT_MAX_BYTES = 10 * 1024 * 1024
PRIMARY_LAYOUT_FILENAMES = ("report.md", "steps.py")
IMAGE_EXTENSIONS = {
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".heif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}
OUTPUT_FILENAMES = {
    "command_output.log",
    "output.log",
    "output.txt",
    "outputs.txt",
    "raw_output.log",
    "raw_output.txt",
}


def summarize_layout(root: Path, included: list[Path]) -> tuple[list[dict[str, int | str]], list[str]]:
    primary_files = []
    present_names = {path.name for path in included}

    for name in PRIMARY_LAYOUT_FILENAMES:
        path = root / name
        if path in included:
            primary_files.append({"path": name, "size": file_size(path)})

    missing = [name for name in PRIMARY_LAYOUT_FILENAMES if name not in present_names]
    return primary_files, missing


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create non-image ZIP evidence bundles for report attachments."
    )
    parser.add_argument("workdir", type=Path, help="Report artifact directory.")
    parser.add_argument(
        "--report-id",
        help="Platform report ID. When set, ZIPs are copied under loots/reports/<report-id>/.",
    )
    parser.add_argument(
        "--loots-root",
        type=Path,
        default=Path("loots") / "reports",
        help="Report attachment root. Default: loots/reports",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help="Maximum attachment size in bytes. Default: 10 MiB",
    )
    parser.add_argument(
        "--bundle-prefix",
        default="attachments",
        help="ZIP filename prefix. Default: attachments",
    )
    parser.add_argument(
        "--include-images",
        action="store_true",
        help="Include image files in ZIPs. Default is to keep screenshots separate.",
    )
    parser.add_argument(
        "--include-output-files",
        action="store_true",
        help="Include output.txt/raw output logs. Default is to keep proof output only in the description.",
    )
    return parser.parse_args()


def file_size(path: Path) -> int:
    return path.stat().st_size


def should_skip(path: Path, root: Path, bundle_prefix: str) -> bool:
    if not path.is_file():
        return True

    rel = path.relative_to(root)
    if any(part.startswith(".") for part in rel.parts):
        return True

    name = path.name
    if name == "attachments_manifest.json":
        return False

    return name.startswith(bundle_prefix) and path.suffix.lower() == ".zip"


def collect_files(
    root: Path,
    include_images: bool,
    include_output_files: bool,
    bundle_prefix: str,
) -> tuple[list[Path], list[Path], list[Path]]:
    included: list[Path] = []
    excluded_images: list[Path] = []
    excluded_outputs: list[Path] = []

    for path in sorted(root.rglob("*")):
        if should_skip(path, root, bundle_prefix):
            continue
        if not include_images and path.suffix.lower() in IMAGE_EXTENSIONS:
            excluded_images.append(path)
            continue
        if not include_output_files and path.name.lower() in OUTPUT_FILENAMES:
            excluded_outputs.append(path)
            continue
        included.append(path)

    return included, excluded_images, excluded_outputs


def write_manifest(
    root: Path,
    included: list[Path],
    excluded_images: list[Path],
    excluded_outputs: list[Path],
    max_bytes: int,
    include_images: bool,
    include_output_files: bool,
) -> Path:
    manifest_path = root / "attachments_manifest.json"
    primary_files, missing_primary_files = summarize_layout(root, included)
    manifest = {
        "policy": {
            "purpose": "Non-image report evidence bundle",
            "maxBytesPerAttachment": max_bytes,
            "imagesKeptSeparate": not include_images,
            "outputFilesKeptInDescription": not include_output_files,
        },
        "layout": {
            "preferredFiles": list(PRIMARY_LAYOUT_FILENAMES),
            "presentPreferredFiles": primary_files,
            "missingPreferredFiles": missing_primary_files,
        },
        "includedFiles": [
            {"path": str(path.relative_to(root)), "size": file_size(path)} for path in included
        ],
        "excludedImages": [
            {"path": str(path.relative_to(root)), "size": file_size(path)}
            for path in excluded_images
        ],
        "excludedOutputs": [
            {"path": str(path.relative_to(root)), "size": file_size(path)}
            for path in excluded_outputs
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest_path


def make_zip(root: Path, files: list[Path], out_path: Path) -> int:
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(root))
    return file_size(out_path)


def fits(root: Path, files: list[Path], max_bytes: int) -> bool:
    with tempfile.NamedTemporaryFile(suffix=".zip") as tmp:
        size = make_zip(root, files, Path(tmp.name))
    return size <= max_bytes


def split_into_bundles(root: Path, files: list[Path], max_bytes: int) -> list[list[Path]]:
    bundles: list[list[Path]] = []
    current: list[Path] = []

    for path in files:
        candidate = current + [path]
        if candidate and fits(root, candidate, max_bytes):
            current = candidate
            continue

        if current:
            bundles.append(current)
            current = [path]

        if not fits(root, current, max_bytes):
            rel = path.relative_to(root)
            raise SystemExit(
                f"{rel} cannot fit into a {max_bytes} byte ZIP. "
                "Trim the file or attach a smaller excerpt."
            )

    if current:
        bundles.append(current)
    return bundles


def create_bundles(root: Path, bundles: list[list[Path]], prefix: str) -> list[Path]:
    outputs: list[Path] = []
    multi = len(bundles) > 1

    for index, files in enumerate(bundles, start=1):
        name = f"{prefix}_part{index}.zip" if multi else f"{prefix}.zip"
        out_path = root / name
        make_zip(root, files, out_path)
        outputs.append(out_path)

    return outputs


def copy_to_loots(paths: list[Path], loots_root: Path, report_id: str) -> list[Path]:
    target_dir = loots_root / report_id
    target_dir.mkdir(parents=True, exist_ok=True)

    copied: list[Path] = []
    for path in paths:
        target = target_dir / path.name
        shutil.copy2(path, target)
        copied.append(target)
    return copied


def copy_images_to_loots(images: list[Path], root: Path, loots_root: Path, report_id: str) -> list[Path]:
    target_dir = loots_root / report_id / "images"
    copied: list[Path] = []

    for path in images:
        rel = path.relative_to(root)
        target = target_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied.append(target)

    return copied


def copy_manifest_to_loots(manifest_path: Path, loots_root: Path, report_id: str) -> Path:
    target_dir = loots_root / report_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / manifest_path.name
    shutil.copy2(manifest_path, target)
    return target


def write_submission_list(
    target_dir: Path,
    primary_files: list[dict[str, int | str]],
    missing_primary_files: list[str],
    zip_paths: list[Path],
    image_paths: list[Path],
    manifest_path: Path,
) -> Path:
    output = target_dir / "SUBMISSION_FILES.md"
    lines = [
        "# Manual Submission Files",
        "",
        "Upload these files to the competition problem infrastructure.",
        "Each ZIP is capped at 10 MiB. Images are kept separate for fullscreen screenshot rules.",
        "",
        "## Canonical Report Files",
    ]

    if primary_files:
        lines.extend(
            f"- `{item['path']}` ({item['size']} bytes, included in ZIP evidence)"
            for item in primary_files
        )
    else:
        lines.append("- None detected")

    if missing_primary_files:
        lines.extend(f"- Missing preferred file: `{name}`" for name in missing_primary_files)

    lines.extend([
        "",
        "## ZIP Evidence",
    ])

    if zip_paths:
        lines.extend(f"- `{path.name}` ({file_size(path)} bytes)" for path in zip_paths)
    else:
        lines.append("- None")

    lines.extend(["", "## Image Evidence"])
    if image_paths:
        lines.extend(
            f"- `{path.relative_to(target_dir)}` ({file_size(path)} bytes)" for path in image_paths
        )
    else:
        lines.append("- None")

    lines.extend(
        [
            "",
            "## Manifest",
            f"- `{manifest_path.name}` ({file_size(manifest_path)} bytes)",
            "",
        ]
    )
    output.write_text("\n".join(lines))
    return output


def main() -> int:
    args = parse_args()
    root = args.workdir.resolve()
    if not root.is_dir():
        raise SystemExit(f"Report artifact directory not found: {root}")

    included, excluded_images, excluded_outputs = collect_files(
        root,
        args.include_images,
        args.include_output_files,
        args.bundle_prefix,
    )
    manifest_path = write_manifest(
        root,
        included,
        excluded_images,
        excluded_outputs,
        args.max_bytes,
        args.include_images,
        args.include_output_files,
    )
    if manifest_path not in included:
        included.append(manifest_path)
    included = sorted(set(included))
    primary_files, missing_primary_files = summarize_layout(root, included)

    if not included:
        raise SystemExit("No non-image evidence files found to package.")

    bundles = split_into_bundles(root, included, args.max_bytes)
    outputs = create_bundles(root, bundles, args.bundle_prefix)

    print("Created ZIP attachments:")
    for path in outputs:
        print(f"- {path} ({file_size(path)} bytes)")

    copied: list[Path] = []
    if args.report_id:
        copied = copy_to_loots(outputs, args.loots_root, args.report_id)
        copied_images = copy_images_to_loots(
            excluded_images,
            root,
            args.loots_root,
            args.report_id,
        )
        copied_manifest = copy_manifest_to_loots(manifest_path, args.loots_root, args.report_id)
        target_dir = args.loots_root / args.report_id
        submission_list = write_submission_list(
            target_dir,
            primary_files,
            missing_primary_files,
            copied,
            copied_images,
            copied_manifest,
        )

        print("Prepared manual submission loot path:")
        for path in copied:
            print(f"- {path} ({file_size(path)} bytes)")
        for path in copied_images:
            print(f"- {path} ({file_size(path)} bytes)")
        print(f"- {copied_manifest} ({file_size(copied_manifest)} bytes)")
        print(f"- {submission_list} ({file_size(submission_list)} bytes)")

    if excluded_images:
        print("Images kept separate:")
        for path in excluded_images:
            print(f"- {path.relative_to(root)} ({file_size(path)} bytes)")

    if excluded_outputs:
        print("Output files excluded from attachments:")
        for path in excluded_outputs:
            print(f"- {path.relative_to(root)} ({file_size(path)} bytes)")

    if primary_files:
        print("Canonical report files detected:")
        for item in primary_files:
            print(f"- {item['path']} ({item['size']} bytes)")
    if missing_primary_files:
        print("Missing preferred report files:")
        for name in missing_primary_files:
            print(f"- {name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
