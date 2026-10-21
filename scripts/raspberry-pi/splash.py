"""replace only the image in an existing Raspberry Pi Plymouth theme."""

import argparse
import configparser
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


def splash_target(themes=Path("/usr/share/plymouth/themes")):
    theme = subprocess.run(
        ["plymouth-set-default-theme"], check=True, capture_output=True, text=True,
    ).stdout.strip()
    if theme not in ("pix", "pixflat"):
        raise ValueError(f"unsupported active Plymouth theme: {theme!r}; existing theme was left unchanged")
    directory = themes / theme
    metadata = configparser.ConfigParser(interpolation=None)
    metadata.read_string((directory / f"{theme}.plymouth").read_text())
    if metadata.get("Plymouth Theme", "ModuleName") != "script":
        raise ValueError("expected the Raspberry Pi script-based Plymouth theme")
    if Path(metadata.get("script", "ImageDir")).resolve() != directory.resolve():
        raise ValueError("active Plymouth theme uses an unexpected image directory")
    script = Path(metadata.get("script", "ScriptFile"))
    if script.resolve().parent != directory.resolve() or "splash.png" not in script.read_text():
        raise ValueError("active Plymouth script does not use the expected splash image")
    target = directory / "splash.png"
    if target.is_symlink() or not target.is_file():
        raise ValueError("expected a regular existing Plymouth splash.png")
    return target


def replace_splash(image, target):
    with image.open("rb") as source:
        header = source.read(33)
    if (len(header) != 33 or header[:8] != b"\x89PNG\r\n\x1a\n"
            or header[8:16] != b"\x00\x00\x00\rIHDR"
            or not all(struct.unpack(">II", header[16:24]))):
        raise ValueError("splash image must be a PNG with nonzero dimensions")
    backup = target.with_name(target.name + ".before-freqhole-pi")
    if backup.is_symlink():
        raise ValueError("refusing a symlink as the original-image backup")
    if not backup.exists():
        with backup.open("xb") as output, target.open("rb") as source:
            shutil.copyfileobj(source, output)
            output.flush()
            os.fsync(output.fileno())
        backup.chmod(0o644)
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
        staged = Path(output.name)
        try:
            with image.open("rb") as source:
                shutil.copyfileobj(source, output)
            output.flush()
            os.fsync(output.fileno())
            staged.chmod(0o644)
            staged.replace(target)
        finally:
            staged.unlink(missing_ok=True)
    return backup


def install_splash(image, boot=Path("/boot")):
    if not shutil.which("plymouth-set-default-theme") or not shutil.which("update-initramfs"):
        raise ValueError("existing Plymouth and initramfs-tools are required; boot configuration was not changed")
    if not any(path.is_file() and path.stat().st_size for path in boot.glob("initrd.img-*")):
        raise ValueError("no existing initramfs found; refusing to enable/change the boot system")
    target = splash_target()
    backup = replace_splash(image, target)
    print(f"splash image installed; original: {backup}; rebuilding initramfs...", flush=True)
    # keep the selected theme and firmware/kernel configuration unchanged.
    subprocess.run(["update-initramfs", "-u", "-k", "all"], check=True)
    print("splash ready for the next reboot; firmware rainbow and boot settings were not changed.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("run through setup.sh with sudo")
    try:
        install_splash(args.image)
    except (OSError, ValueError, configparser.Error, subprocess.SubprocessError) as error:
        parser.exit(1, f"splash setup failed: {error}\n"
                    "if the image was installed, its original backup is retained; fix the error and rerun "
                    "to rebuild initramfs before rebooting.\n")


if __name__ == "__main__":
    main()
