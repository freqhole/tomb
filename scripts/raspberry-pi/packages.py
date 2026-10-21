#!/usr/bin/python3 -I
"""validated Pi packages; privileged update actions accept release versions, never paths."""

import argparse
import hashlib
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import Request, urlopen


WIFI_VERSION = "v4.11.90"
APT_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "DEBIAN_FRONTEND": "noninteractive"}
WIFI_HASHES = {
    "aarch64": "4b2321e61895ab1afed5125ed70276845fcb48967e647454812ae336020ce14e",
    "armv7": "e447d8cd4d634243472dcec95f8b8e7f60dbcfd318ca8438a1da936c9a796909",
    "ui": "188d2893b5bb18ceb14dc2f6e39a07e098c77721978a5345f175cab2361b0d5c",
}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_tree(path):
    if path.is_dir():
        for directory, _, files in os.walk(path, topdown=False):
            for filename in files:
                with (Path(directory) / filename).open("rb") as source:
                    os.fsync(source.fileno())
            sync_directory(directory)
    else:
        with path.open("rb") as source:
            os.fsync(source.fileno())
    sync_directory(path.parent)


def download(url, destination, digest=None, timeout=60):
    request = Request(url, headers={"User-Agent": "freqhole-pi-setup"})
    sha256 = hashlib.sha256()
    with urlopen(request, timeout=timeout) as response, destination.open("wb") as output:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            output.write(chunk)
            sha256.update(chunk)
    if digest is not None and sha256.hexdigest() != digest:
        raise ValueError(f"download checksum mismatch: {destination.name}")


def extract(archive, destination):
    """extract only bounded regular files/directories; reject links and traversal."""
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        total = 0
        names = set()
        if len(members) > 4096:
            raise ValueError("too many archive entries")
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not (member.isdir() or member.isfile()):
                raise ValueError("unsafe release archive entry")
            if path == PurePosixPath(".") and member.isdir():
                continue
            if path in names:
                raise ValueError("duplicate release archive entry")
            names.add(path)
            total += member.size
            if total > 32 * 1024 * 1024:
                raise ValueError("release archive is too large")
        destination.mkdir(mode=0o755)
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as data, target.open("xb") as output:
                    shutil.copyfileobj(data, output)
                target.chmod(0o644)


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def install_wifi(work, architecture):
    target = {"arm64": "aarch64-unknown-linux-gnu", "armhf": "armv7-unknown-linux-gnueabihf"}[architecture]
    base = f"https://github.com/balena-os/wifi-connect/releases/download/{WIFI_VERSION}"
    binary_archive = work / "binary.tar.gz"
    ui_archive = work / "ui.tar.gz"
    download(f"{base}/wifi-connect-{target}.tar.gz", binary_archive, WIFI_HASHES[target.split("-")[0]])
    download(f"{base}/wifi-connect-ui.tar.gz", ui_archive, WIFI_HASHES["ui"])
    extract(binary_archive, work / "binary")
    extract(ui_archive, work / "ui")
    binary = work / "binary/wifi-connect"
    binary.chmod(0o755)
    version = run(str(binary), "--version")
    if "4.11.90" not in version:
        raise ValueError("Wi-Fi Connect binary version mismatch")
    if not (work / "ui/index.html").is_file():
        raise ValueError("Wi-Fi Connect UI is missing index.html")
    subprocess.run(["install", "-m", "755", str(binary), "/usr/local/bin/wifi-connect"], check=True)
    # fixed, root-owned version directory; reruns replace only files from the pinned asset.
    ui = Path("/usr/local/share/freqhole-pi/wifi-connect") / WIFI_VERSION / "ui"
    ui.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(work / "ui", ui, dirs_exist_ok=True)
    print(f"installed Wi-Fi Connect {WIFI_VERSION}")


def charnel_release(work, tag="latest"):
    release_file = work / "release.json"
    endpoint = "latest" if tag == "latest" else f"tags/{tag}"
    download(f"https://api.github.com/repos/freqhole/tomb/releases/{endpoint}", release_file, timeout=15)
    release = json.loads(release_file.read_text())
    version = release["tag_name"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version):
        raise ValueError("unexpected stable release tag")
    if tag != "latest" and version != tag:
        raise ValueError("release tag does not match the requested previous version")
    if release.get("prerelease") or release.get("draft"):
        raise ValueError("only published stable releases are supported")
    return release


def charnel_asset(release):
    tag = release["tag_name"]
    name = f"freqhole_charnel_{tag[1:]}_aarch64.deb"
    assets = [asset for asset in release["assets"] if asset["name"] == name]
    if len(assets) != 1:
        raise ValueError("release has no unique arm64 charnel package")
    asset = assets[0]
    url = f"https://github.com/freqhole/tomb/releases/download/{tag}/{name}"
    if asset["browser_download_url"] != url or not re.fullmatch(r"sha256:[a-f0-9]{64}", asset.get("digest", "")):
        raise ValueError("invalid package URL or missing SHA-256 digest")
    return url, asset["digest"][7:]


def validate_deb(deb, version):
    for field, expected in (("Package", "freqhole"), ("Version", version), ("Architecture", "arm64")):
        if run("dpkg-deb", "-f", str(deb), field) != expected:
            raise ValueError(f"unexpected Debian package {field}")


def stage_deb(work, release, filename):
    url, digest = charnel_asset(release)
    deb = work / filename
    download(url, deb, digest)
    validate_deb(deb, release["tag_name"][1:])
    deb.chmod(0o644)
    return digest


def installed_charnel(require_configured=True):
    fields = run("dpkg-query", "-W", "-f=${Status}\n${Version}\n${Architecture}", "freqhole").splitlines()
    if len(fields) != 3 or (require_configured and fields[0] != "install ok installed") or fields[2] != "arm64":
        raise ValueError("an installed arm64 charnel package is required")
    if not re.fullmatch(r"\d+\.\d+\.\d+", fields[1]):
        raise ValueError("unsupported installed charnel version")
    return fields[1]


def prepare_charnel(cache):
    current = installed_charnel()
    release = charnel_release(cache)
    version = release["tag_name"][1:]
    newer = subprocess.run(["dpkg", "--compare-versions", version, "gt", current]).returncode == 0
    if not newer:
        return {"version": current, "available": version, "update_available": False}
    destination = cache / version
    if not destination.exists():
        with tempfile.TemporaryDirectory(prefix="stage-", dir=cache) as directory:
            work = Path(directory)
            candidate_hash = stage_deb(work, release, "candidate.deb")
            previous = charnel_release(work, f"v{current}")
            previous_hash = stage_deb(work, previous, "previous.deb")
            manifest = {
                "version": version, "previous": current, "uid": os.environ.get("SUDO_UID", "0"),
                "candidate_sha256": candidate_hash, "previous_sha256": previous_hash,
            }
            (work / "manifest.json").write_text(json.dumps(manifest))
            work.chmod(0o755)
            sync_tree(work)
            work.rename(destination)
            sync_directory(cache)
    manifest = json.loads((destination / "manifest.json").read_text())
    if manifest["previous"] != current or manifest["uid"] != os.environ.get("SUDO_UID", "0"):
        raise ValueError("staged update belongs to another version/account; administrator must review the package cache")
    # resolve/cache dependencies before the app is stopped; stdout remains a JSON-only protocol.
    subprocess.run(["apt-get", "update", "-qq"], check=True, env=APT_ENV, stdout=sys.stderr)
    subprocess.run(["apt-get", "install", "--download-only", "--no-remove", "-y",
                    str(destination / "candidate.deb")], check=True, env=APT_ENV, stdout=sys.stderr)
    return {**manifest, "update_available": True}


def apply_charnel(cache, version, rollback=False):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version or ""):
        raise ValueError("expected a stable release version, not a path")
    directory = cache / version
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest["uid"] != os.environ.get("SUDO_UID", "0") or manifest["version"] != version:
        raise ValueError("staged update belongs to another account/version")
    expected_current = version if rollback else manifest["previous"]
    current = installed_charnel(require_configured=False)
    target = manifest["previous"] if rollback else version
    if current not in (expected_current, target):
        raise ValueError("installed package changed since this update was prepared")
    filename = "previous" if rollback else "candidate"
    deb = directory / f"{filename}.deb"
    if hashlib.sha256(deb.read_bytes()).hexdigest() != manifest[f"{filename}_sha256"]:
        raise ValueError("staged package checksum mismatch")
    validate_deb(deb, target)
    subprocess.run(
        ["apt-get", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold",
         "install", "-y", "--no-remove", "--allow-downgrades", str(deb)],
        env=APT_ENV,
        check=True,
    )
    if installed_charnel() != target:
        raise ValueError("package version verification failed")


def install_charnel(work, architecture):
    if architecture != "arm64":
        raise ValueError("charnel requires arm64")
    release = charnel_release(work)
    tag = release["tag_name"]
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        raise ValueError("unexpected stable release tag")
    version = tag[1:]
    stage_deb(work, release, "candidate.deb")
    deb = work / "candidate.deb"
    existing = subprocess.run(
        ["dpkg-query", "-W", "-f=${Status}", "freqhole"], capture_output=True, text=True,
    )
    if existing.returncode == 0 and existing.stdout.strip() == "install ok installed":
        raise ValueError("charnel is already installed; use its update workflow, not fresh installation")
    # apt's sandboxed download user must be able to read the staged package.
    work.chmod(0o755)
    deb.chmod(0o644)
    subprocess.run(["apt-get", "install", "-y", str(deb)], check=True)
    print(f"installed charnel {version}; complete first-run setup in the desktop app")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", choices=("wifi", "charnel", "charnel-prepare", "charnel-install", "charnel-rollback"))
    parser.add_argument("version", nargs="?")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("package installation requires sudo from setup.sh")
    caller = os.environ.get("SUDO_UID", "0")
    os.environ.clear()
    os.environ.update(PATH="/usr/sbin:/usr/bin:/sbin:/bin", HOME="/root", SUDO_UID=caller)
    architecture = run("dpkg", "--print-architecture")
    if architecture not in ("arm64", "armhf"):
        parser.error("supported architectures: arm64 and armhf")
    try:
        if args.app.startswith("charnel-"):
            if architecture != "arm64":
                raise ValueError("charnel requires arm64")
            cache = Path("/var/cache/freqhole-pi/charnel")
            cache.mkdir(parents=True, mode=0o755, exist_ok=True)
            with (cache / "lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                if args.app == "charnel-prepare":
                    if args.version is not None:
                        raise ValueError("prepare takes no version")
                    print(json.dumps(prepare_charnel(cache)))
                else:
                    apply_charnel(cache, args.version, rollback=args.app == "charnel-rollback")
            return
        if args.version is not None:
            raise ValueError("unexpected version argument")
        with tempfile.TemporaryDirectory(prefix="freqhole-pi-packages-", dir="/var/tmp") as directory:
            {"wifi": install_wifi, "charnel": install_charnel}[args.app](Path(directory), architecture)
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.CalledProcessError) as error:
        detail = (error.stderr or str(error)) if isinstance(error, subprocess.CalledProcessError) else str(error)
        parser.exit(1, f"package setup failed: {detail}\n")


if __name__ == "__main__":
    main()
