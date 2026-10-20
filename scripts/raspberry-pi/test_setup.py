import hashlib
import io
import importlib.util
from importlib.machinery import SourceFileLoader
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import socket
import struct
import subprocess
import sys
import tempfile
import tarfile
import time
import tomllib
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent


def load_module(name):
    path = HERE / f"{name}.py"
    if not path.exists():
        path = HERE / name
    spec = importlib.util.spec_from_file_location(name, path, loader=SourceFileLoader(name, str(path)))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


configure = load_module("configure")
menu = load_module("menu")
packages = load_module("packages")
charnel = load_module("charnel")
wifi_control = load_module("freqhole-wifi")
splash = load_module("splash")


class SplashTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.theme = self.root / "pix"
        self.theme.mkdir()
        (self.theme / "pix.plymouth").write_text(
            f"[Plymouth Theme]\nModuleName=script\n[script]\nImageDir={self.theme}\n"
            f"ScriptFile={self.theme / 'pix.script'}\n"
        )
        (self.theme / "pix.script").write_text('image = Image("splash.png");\n')
        self.target = self.theme / "splash.png"
        self.target.write_bytes(b"original image")
        self.image = self.root / "new.png"
        self.image.write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" +
                               struct.pack(">II", 1920, 1080) + b"\x08\x02\x00\x00\x00" + b"\x00" * 4)

    def test_validates_active_theme_and_expected_image(self):
        with patch.object(splash.subprocess, "run", return_value=Mock(stdout="pix\n")):
            self.assertEqual(splash.splash_target(self.root), self.target)
            (self.theme / "pix.script").write_text('image = Image("custom.png");')
            with self.assertRaisesRegex(ValueError, "expected splash"):
                splash.splash_target(self.root)
        with patch.object(splash.subprocess, "run", return_value=Mock(stdout="custom\n")):
            with self.assertRaisesRegex(ValueError, "unsupported"):
                splash.splash_target(self.root)

    def test_backup_preserved_on_reruns_and_image_replaced(self):
        backup = splash.replace_splash(self.image, self.target)
        self.assertEqual(backup.read_bytes(), b"original image")
        splash.replace_splash(self.image, self.target)
        self.assertEqual(backup.read_bytes(), b"original image")
        self.assertEqual(self.target.read_bytes(), self.image.read_bytes())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o644)

    def test_invalid_png_leaves_original_and_backup_untouched(self):
        self.image.write_bytes(b"not a PNG")
        with self.assertRaisesRegex(ValueError, "PNG"):
            splash.replace_splash(self.image, self.target)
        self.assertEqual(self.target.read_bytes(), b"original image")
        self.assertFalse(self.target.with_name("splash.png.before-freqhole-pi").exists())

    def test_missing_tools_or_initramfs_leave_image_untouched(self):
        with patch.object(splash.shutil, "which", return_value=None):
            with self.assertRaisesRegex(ValueError, "required"):
                splash.install_splash(self.image, self.root)
        with patch.object(splash.shutil, "which", return_value="/usr/bin/tool"):
            with self.assertRaisesRegex(ValueError, "no existing initramfs"):
                splash.install_splash(self.image, self.root)
        self.assertEqual(self.target.read_bytes(), b"original image")

    def test_rebuilds_all_existing_initramfs_without_changing_theme_or_boot_settings(self):
        (self.root / "initrd.img-test").write_bytes(b"initramfs")
        with patch.object(splash.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(splash, "splash_target", return_value=self.target), \
             patch.object(splash.subprocess, "run") as run:
            splash.install_splash(self.image, self.root)
            run.assert_called_once_with(["update-initramfs", "-u", "-k", "all"], check=True)

    def test_rebuild_failure_surfaces_and_retains_original_for_recovery(self):
        (self.root / "initrd.img-test").write_bytes(b"initramfs")
        with patch.object(splash.shutil, "which", return_value="/usr/bin/tool"), \
             patch.object(splash, "splash_target", return_value=self.target), \
             patch.object(splash.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "update-initramfs")):
            with self.assertRaises(subprocess.CalledProcessError):
                splash.install_splash(self.image, self.root)
        self.assertEqual(self.target.with_name("splash.png.before-freqhole-pi").read_bytes(), b"original image")


class ConfigTests(unittest.TestCase):
    def test_i2c_speed_and_idempotence(self):
        original = (
            "# custom boot config\n[pi4]\ndtparam=audio=on,i2c_arm_baudrate=100000 # keep\n"
            "dtparam=i2c_arm_baudrate=200000\n[all]\ndtparam=i2c_arm=on\n"
        )
        result = configure.i2c_config(original)
        self.assertIn("dtparam=audio=on # keep", result)
        self.assertIn("[pi4]", result)
        self.assertEqual(result.count("i2c_arm_baudrate="), 1)
        self.assertTrue(result.endswith(configure.I2C_BLOCK))
        self.assertEqual(configure.i2c_config(result), result)

    def test_console_exact_font_and_idempotence(self):
        original = '# keep\nFONTFACE="Fixed"\nFONT="old.psf.gz"\n'
        result = configure.console_config(original)
        self.assertIn('FONTFACE="Fixed"', result)
        self.assertEqual(result.count("\nFONT="), 1)
        self.assertIn('FONT="Uni2-VGA14.psf.gz"', result)
        self.assertEqual(configure.console_config(result), result)

    def test_enable_socket_preserves_other_tables(self):
        text = '[control_socket]\nenabled = false\n\n[logging]\nlevel = "info"\n'
        result = configure.socket_config(text)
        self.assertTrue(tomllib.loads(result)["control_socket"]["enabled"])
        self.assertEqual(tomllib.loads(result)["logging"]["level"], "info")
        self.assertEqual(configure.socket_config(result), result)

    def test_append_socket_and_preserve_custom_path(self):
        self.assertTrue(tomllib.loads(configure.socket_config('data_dir = "./data"\n'))["control_socket"]["enabled"])
        result = configure.socket_config('[control_socket]\nsocket_path = "/tmp/custom"\n', "/tmp/default")
        self.assertEqual(tomllib.loads(result)["control_socket"], {"enabled": True, "socket_path": "/tmp/custom"})
        result = configure.socket_config('# [control_socket] comment\n', "/tmp/default")
        self.assertEqual(tomllib.loads(result)["control_socket"]["socket_path"], "/tmp/default")
        self.assertEqual(configure.socket_config(result, "/tmp/default"), result)

    def test_config_backup_is_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config"
            path.write_text('FONT="old"\n')
            configure.edit(path, configure.console_config)
            configure.edit(path, configure.console_config)
            self.assertEqual(path.with_name("config.before-freqhole-pi").read_text(), 'FONT="old"\n')

    def test_real_template_can_enable_socket(self):
        template = HERE.parent.parent / "assets/config/freqhole-config.toml"
        if not template.exists():
            self.skipTest("repository template not mounted")
        result = configure.socket_config(template.read_text())
        self.assertTrue(tomllib.loads(result)["control_socket"]["enabled"])

    def test_player_view_preserves_tables_and_is_idempotent(self):
        text = 'initial_view = "explore"\n\n[admin_user]\nusername = "test"\n'
        updated = configure.initial_player(text)
        self.assertEqual(tomllib.loads(updated)["initial_view"], "player")
        self.assertEqual(tomllib.loads(updated)["admin_user"]["username"], "test")
        self.assertEqual(configure.initial_player(updated), updated)
        self.assertEqual(tomllib.loads(configure.initial_player("[admin_user]\n"))["initial_view"], "player")

    def test_window_state_preserves_geometry_and_other_windows(self):
        state = {"main": {"width": 1024, "x": 40}, "setup-wizard": {"width": 800}}
        result = json.loads(configure.window_config(json.dumps(state), "fullscreen"))
        self.assertTrue(result["main"]["fullscreen"])
        self.assertFalse(result["main"]["maximized"])
        self.assertEqual(result["main"]["width"], 1024)
        self.assertEqual(result["main"]["height"], 600)
        self.assertEqual(result["setup-wizard"], state["setup-wizard"])
        result = json.loads(configure.window_config("{}", "maximized"))
        self.assertTrue(result["main"]["maximized"])
        self.assertFalse(result["main"]["fullscreen"])
        self.assertEqual(result["main"]["width"], 800)
        with self.assertRaisesRegex(ValueError, "invalid window state field"):
            configure.window_config('{"main": {"fullscreen": "yes"}}', "fullscreen")

    def test_wifi_credentials_are_private_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "wifi"
            with patch("sys.stdout", new_callable=io.StringIO) as output:
                configure.wifi_config(root, "wlan0")
            info = json.loads(output.getvalue())
            self.assertRegex(info["passphrase"], r"^[a-f0-9]{12}$")
            self.assertRegex(info["ssid"], r"^freqhole-setup-[a-f0-9]{4}$")
            environment = (root / "wifi.env").read_text()
            self.assertIn("ACTIVITY_TIMEOUT=600", environment)
            self.assertIn("PORTAL_INTERFACE=wlan0", environment)
            self.assertEqual((root / "wifi.env").stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(ValueError, "already exists"):
                configure.wifi_config(root, "wlan0")
            self.assertEqual((root / "wifi.env").read_text(), environment)
            with self.assertRaisesRegex(ValueError, "invalid"):
                configure.wifi_config(root, "wlan0\nPORTAL_SSID=bad")


class PackageTests(unittest.TestCase):
    def test_download_checks_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "asset"
            with patch.object(packages, "urlopen", return_value=io.BytesIO(b"asset")):
                packages.download("https://example.invalid/asset", path, hashlib.sha256(b"asset").hexdigest())
            self.assertEqual(path.read_bytes(), b"asset")
            with patch.object(packages, "urlopen", return_value=io.BytesIO(b"changed")):
                with self.assertRaisesRegex(ValueError, "checksum"):
                    packages.download("https://example.invalid/asset", path, "0" * 64)

    def archive(self, path, members):
        with tarfile.open(path, "w:gz") as output:
            for member, content in members:
                output.addfile(member, io.BytesIO(content) if content is not None else None)

    def test_extract_valid_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            member = tarfile.TarInfo("./static/index.html")
            member.size = 5
            self.archive(root / "archive.tgz", [(member, b"hello")])
            packages.extract(root / "archive.tgz", root / "output")
            self.assertEqual((root / "output/static/index.html").read_text(), "hello")

    def test_archive_rejects_traversal_links_and_duplicates(self):
        for name, kind in (("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("hardlink", tarfile.LNKTYPE)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "/etc/passwd"
                self.archive(root / "archive.tgz", [(member, b"" if kind == tarfile.REGTYPE else None)])
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    packages.extract(root / "archive.tgz", root / "output")
                self.assertFalse((root / "output").exists())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            member = tarfile.TarInfo("duplicate")
            self.archive(root / "archive.tgz", [(member, b""), (member, b"")])
            with self.assertRaisesRegex(ValueError, "duplicate"):
                packages.extract(root / "archive.tgz", root / "output")

    def test_charnel_rejects_wrong_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "requires arm64"):
                packages.install_charnel(Path(directory), "armhf")

    def test_charnel_release_package_validation(self):
        for failure in ("bad-url", "missing-digest", "package-mismatch", "already-installed", None):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                release = {"tag_name": "v1.2.3", "assets": [{
                    "name": "freqhole_charnel_1.2.3_aarch64.deb",
                    "browser_download_url": "https://github.com/freqhole/tomb/releases/download/v1.2.3/freqhole_charnel_1.2.3_aarch64.deb",
                    "digest": "sha256:" + "a" * 64,
                }]}
                if failure == "bad-url":
                    release["assets"][0]["browser_download_url"] = "https://example.invalid/evil.deb"
                if failure == "missing-digest":
                    del release["assets"][0]["digest"]

                def fake_download(url, path, digest=None, timeout=60):
                    path.write_text(json.dumps(release) if path.name == "release.json" else "package")

                def fake_run(*args):
                    field = args[-1]
                    return {"Package": "evil" if failure == "package-mismatch" else "freqhole",
                            "Version": "1.2.3", "Architecture": "arm64"}[field]

                existing = Mock(returncode=0 if failure == "already-installed" else 1,
                                stdout="install ok installed")
                with patch.object(packages, "download", side_effect=fake_download), \
                     patch.object(packages, "run", side_effect=fake_run), \
                     patch.object(packages.subprocess, "run", return_value=existing) as commands:
                    if failure:
                        with self.assertRaises(ValueError):
                            packages.install_charnel(root, "arm64")
                        self.assertFalse(any(call.args[0][0] == "apt-get" for call in commands.call_args_list))
                    else:
                        packages.install_charnel(root, "arm64")
                        self.assertTrue(any(call.args[0][0] == "apt-get" for call in commands.call_args_list))


MOCK_TOOL = """#!{python}
import hashlib, json, os, pathlib, shutil, sys
tool = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ["MOCK_ROOT"])
with (root / "calls").open("a") as log:
    log.write(json.dumps([tool, *args]) + "\\n")
if tool == "id":
    print("1000")
elif tool == "flock":
    sys.exit(int(os.environ.get("MOCK_LOCKED", "0")))
elif tool == "dpkg":
    if args == ["--print-architecture"]:
        print(os.environ.get("MOCK_ARCH", "arm64"))
    else:
        sys.exit(0 if tuple(map(int, args[1].split("."))) >= tuple(map(int, args[3].split("."))) else 1)
elif tool == "curl":
    if os.environ.get("MOCK_OFFLINE"):
        print("network unavailable", file=sys.stderr)
        sys.exit(22)
    source = "release.json" if "api.github.com" in " ".join(args) else "payload"
    shutil.copyfile(root / source, args[args.index("-o") + 1])
elif tool == "sha256sum":
    if args == ["-c", "-"]:
        digest, filename = sys.stdin.read().strip().split("  ", 1)
        sys.exit(0 if hashlib.sha256(pathlib.Path(filename).read_bytes()).hexdigest() == digest else 1)
    print(hashlib.sha256(pathlib.Path(args[0]).read_bytes()).hexdigest(), args[0])
elif tool == "systemctl":
    if args[0] == "show":
        if os.environ.get("MOCK_BUS_FAILURE"):
            sys.exit(1)
        print(os.environ.get("MOCK_SERVICE", "inactive"))
        sys.exit(int(os.environ.get("MOCK_SHOW_EXIT", "0")))
    else:
        sys.exit(int(os.environ.get("MOCK_HEALTH_FAILURE", "0")))
elif tool == "sudo":
    if args[-1] == "start" and os.environ.get("MOCK_START_FAILURE"):
        sys.exit(1)
elif tool == "sleep":
    pass
elif tool == "ldd":
    if os.environ.get("MOCK_INCOMPATIBLE"):
        print("GLIBC version not found", file=sys.stderr)
        sys.exit(1)
    print("libc.so.6 => /lib/libc.so.6")
else:
    sys.exit("unexpected mock tool")
"""


class CharnelPackageTests(unittest.TestCase):
    def test_current_or_newer_install_is_a_noop_not_a_downgrade(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(packages, "installed_charnel", return_value="1.2.3"), \
             patch.object(packages, "charnel_release", return_value={"tag_name": "v1.2.2"}), \
             patch.object(packages, "stage_deb") as stage, \
             patch.object(packages.subprocess, "run", return_value=Mock(returncode=1)):
            self.assertFalse(packages.prepare_charnel(Path(directory))["update_available"])
            stage.assert_not_called()

    def test_prepare_retains_both_verified_packages_and_binds_account(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)

            def release(work, tag="latest"):
                return {"tag_name": "v1.2.3" if tag == "latest" else tag}

            def stage(work, metadata, filename):
                (work / filename).write_text(metadata["tag_name"])
                return hashlib.sha256((work / filename).read_bytes()).hexdigest()

            with patch.object(packages, "installed_charnel", return_value="1.2.2"), \
                 patch.object(packages, "charnel_release", side_effect=release), \
                 patch.object(packages, "stage_deb", side_effect=stage) as staged, \
                 patch.object(packages.subprocess, "run", return_value=Mock(returncode=0)), \
                 patch.dict(os.environ, {"SUDO_UID": "1000"}):
                manifest = packages.prepare_charnel(cache)
                self.assertEqual(manifest["uid"], "1000")
                self.assertEqual((cache / "1.2.3/candidate.deb").read_text(), "v1.2.3")
                self.assertEqual((cache / "1.2.3/previous.deb").read_text(), "v1.2.2")
                packages.prepare_charnel(cache)
                self.assertEqual(staged.call_count, 2)
                with patch.dict(os.environ, {"SUDO_UID": "1001"}):
                    with self.assertRaisesRegex(ValueError, "account"):
                        packages.prepare_charnel(cache)

    def test_apply_rejects_paths_foreign_accounts_modified_packages_and_version_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            staged = cache / "1.2.3"
            staged.mkdir()
            manifest = {"uid": "1000", "version": "1.2.3", "previous": "1.2.2",
                        "candidate_sha256": hashlib.sha256(b"package").hexdigest()}
            (staged / "candidate.deb").write_bytes(b"changed")
            (staged / "manifest.json").write_text(json.dumps(manifest))
            with patch.object(packages.subprocess, "run") as apt, \
                 patch.object(packages, "installed_charnel", return_value="1.2.2") as installed, \
                 patch.dict(os.environ, {"SUDO_UID": "1000"}):
                for version in ("../evil.deb", "/tmp/package.deb", "1.2.3 --config x", None):
                    with self.assertRaisesRegex(ValueError, "version"):
                        packages.apply_charnel(cache, version)
                with patch.dict(os.environ, {"SUDO_UID": "1001"}):
                    with self.assertRaisesRegex(ValueError, "account"):
                        packages.apply_charnel(cache, "1.2.3")
                with self.assertRaisesRegex(ValueError, "checksum"):
                    packages.apply_charnel(cache, "1.2.3")
                installed.return_value = "1.2.1"
                with self.assertRaisesRegex(ValueError, "changed since"):
                    packages.apply_charnel(cache, "1.2.3")
                apt.assert_not_called()

    def test_apply_revalidates_metadata_and_allows_repair_of_partial_package_install(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            staged = cache / "1.2.3"
            staged.mkdir()
            (staged / "candidate.deb").write_bytes(b"package")
            manifest = {"uid": "1000", "version": "1.2.3", "previous": "1.2.2",
                        "candidate_sha256": hashlib.sha256(b"package").hexdigest()}
            (staged / "manifest.json").write_text(json.dumps(manifest))
            with patch.dict(os.environ, {"SUDO_UID": "1000"}), \
                 patch.object(packages, "installed_charnel", side_effect=["1.2.2", "1.2.3"]) as installed, \
                 patch.object(packages, "validate_deb") as metadata, \
                 patch.object(packages.subprocess, "run") as apt:
                packages.apply_charnel(cache, "1.2.3")
                installed.assert_any_call(require_configured=False)
                metadata.assert_called_once_with(staged / "candidate.deb", "1.2.3")
                self.assertIn("--no-remove", apt.call_args.args[0])
                self.assertNotIn("APT_CONFIG", apt.call_args.kwargs["env"])
            with patch.dict(os.environ, {"SUDO_UID": "1000"}), \
                 patch.object(packages, "installed_charnel", return_value="1.2.2"), \
                 patch.object(packages, "validate_deb", side_effect=ValueError("wrong metadata")), \
                 patch.object(packages.subprocess, "run") as apt:
                with self.assertRaisesRegex(ValueError, "metadata"):
                    packages.apply_charnel(cache, "1.2.3")
                apt.assert_not_called()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.home = self.directory / "home"
        self.root = self.home / ".local/share/freqhole-pi"
        self.root.mkdir(parents=True)
        self.binary = self.home / ".local/bin/rathole"
        self.binary.parent.mkdir(parents=True)
        self.tools = self.directory / "tools"
        self.tools.mkdir()
        for name in ("id", "flock", "dpkg", "curl", "sha256sum", "systemctl", "sudo", "sleep", "ldd"):
            path = self.tools / name
            path.write_text(MOCK_TOOL.format(python=sys.executable))
            path.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), MOCK_ROOT=str(self.directory),
                        PATH=str(self.tools) + os.pathsep + os.environ["PATH"])
        self.payload = b"new rathole binary"
        (self.directory / "payload").write_bytes(self.payload)
        self.release = {
            "tag_name": "v1.2.3",
            "assets": [{
                "name": "rathole_1.2.3_linux-aarch64",
                "browser_download_url": "https://github.com/freqhole/tomb/releases/download/v1.2.3/rathole_1.2.3_linux-aarch64",
                "digest": "sha256:" + hashlib.sha256(self.payload).hexdigest(),
            }],
        }

    def installed(self, version="1.2.2"):
        self.binary.write_bytes(b"old binary")
        self.binary.chmod(0o755)
        (self.root / "installed.json").write_text(json.dumps({
            "version": version, "sha256": hashlib.sha256(self.binary.read_bytes()).hexdigest(),
        }))

    def run_updater(self, action="update"):
        (self.directory / "release.json").write_text(json.dumps(self.release))
        result = subprocess.run(
            ["bash", str(HERE / "freqhole-pi"), action], env=self.env,
            capture_output=True, text=True, timeout=15,
        )
        self.assertFalse(list(self.root.glob("download.*")), result.stderr)
        return result

    def calls(self):
        return [json.loads(line) for line in (self.directory / "calls").read_text().splitlines()]

    def test_fresh_install(self):
        result = self.run_updater("install")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.binary.read_bytes(), self.payload)
        self.assertEqual(self.binary.stat().st_mode & 0o777, 0o755)
        self.assertEqual(json.loads((self.root / "installed.json").read_text())["version"], "1.2.3")
        self.assertFalse(any(call[0] == "sudo" for call in self.calls()))

    def test_first_install_without_a_unit(self):
        self.env["MOCK_SHOW_EXIT"] = "1"
        result = self.run_updater("install")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_service_manager_failure_does_not_replace_binary(self):
        self.installed()
        self.env["MOCK_BUS_FAILURE"] = "1"
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("could not inspect", result.stderr)
        self.assertEqual(self.binary.read_bytes(), b"old binary")

    def test_running_update_stops_and_restarts(self):
        self.installed()
        self.env["MOCK_SERVICE"] = "active"
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "rathole.previous").read_bytes(), b"old binary")
        self.assertEqual([call[-1] for call in self.calls() if call[0] == "sudo"], ["stop", "start"])

    def test_status_is_structured_and_does_not_update(self):
        self.installed()
        result = self.run_updater("status")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            "installed": "1.2.2", "available": "1.2.3", "update_available": True,
        })
        self.assertEqual(self.binary.read_bytes(), b"old binary")

    def test_no_downgrade(self):
        self.installed("9.0.0")
        result = self.run_updater()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.binary.read_bytes(), b"old binary")
        self.assertFalse(any(call[0] == "sudo" for call in self.calls()))

    def test_bad_digest_preserves_running_install(self):
        self.installed()
        self.env["MOCK_SERVICE"] = "active"
        self.release["assets"][0]["digest"] = "sha256:" + "0" * 64
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.binary.read_bytes(), b"old binary")
        self.assertFalse(any(call[0] == "sudo" for call in self.calls()))

    def test_incompatible_runtime_does_not_stop_the_app(self):
        self.installed()
        self.env.update(MOCK_SERVICE="active", MOCK_INCOMPATIBLE="1")
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("incompatible", result.stderr)
        self.assertEqual(self.binary.read_bytes(), b"old binary")
        self.assertFalse(any(call[0] == "sudo" for call in self.calls()))

    def test_missing_asset_and_digest_fail(self):
        for change in ("missing-asset", "missing-digest"):
            with self.subTest(change=change):
                self.set_release_failure(change)
                self.assertNotEqual(self.run_updater().returncode, 0)
                self.assertFalse(self.binary.exists())

    def set_release_failure(self, change):
        if change == "missing-asset":
            self.release["assets"] = []
        else:
            self.release["assets"] = [{"name": "rathole_1.2.3_linux-aarch64"}]

    def test_unmanaged_or_modified_binary_not_overwritten(self):
        self.binary.write_bytes(b"unmanaged")
        result = self.run_updater()
        self.assertIn("unmanaged", result.stderr)
        self.assertNotEqual(result.returncode, 0)
        self.installed()
        self.binary.write_bytes(b"user modified")
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("differs", result.stderr)

    def test_network_failure_is_not_up_to_date(self):
        self.env["MOCK_OFFLINE"] = "1"
        result = self.run_updater("status")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_concurrent_update_is_refused(self):
        self.env["MOCK_LOCKED"] = "1"
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("another", result.stderr)

    def test_bad_restart_is_reported_with_recovery_binary(self):
        self.installed()
        self.env.update(MOCK_SERVICE="active", MOCK_START_FAILURE="1")
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("previous binary", result.stderr)
        self.assertEqual((self.root / "rathole.previous").read_bytes(), b"old binary")

    def test_health_failure_and_transition_are_errors(self):
        self.installed()
        self.env.update(MOCK_SERVICE="active", MOCK_HEALTH_FAILURE="1")
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exited", result.stderr)
        self.installed()
        self.env["MOCK_SERVICE"] = "activating"
        result = self.run_updater()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.binary.read_bytes(), b"old binary")

    def test_armhf_asset(self):
        self.env["MOCK_ARCH"] = "armhf"
        asset = self.release["assets"][0]
        asset["name"] = asset["name"].replace("aarch64", "armv7")
        asset["browser_download_url"] = asset["browser_download_url"].replace("aarch64", "armv7")
        self.assertEqual(self.run_updater("install").returncode, 0)


class CharnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir="/tmp")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve() / "home"
        self.root = self.home / ".local/share/freqhole-pi"
        self.root.mkdir(parents=True)
        self.data = self.home / ".local/share/net.freqhole.charnel"
        self.config = self.home / ".config/net.freqhole.charnel"
        self.data.mkdir()
        self.config.mkdir(parents=True)
        self.server = self.data / "freqhole-config.toml"
        self.server.write_text(f'data_dir = "{self.data / "data"}"\n[database]\nfilename = "grimoire.db"\n')
        (self.data / "data").mkdir()
        self.database = self.data / "data/grimoire.db"
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("CREATE TABLE state (value TEXT)")
            db.execute("INSERT INTO state VALUES ('before')")
        self.installation = {"charnel_data": str(self.data), "charnel_config": str(self.config),
                             "menu_player": "charnel", "hardware": False}
        unit = self.config.parent / "systemd/user/charnel.service"
        unit.parent.mkdir(parents=True)
        unit.write_text(charnel.MARKER)
        self.transaction = self.root / "charnel-transaction.json"
        for name, value in (("ROOT", self.root), ("TRANSACTION", self.transaction)):
            patcher = patch.object(charnel, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        home = patch.object(Path, "home", return_value=self.home)
        home.start()
        self.addCleanup(home.stop)

    def result(self, version="1.2.3"):
        reports = {
            "haruspex_migration": {"unresolved_user_refs": [], "unexpected_knock_status": []},
            "reliquary_migration": {"unresolved_parents": [], "missing_content": [], "unmigrated_blob_data": 0},
            "blake3_backfill_migration": {"processed": 0, "remaining": 0},
            "contentless_blob_cleanup_migration": {"blobs_found": 0, "blobs_deleted": 0, "deletion_failures": 0},
        }
        return {"success": True, "data": {"new_version": version, **{
            name: {"status": "ran", "report": reports.get(name, {})} for name in charnel.MIGRATIONS
        }}}

    def run_update(self, result=None, active=True, failure=None):
        result = self.result() if result is None else result
        self.calls = []
        self.state = "active" if active else "inactive"

        def service(*args):
            self.calls.append(("service", args[0]))
            if args[0] == "show":
                return self.state
            self.state = "inactive" if args[0] == "stop" else "active"
            if args[0] == "start" and failure == "restart":
                self.state = "failed"

        def package(action, version=None):
            self.calls.append(("package", action))
            if action == "prepare":
                return {"version": "1.2.3", "previous": "1.2.2", "update_available": True}
            if failure == "package":
                raise subprocess.CalledProcessError(1, "apt-get")

        def migration(*args, **kwargs):
            self.calls.append(("migration", str(args[0])))
            with closing(sqlite3.connect(self.database)) as db, db:
                db.execute("UPDATE state SET value = 'after'")
            (self.data / "new-migration-file").write_text("keep for diagnosis")
            return subprocess.CompletedProcess(args[0], 1 if failure == "cli" else 0,
                                               "startup tracing\n" + json.dumps(result), "diagnostic stderr")

        with patch.object(charnel, "user_service", side_effect=service), \
             patch.object(charnel, "package_action", side_effect=package), \
             patch.object(charnel, "require_stopped"), patch.object(charnel, "require_unused"), \
             patch.object(charnel.subprocess, "run", side_effect=migration), \
             patch.object(charnel.time, "sleep"):
            charnel.update(self.installation)

    def test_successful_update_snapshots_before_migration_and_restarts_only_active_service(self):
        self.run_update()
        transaction = json.loads(self.transaction.read_text())
        self.assertEqual(transaction["phase"], "complete")
        entries = json.loads((Path(transaction["backup"]) / "manifest.json").read_text())
        entry = next(entry for entry in entries if entry["source"] == str(self.data))
        with closing(sqlite3.connect(Path(entry["snapshot"]) / "data/grimoire.db")) as db:
            self.assertEqual(db.execute("SELECT value FROM state").fetchone()[0], "before")
        self.assertLess(self.calls.index(("service", "stop")), self.calls.index(("package", "install")))
        self.assertEqual(self.state, "active")
        self.assertTrue((Path(transaction["backup"]) / "upgrade.stderr").exists())

    def test_inactive_service_is_not_started(self):
        self.run_update(active=False)
        self.assertNotIn(("service", "start"), self.calls)
        self.assertEqual(json.loads(self.transaction.read_text())["phase"], "complete")

    def test_migration_failure_is_not_success_and_blocks_startup_and_retry(self):
        result = self.result()
        result["data"]["reliquary_migration"] = {"status": "failed", "error": "database is locked"}
        with self.assertRaisesRegex(ValueError, "database is locked"):
            self.run_update(result)
        self.assertEqual(json.loads(self.transaction.read_text())["phase"], "failed")
        self.assertNotIn(("service", "start"), self.calls)
        with self.assertRaisesRegex(ValueError, "unfinished"):
            charnel.prepare_launch(self.installation)
        with patch.object(charnel, "package_action") as package:
            with self.assertRaisesRegex(ValueError, "unfinished"):
                charnel.update(self.installation)
            package.assert_not_called()

    def test_partial_reports_failed_skips_missing_fields_and_wrong_versions_are_rejected(self):
        for failure in ("reload", "missing", "partial", "version", "success", "report"):
            with self.subTest(failure=failure):
                result = self.result()
                if failure == "reload":
                    result["data"]["haruspex_migration"] = {"status": "skipped", "reason": "config reload failed"}
                elif failure == "missing":
                    del result["data"]["blake3_backfill_migration"]
                elif failure == "partial":
                    result["data"]["reliquary_migration"]["report"]["missing_content"] = ["blob-id"]
                elif failure == "version":
                    result["data"]["new_version"] = "1.2.2"
                elif failure == "success":
                    result["success"] = False
                else:
                    del result["data"]["radio_encode_args_migration"]["report"]
                with self.assertRaises(ValueError):
                    charnel.validate_migrations(result, "1.2.3")
        result = self.result()
        result["data"]["haruspex_migration"] = {
            "status": "skipped", "reason": "old config version 1.2.2 is newer than 0.3.0 - already migrated",
        }
        charnel.validate_migrations(result, "1.2.3")

    def test_cli_package_and_restart_failures_remain_recoverable(self):
        for failure in ("cli", "package", "restart"):
            with self.subTest(failure=failure):
                self.transaction.unlink(missing_ok=True)
                with patch.object(charnel.time, "strftime", return_value=failure):
                    with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                        self.run_update(failure=failure)
                transaction = json.loads(self.transaction.read_text())
                self.assertEqual(transaction["phase"], "failed")
                self.assertTrue((Path(transaction["backup"]) / "manifest.json").is_file())
                self.assertEqual(self.state, "inactive")

    def test_recovery_restores_data_and_preserves_failed_files(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_update(failure="cli")
        transaction = json.loads(self.transaction.read_text())
        failed = self.data.with_name(self.data.name + ".failed-" + Path(transaction["backup"]).name)
        with patch.object(charnel, "user_service") as service, \
             patch.object(charnel, "require_stopped"), patch.object(charnel, "require_unused"), \
             patch.object(charnel, "package_action") as package, patch.object(charnel, "restart"):
            charnel.recover(self.installation)
        package.assert_called_once_with("rollback", "1.2.3")
        service.assert_called_once_with("stop")
        self.assertEqual(json.loads(self.transaction.read_text())["phase"], "recovered")
        with closing(sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute("SELECT value FROM state").fetchone()[0], "before")
        self.assertFalse((self.data / "new-migration-file").exists())
        self.assertTrue((failed / "new-migration-file").exists())

    def test_unmanaged_process_and_open_databases_are_refused(self):
        with patch.object(charnel.subprocess, "run", return_value=Mock(returncode=0, stdout="123", stderr="")):
            with self.assertRaisesRegex(ValueError, "another charnel"):
                charnel.require_stopped()
            with self.assertRaisesRegex(ValueError, "database still in use"):
                charnel.require_unused([self.data])

    def test_backups_include_external_database_paths_and_refuse_recursive_roots(self):
        external = self.home / "external"
        external.mkdir()
        self.server.write_text(f'data_dir = "{self.data / "data"}"\n[database]\n'
                               f'filename = "{external / "main.sqlite"}"\nreliquary_db_path = "{external / "blob.sqlite"}"\n')
        roots = charnel.snapshot_roots(self.installation, self.server)
        self.assertIn(external / "main.sqlite", roots)
        self.assertIn(external / "blob.sqlite", roots)
        self.assertIn(external / "main.sqlite-wal", roots)
        self.assertIn(external / "blob.sqlite-journal", roots)
        self.server.write_text(f'data_dir = "{self.home}"\n[database]\nfilename = "grimoire.db"\n')
        with self.assertRaisesRegex(ValueError, "broad/recursive"):
            charnel.snapshot_roots(self.installation, self.server)

    def test_selected_socket_uses_saved_config_and_preserves_relative_custom_path(self):
        self.installation["hardware"] = True
        saved = self.data / "custom-server.toml"
        self.server.rename(saved)
        with saved.open("a") as output:
            output.write('[control_socket]\nenabled = true\nsocket_path = "custom.sock"\n')
        (self.data / "charnel-config.toml").write_text(f'server_config_path = "{saved}"\n')
        charnel.prepare_socket(self.installation)
        self.assertTrue(tomllib.loads(saved.read_text())["control_socket"]["enabled"])
        self.assertEqual(json.loads((self.root / "menu.json").read_text())["socket_path"], str(self.home / "custom.sock"))
        self.assertFalse(self.server.exists())

    def test_optional_menu_and_first_run_do_not_prevent_launch(self):
        before = self.server.read_text()
        charnel.prepare_launch(self.installation)
        self.assertEqual(self.server.read_text(), before)
        self.server.unlink()
        self.installation["hardware"] = True
        charnel.prepare_launch(self.installation)
        self.server.write_text("this is invalid TOML")
        with self.assertRaises(tomllib.TOMLDecodeError):
            charnel.prepare_launch(self.installation)

    def test_rathole_and_charnel_custom_sockets_are_preserved(self):
        self.installation["hardware"] = True
        rathole = self.root / "freqhole-config.toml"
        rathole.write_text(self.server.read_text())
        paths = []
        for player in ("rathole", "charnel"):
            self.installation["menu_player"] = player
            path = rathole if player == "rathole" else self.server
            with path.open("a") as output:
                output.write(f'[control_socket]\nenabled = true\nsocket_path = "{self.root / (player + ".sock")}"\n')
            charnel.prepare_socket(self.installation)
            paths.append(json.loads((self.root / "menu.json").read_text())["socket_path"])
        self.assertNotEqual(*paths)
        self.assertTrue(all(Path(path).is_absolute() for path in paths))

    def test_stuck_blobs_cleanup_failures_and_unknown_migrations_are_not_success(self):
        for name, field in (("blake3_backfill_migration", "remaining"),
                            ("contentless_blob_cleanup_migration", "deletion_failures")):
            result = self.result()
            result["data"][name]["report"][field] = 1
            with self.assertRaises(ValueError):
                charnel.validate_migrations(result, "1.2.3")
        result = self.result()
        result["data"]["blake3_backfill_migration"]["report"]["remaining"] = 1
        result["data"]["contentless_blob_cleanup_migration"]["report"]["blobs_deleted"] = 1
        charnel.validate_migrations(result, "1.2.3")
        result["data"]["new_migration"] = {"status": "failed"}
        with self.assertRaisesRegex(ValueError, "new migration"):
            charnel.validate_migrations(result, "1.2.3")

    def test_recovery_can_resume_after_restoring_files_before_journal_write(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_update(failure="cli")
        original = charnel.write_json
        interrupted = False

        def journal(path, data):
            nonlocal interrupted
            if path.name == "recovery.json" and data.get("0", {}).get("phase") == "restored" and not interrupted:
                interrupted = True
                raise OSError("simulated interruption after file restore")
            original(path, data)

        with patch.object(charnel, "user_service"), patch.object(charnel, "require_stopped"), \
             patch.object(charnel, "require_unused"), patch.object(charnel, "package_action"), \
             patch.object(charnel, "restart"), patch.object(charnel, "write_json", side_effect=journal):
            with self.assertRaisesRegex(OSError, "interruption"):
                charnel.recover(self.installation)
            charnel.recover(self.installation)
        self.assertEqual(json.loads(self.transaction.read_text())["phase"], "recovered")
        with closing(sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute("SELECT value FROM state").fetchone()[0], "before")

    def test_symlink_backup_is_refused_before_install_and_old_app_can_be_started(self):
        (self.data / "external-link").symlink_to(self.server)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.run_update()
        self.assertNotIn(("package", "install"), self.calls)
        self.assertEqual(json.loads(self.transaction.read_text())["phase"], "failed-before-install")
        charnel.prepare_launch(self.installation)

    def test_failed_update_check_is_an_error_not_up_to_date(self):
        charnel.write_json(self.transaction, {"phase": "failed"})
        with patch.object(charnel, "settings", return_value=self.installation), \
             patch.object(charnel.os, "geteuid", return_value=1000), \
             patch.object(charnel.packages, "charnel_release") as release, \
             patch.object(sys, "argv", ["charnel.py", "status"]), \
             patch("sys.stderr", new_callable=io.StringIO) as error:
            with self.assertRaises(SystemExit) as exit:
                charnel.main()
        self.assertEqual(exit.exception.code, 1)
        self.assertIn("unfinished update", error.getvalue())
        release.assert_not_called()

    def test_snapshot_omits_only_real_sockets_and_preserves_regular_sock_files(self):
        (self.data / "settings.sock").write_text("regular file")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.bind(str(self.data / "control.sock"))
            snapshot = self.root / "snapshot"
            entries = charnel.snapshot([self.data], snapshot)
        copied = Path(entries[0]["snapshot"])
        self.assertEqual((copied / "settings.sock").read_text(), "regular file")
        self.assertFalse((copied / "control.sock").exists())

    def test_mountpoint_snapshot_is_refused_before_package_install(self):
        mounted = self.data / "data"
        with patch.object(Path, "is_mount", autospec=True, side_effect=lambda path: path == mounted):
            with self.assertRaisesRegex(ValueError, "mountpoint"):
                self.run_update()
        self.assertNotIn(("package", "install"), self.calls)


class MenuTests(unittest.TestCase):
    def test_socket_state_diagnostic_reads_reply_and_reports_missing_socket(self):
        with patch.object(menu, "read_state", return_value={"volume": 0.5}), \
             patch.object(sys, "stdout", new_callable=io.StringIO) as stdout:
            self.assertEqual(menu.send_socket_command("get_state"), 0)
            self.assertEqual(json.loads(stdout.getvalue()), {"volume": 0.5})
        with patch.object(menu, "read_state", side_effect=FileNotFoundError("socket missing")), \
             patch.object(sys, "stderr", new_callable=io.StringIO) as stderr:
            self.assertEqual(menu.send_socket_command("get_state"), 1)
            self.assertIn("socket missing", stderr.getvalue())

    def test_system_volume_targets_pipewire_default_sink_and_reports_failure(self):
        command = ("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "1.0")
        self.assertEqual(menu.SYSTEM_VOLUME_COMMAND, command)
        with patch.object(menu.subprocess, "run") as run:
            menu.set_system_volume()
            run.assert_called_once_with(command, check=True, stdin=subprocess.DEVNULL, timeout=5)
        for error in (FileNotFoundError("wpctl missing"),
                      subprocess.CalledProcessError(1, command)):
            with self.subTest(error=error), \
                 patch.object(menu.subprocess, "run", side_effect=error), \
                 patch.object(sys, "stderr", new_callable=io.StringIO) as stderr:
                menu.set_system_volume()
                self.assertIn("could not set system mixer", stderr.getvalue())

    def test_sleep_transition_shows_update_banner_only_when_available(self):
        for status in (None, {"update_available": False}, {"update_available": True}):
            with self.subTest(status=status):
                screen = menu.Menu.__new__(menu.Menu)
                screen.sleep_started = 0
                screen.last_sleep_frame = -1
                screen.update_status = status
                screen.pixel_color = (0, 0, 0)
                screen.fade_pixel = Mock()
                screen.oled = Mock()
                screen.render_sleep(1)
                text = [call.args[0] for call in screen.oled.text.call_args_list]
                available = bool(status and status["update_available"])
                self.assertEqual("UPDATE AVAILABLE!" in text, available)
                self.assertEqual(text, ["UPDATE AVAILABLE!"] if available else ["z", "z", "z"])
                if available:
                    screen.oled.text.assert_called_once_with(
                        "UPDATE AVAILABLE!", 13, 0, 1, font_name=menu.FONT_PATH,
                    )
                    self.assertTrue(all(call.args[1] >= 8 for call in screen.oled.fill_rect.call_args_list))
                screen.oled.show.assert_called_once()

    def test_reverse_wheel_applies_immediately_and_preserves_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "menu.json"
            path.write_text(json.dumps({"player": "charnel", "socket_path": "/tmp/custom.sock"}))
            screen = menu.Menu.__new__(menu.Menu)
            screen.selected = 0
            with patch.object(menu, "COMMANDS", (("reverse wheel", menu.REVERSE_WHEEL, (0, 0, 0)),)), \
                 patch.object(menu, "SETTINGS_PATH", path), patch.object(menu, "DIRECTION", 1):
                for expected in (-1, 1):
                    screen.screen = "menu"
                    screen.activate()
                    self.assertEqual(menu.DIRECTION, expected)
                    self.assertEqual(screen.screen, "success")
                    settings = json.loads(path.read_text())
                    self.assertEqual(settings["direction"], expected)
                    self.assertEqual(settings["socket_path"], "/tmp/custom.sock")
                    motion = menu.EncoderMotion()
                    for index in range(menu.ENCODER_SETTLE_READS):
                        motion.update(0, index * 0.01)
                    self.assertEqual(motion.update(1, 0.1), expected)
                configure.update_menu_settings(path, {"direction": -1})
                configure.update_menu_settings(path, {"player": "rathole", "socket_path": "/tmp/new.sock"})
                self.assertEqual(json.loads(path.read_text())["direction"], -1)
                with patch.object(menu.configure, "update_menu_settings", side_effect=OSError("disk full")):
                    screen.screen = "menu"
                    screen.activate()
                    self.assertEqual(screen.screen, "error")
                    self.assertEqual(menu.DIRECTION, 1)

    def test_menu_settings_write_failure_keeps_original_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "menu.json"
            path.write_text('{"direction": -1}')
            with patch.object(configure.os, "fsync", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    configure.update_menu_settings(path, {"direction": 1})
            self.assertEqual(path.read_text(), '{"direction": -1}')
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_menu_actions_follow_selected_app_and_have_one_update_item(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "menu.py"
            source.write_text((HERE / "menu.py").read_text())
            updater = root / ".local/bin/freqhole-pi"
            updater.parent.mkdir(parents=True)
            updater.touch()
            records = root / ".local/share/freqhole-pi"
            records.mkdir(parents=True)
            for record in ("installed.json", "installation.json"):
                (records / record).write_text("{}")
            for player in ("rathole", "charnel"):
                with self.subTest(player=player), patch.object(Path, "home", return_value=root):
                    (root / "menu.json").write_text(json.dumps({"player": player, "direction": -1}))
                    spec = importlib.util.spec_from_file_location("configured_menu", source)
                    configured = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(configured)
                    self.assertEqual(configured.DIRECTION, -1)
                    actions = {label: command for label, command, _ in configured.COMMANDS}
                    self.assertEqual(sum(command is configured.UPDATE_SCREEN
                                         for command in actions.values()), 1)
                    self.assertIn(f"show {player} player", actions)
                    self.assertIn(f"start {player}", actions)
                    self.assertNotIn(f"start {'rathole' if player == 'charnel' else 'charnel'}", actions)
                    self.assertEqual(configured.UPDATE_ARGUMENTS, ("charnel",) if player == "charnel" else ())
                    self.assertEqual("recover failed update" in actions, player == "charnel")

    def complete_update_check(self, screen, available=True):
        from concurrent.futures import Future
        screen.update_future = Future()
        screen.update_future.set_result({
            "installed": "1.0.0", "available": "1.0.1", "update_available": available,
        })
        screen.process = None
        screen.poll_updates(10)

    def test_update_status_validation(self):
        for data in ({}, {"installed": "1", "available": "2", "update_available": "yes"}):
            with self.subTest(data=data), patch.object(menu.subprocess, "run", return_value=Mock(stdout=json.dumps(data))):
                with self.assertRaises(ValueError):
                    menu.read_update_status()

    def test_update_confirmation_defaults_to_cancel(self):
        screen = menu.Menu.__new__(menu.Menu)
        screen.screen = "menu"
        screen.selected = 0
        screen.start_command = Mock()
        with patch.object(menu, "COMMANDS", (("install update", menu.UPDATE_SCREEN, (0, 0, 0)),)):
            screen.activate()
            self.assertEqual(screen.screen, "update-check")
            self.complete_update_check(screen)
            self.assertEqual(screen.screen, "confirm")
            self.assertTrue(screen.confirm_update)
            self.assertEqual(screen.confirm_selected, 1)
            screen.activate()
            self.assertEqual(screen.screen, "menu")
            screen.start_command.assert_not_called()
            screen.screen = "confirm"
            screen.confirm_selected = 0
            screen.activate()
            screen.start_command.assert_called_once_with("install update", (str(menu.PI_UPDATER), "update"))

    def test_charnel_update_and_recovery_commands_need_confirmation(self):
        for command, action in ((menu.UPDATE_SCREEN, "update"), (menu.RECOVERY_SCREEN, "recover")):
            screen = menu.Menu.__new__(menu.Menu)
            screen.screen = "menu"
            screen.selected = 0
            screen.start_command = Mock()
            with patch.object(menu, "COMMANDS", (("action", command, (0, 0, 0)),)), \
                 patch.object(menu, "UPDATE_ARGUMENTS", ("charnel",)):
                screen.activate()
                if command is menu.UPDATE_SCREEN:
                    self.complete_update_check(screen)
                self.assertEqual(screen.confirm_selected, 1)
                screen.activate()
                screen.start_command.assert_not_called()
                screen.screen = "menu"
                screen.activate()
                if command is menu.UPDATE_SCREEN:
                    self.complete_update_check(screen)
                screen.confirm_selected = 0
                screen.activate()
                self.assertEqual(screen.start_command.call_args.args[1], (str(menu.PI_UPDATER), action, "charnel"))

    def test_update_check_reports_current_version_and_waits_a_day(self):
        screen = menu.Menu.__new__(menu.Menu)
        screen.update_requested = True
        self.complete_update_check(screen, available=False)
        self.assertEqual(screen.screen, "success")
        self.assertIn("already up to date", screen.message)
        self.assertEqual(screen.update_next_refresh, 10 + 24 * 60 * 60)
        self.assertFalse(screen.update_requested)

    def test_update_checks_schedule_daily_and_retry_failures(self):
        from concurrent.futures import Future
        screen = menu.Menu.__new__(menu.Menu)
        screen.update_requested = True
        screen.update_future = Future()
        screen.update_future.set_exception(ValueError("offline"))
        screen.process = None
        screen.update_worker = Mock()
        with patch.object(menu, "PI_MANAGED_PLAYER", True):
            screen.poll_updates(10)
            self.assertEqual(screen.screen, "error")
            self.assertTrue(screen.update_error)
            self.assertEqual(screen.update_next_refresh, 310)
            screen.poll_updates(309)
            screen.update_worker.submit.assert_not_called()
            screen.poll_updates(310)
            screen.update_worker.submit.assert_called_once_with(menu.read_update_status)
        screen.update_worker.reset_mock()
        self.complete_update_check(screen, available=False)
        with patch.object(menu, "PI_MANAGED_PLAYER", True):
            screen.poll_updates(10 + 24 * 60 * 60 - 1)
            screen.update_worker.submit.assert_not_called()
            screen.poll_updates(10 + 24 * 60 * 60)
            screen.update_worker.submit.assert_called_once_with(menu.read_update_status)

    def test_upgrade_is_optional_and_precedes_dependency_installation(self):
        script = (HERE / "setup.sh").read_text()
        section = script[script.index("sudo -v\n"):script.index("packages=(")]
        self.assertLess(script.index("sudo apt-get upgrade"), script.index("sudo apt-get install"))
        for answer in ("y", "n"):
            result = subprocess.run(
                ["bash", "-c", 'set -e\nsudo() { echo "$*"; }\n'
                 f'ask() {{ [ "{answer}" = y ]; }}\n' + section],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.splitlines(),
                             ["-v", "apt-get update"] + (["apt-get upgrade -y"] if answer == "y" else []))

    def test_menu_follows_first_run_socket_changes_without_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "menu.json"
            with patch.object(menu, "SETTINGS_PATH", path):
                for socket in ("/tmp/first.sock", "/tmp/custom.sock"):
                    path.write_text(json.dumps({"socket_path": socket}))
                    self.assertEqual(menu.current_socket_path(), socket)

    def test_wifi_start_requires_confirmation_and_defaults_to_cancel(self):
        screen = menu.Menu.__new__(menu.Menu)
        screen.screen = "menu"
        screen.selected = 0
        screen.start_command = Mock()
        with patch.object(menu, "COMMANDS", (("set up wifi", menu.WIFI_SCREEN, (0, 0, 0)),)):
            screen.activate()
            self.assertEqual(screen.screen, "wifi-confirm")
            self.assertEqual(screen.confirm_selected, 1)
            screen.activate()
            screen.start_command.assert_not_called()
            screen.screen = "wifi-confirm"
            screen.confirm_selected = 0
            screen.activate()
            screen.start_command.assert_called_once_with(
                "set up wifi", ("sudo", "-n", menu.PI_CONTROL, "wifi-start"),
            )

    def test_wifi_credentials_only_appear_on_display(self):
        screen = menu.Menu.__new__(menu.Menu)
        screen.process = Mock()
        screen.process.poll.return_value = 0
        screen.running_label = "set up wifi"
        info = {"ssid": "private-ssid", "passphrase": "secret123456", "gateway": "192.168.42.1"}
        with patch.object(menu, "WIFI_INFO", info), patch("sys.stdout", new_callable=io.StringIO) as output:
            screen.poll_command()
        self.assertEqual(screen.screen, "wifi")
        self.assertIn("pw: secret123456", screen.network_rows)
        self.assertNotIn("secret123456", output.getvalue())
        screen.activate()
        self.assertEqual(screen.screen, "menu")

    def test_wifi_status_failure_is_visible(self):
        from concurrent.futures import Future

        screen = menu.Menu.__new__(menu.Menu)
        screen.screen = "wifi"
        screen.asleep = False
        screen.sleep_started = None
        screen.network_rows = ("starting", "ssid", "pw: secret")
        screen.wifi_future = Future()
        screen.wifi_future.set_result({"state": "failed", "result": "timeout"})
        screen.poll_wifi(1)
        self.assertTrue(screen.network_error)
        self.assertEqual(screen.network_rows[0], "wifi: timeout")
        self.assertEqual(screen.network_rows[2], "pw: secret")


class SessionTests(unittest.TestCase):
    def test_setup_prompt_spacing_and_closing_command_reminder(self):
        script = (HERE / "setup.sh").read_text()
        for index, line in enumerate(script.splitlines()):
            if "read -r" in line:
                self.assertEqual(script.splitlines()[index - 1].strip(), "echo")
        ending = script[script.index('echo "setup complete;'):]
        for selected, mode, command in (("true", 3, "charnel-session"),
                                         ("false", 2, "freqhole-pi attach")):
            result = subprocess.run(
                ["bash", "-c", f'set -euo pipefail\ncharnel={selected}\nmode={mode}\n' + ending],
                input="x", capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("setup complete;\n\n\n+", result.stdout)
            for text in ("freqhole-pi          command help", command, "reboot recommended"):
                self.assertIn(text, result.stdout)

    def test_startup_helper_limits_units_and_refuses_unmanaged_services(self):
        helper = (HERE / "freqhole-pi-control").read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            systemctl = root / "systemctl"
            systemctl.write_text('#!/bin/sh\nprintf "%s\\n" "$*"\n')
            systemctl.chmod(0o755)
            helper = helper.replace("/usr/bin/systemctl", str(systemctl))
            helper = helper.replace("/etc/systemd/system", directory)
            path = root / "control"
            path.write_text(helper)
            for action, unit, verb in (
                ("enable-rathole", "rathole", "enable"),
                ("disable-rathole", "rathole", "disable --now"),
                ("enable-menu", "rathole-ctrl", "enable"),
                ("disable-menu", "rathole-ctrl", "disable --now"),
                ("disable-wifi", "freqhole-wifi", "disable --now"),
            ):
                for managed in (False, True):
                    with self.subTest(action=action, managed=managed):
                        (root / f"{unit}.service").write_text(
                            "# managed by freqhole-pi setup\n" if managed else "# other service\n")
                        result = subprocess.run(["sh", str(path), action], capture_output=True, text=True)
                        self.assertEqual(result.returncode, 0 if managed else 1)
                        self.assertEqual(result.stdout.strip(), f"{verb} {unit}.service" if managed else "")
            result = subprocess.run(["sh", str(path), "enable-wifi"], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)

    def test_startup_picker_all_subset_cancel_and_invalid_input(self):
        script = (HERE / "freqhole-pi").read_text()
        function = script[script.index("manage_startup() {"):script.index('\nif [ "$(id -u)"')]
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            units = home / "units"
            units.mkdir()
            for unit in ("rathole", "rathole-ctrl", "freqhole-wifi"):
                (units / f"{unit}.service").write_text("# managed by freqhole-pi setup\n")
            config_home = home / ".config"
            user_units = config_home / "systemd/user"
            user_units.mkdir(parents=True)
            (user_units / "charnel.service").write_text("# managed by freqhole-pi setup\n")
            autostart = config_home / "autostart/freqhole-pi-charnel.desktop"
            prefix = (
                'set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\n'
                'systemctl() { if [ "$1" = show ]; then echo disabled; else echo "$*" >> "$CALLS"; fi; }\n'
                'sudo() { echo "$*" >> "$CALLS"; }\n'
            )
            function = function.replace("/etc/systemd/system", str(units))
            environment = dict(os.environ, HOME=directory, XDG_CONFIG_HOME=str(config_home),
                               CALLS=str(home / "calls"))
            for operation, selection, expected, status in (
                ("disable", "\n", ["-n /usr/local/libexec/freqhole-pi-control disable-rathole",
                                   "-n /usr/local/libexec/freqhole-pi-control disable-menu",
                                   "-n /usr/local/libexec/freqhole-pi-control disable-wifi",
                                   "--user stop charnel.service"], 0),
                ("enable", "\n", ["-n /usr/local/libexec/freqhole-pi-control enable-rathole",
                                  "-n /usr/local/libexec/freqhole-pi-control enable-menu"], 0),
                ("disable", "2\n", ["-n /usr/local/libexec/freqhole-pi-control disable-menu"], 0),
                ("disable", "q\n", [], 0),
                ("disable", "", [], 0),
                ("disable", "1 9\n", [], 1),
            ):
                with self.subTest(operation=operation, selection=selection):
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    result = subprocess.run(
                        ["bash", "-c", prefix + function + f"\nmanage_startup {operation}"],
                        input=selection, env=environment, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, status, result.stderr)
                    self.assertEqual(calls.read_text().splitlines() if calls.exists() else [], expected)
                    if operation == "enable":
                        self.assertIn("charnel-session", autostart.read_text())
                    if operation == "disable" and selection == "\n":
                        self.assertFalse(autostart.exists())

    def test_setup_banner_uses_full_blocks_and_no_ansi_when_redirected(self):
        script = (HERE / "setup.sh").read_text()
        banner = script[script.index("print_banner() {"):script.index("set_system_volume() {")]
        result = subprocess.run(["bash", "-c", "set -euo pipefail\n" + banner],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("\x1b", result.stdout)
        self.assertIn("raspberry pi setup", result.stdout)
        art = [line for line in result.stdout.splitlines() if "█" in line]
        self.assertEqual(len(art), 9)
        self.assertLessEqual(max(map(len, art)), 80)
        self.assertTrue(all(set(line) <= {"█", " "} for line in art))

    def test_rathole_install_leaves_config_and_data_to_first_run_wizard(self):
        script = (HERE / "setup.sh").read_text()
        start = script.index('if [ "$mode" != 3 ]; then\n    "$HOME/.local/bin/freqhole-pi" install')
        section = script[start:script.index("\nrender() {", start)]
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            updater = home / ".local/bin/freqhole-pi"
            updater.parent.mkdir(parents=True)
            updater.write_text('#!/bin/sh\necho "updater $*" >> "$CALLS"\n')
            updater.chmod(0o755)
            root = home / "install"
            root.mkdir()
            config = root / "freqhole-config.toml"
            for existing in (False, True):
                with self.subTest(existing=existing):
                    config.unlink(missing_ok=True)
                    if existing:
                        config.write_text("existing")
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    environment = dict(os.environ, HOME=directory, CALLS=str(calls))
                    result = subprocess.run(
                        ["bash", "-c", 'set -euo pipefail\nmode=2\nroot="$HOME/install"\n'
                         'die() { echo "$*" >&2; exit 1; }\n' + section],
                        env=environment, capture_output=True, text=True,
                    )
                    self.assertEqual(calls.read_text().splitlines(), ["updater install"])
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(config.exists(), existing)
                    self.assertFalse((root / "data").exists())
                    if existing:
                        self.assertEqual(config.read_text(), "existing")
        self.assertIn("ExecStart=@HOME@/.local/bin/rathole --player",
                      (HERE / "rathole.service").read_text())

    def test_rathole_oled_socket_waits_for_wizard_without_creating_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "freqhole-config.toml"
            installation = {"hardware": True, "menu_player": "rathole"}
            with patch.object(charnel, "ROOT", root):
                charnel.prepare_socket(installation)
                self.assertFalse(config.exists())
                config.write_text('data_dir = "/custom/music-data"\n[control_socket]\nenabled = false\n')
                before = config.read_text()
                charnel.prepare_socket(installation)
                self.assertEqual(config.read_text(), before)
                config.write_text('data_dir = "/custom/music-data"\n[control_socket]\nenabled = true\n')
                (root / "menu.json").write_text('{"direction": -1}')
                charnel.prepare_socket(installation)
                self.assertEqual(json.loads((root / "menu.json").read_text())["direction"], -1)
                parsed = tomllib.loads(config.read_text())
                self.assertEqual(parsed["data_dir"], "/custom/music-data")
                self.assertTrue(parsed["control_socket"]["enabled"])
                self.assertEqual(json.loads((root / "menu.json").read_text())["socket_path"],
                                 str(Path.home() / "rathole-control.sock"))

    def test_final_prompt_can_reboot_without_starting_app(self):
        script = (HERE / "setup.sh").read_text()
        ending = script[script.index('echo "setup complete;'):]
        for charnel in ("true", "false"):
            for answer in ("r", "R"):
                with self.subTest(charnel=charnel, answer=answer):
                    prefix = (
                        f'set -euo pipefail\ncharnel={charnel}\nmode=3\nroot=/test\n'
                        'sudo() { echo "requested: $*"; }\n'
                    )
                    result = subprocess.run(["bash", "-c", prefix + ending],
                                            input=answer, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.splitlines()[-1], "requested: systemctl reboot")

    def test_charnel_setup_sets_system_volume_with_explicit_failure_warning(self):
        script = (HERE / "setup.sh").read_text()
        function = script[script.index("set_system_volume() {"):script.index('\n[ "$(id -u)"')]
        self.assertIn('if "$charnel"; then\n    set_system_volume\n', script)
        for pipewire, pulse, alsa, expected in (
            (0, 0, 0, ["wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0"]),
            (1, 0, 0, ["wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0",
                        "pactl set-sink-volume @DEFAULT_SINK@ 100%"]),
            (1, 1, 0, ["wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0",
                        "pactl set-sink-volume @DEFAULT_SINK@ 100%", "amixer sset Master 100%"]),
            (1, 1, 1, ["wpctl set-volume @DEFAULT_AUDIO_SINK@ 1.0",
                        "pactl set-sink-volume @DEFAULT_SINK@ 100%", "amixer sset Master 100%"]),
        ):
            with self.subTest(pipewire=pipewire, pulse=pulse, alsa=alsa):
                prefix = (
                    "set -euo pipefail\n"
                    f'wpctl() {{ echo "wpctl $*"; return {pipewire}; }}\n'
                    f'pactl() {{ echo "pactl $*"; return {pulse}; }}\n'
                    f'amixer() {{ echo "amixer $*"; return {alsa}; }}\n'
                )
                result = subprocess.run(
                    ["bash", "-c", prefix + function + "\nset_system_volume"],
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.splitlines()[1:], expected)
                self.assertEqual("warning:" in result.stderr, bool(pipewire and pulse and alsa))

    def test_no_arguments_and_help_flags_print_help_without_setup_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = dict(os.environ, HOME=directory)
            outputs = []
            for arguments in ([], ["help"], ["-h"], ["--help"]):
                with self.subTest(arguments=arguments):
                    result = subprocess.run(
                        ["bash", str(HERE / "freqhole-pi"), *arguments],
                        env=environment, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, "")
                    for command in ("check", "status", "install", "update", "attach",
                                    "recover charnel", "launch charnel", "socket charnel"):
                        self.assertIn(command, result.stdout)
                    outputs.append(result.stdout)
            self.assertTrue(all(output == outputs[0] for output in outputs))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_shell_path_is_preserved_idempotent_and_not_duplicated(self):
        original = '# existing settings\n[ -n "$PS1" ] || return\n'
        updated = configure.shell_path_config(original)
        self.assertTrue(updated.endswith(original))
        self.assertEqual(configure.shell_path_config(updated), updated)
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / ".bashrc"
            profile.write_text(updated)
            for existing in ("/usr/bin:/bin", f"/usr/bin:{directory}/.local/bin:/bin"):
                environment = dict(os.environ, HOME=directory, PATH=existing, PS1="")
                result = subprocess.run(
                    ["bash", "-c", '. "$HOME/.bashrc"; . "$HOME/.bashrc"; printf "%s" "$PATH"'],
                    env=environment, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = existing if "/.local/bin" in existing else f"{directory}/.local/bin:{existing}"
                self.assertEqual(result.stdout, expected)

    def test_attach_uses_managed_tmux_without_release_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            state = home / ".local/share/freqhole-pi/tmux-tips-dismissed"
            state.parent.mkdir(parents=True)
            state.touch()
            tool = home / "tmux"
            tool.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n'
                            'if [ "$3" = has-session ]; then exit "$SESSION_STATUS"; fi\n'
                            'exit "$ATTACH_STATUS"\n')
            tool.chmod(0o755)
            # the helper runs as a regular account on the Pi, including when tests run as root.
            identity = home / "id"
            identity.write_text("#!/bin/sh\necho 1000\n")
            identity.chmod(0o755)
            for session_status, attach_status in ((0, 0), (0, 7)):
                with self.subTest(session_status=session_status, attach_status=attach_status):
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    environment = dict(os.environ, HOME=directory,
                                       PATH=directory + os.pathsep + os.environ["PATH"],
                                       CALLS=str(calls), SESSION_STATUS=str(session_status),
                                       ATTACH_STATUS=str(attach_status))
                    result = subprocess.run(
                        ["bash", str(HERE / "freqhole-pi"), "attach"],
                        env=environment, capture_output=True, text=True,
                    )
                    socket = home / ".local/share/freqhole-pi/tmux.sock"
                    expected = [f"-S {socket} has-session -t =rathole"]
                    if session_status == 0:
                        expected.append(f"-S {socket} attach-session -t =rathole")
                    self.assertEqual(calls.read_text().splitlines(), expected)
                    self.assertEqual(result.returncode, 1 if session_status else attach_status)

    def test_attach_offers_start_only_for_tmux_and_waits_for_session(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            state = home / ".local/share/freqhole-pi/tmux-tips-dismissed"
            state.parent.mkdir(parents=True)
            state.touch()
            tools = {
                "id": "echo 1000",
                "systemctl": 'printf "%s\\n" "$SERVICE_COMMAND"',
                "sudo": 'echo "$*" >> "$CALLS"; [ "$START_STATUS" = 0 ] || exit "$START_STATUS"; touch "$HOME/started"',
                "sleep": ":",
                "tmux": ('if [ "$3" = has-session ]; then\n'
                         '  [ -f "$HOME/started" ] && [ "$READY" = yes ]\n'
                         'else echo attached >> "$CALLS"; fi'),
            }
            for name, body in tools.items():
                tool = home / name
                tool.write_text("#!/bin/sh\n" + body + "\n")
                tool.chmod(0o755)
            command = f"/usr/bin/tmux -D -S {home}/.local/share/freqhole-pi/tmux.sock -f {home}/.local/share/freqhole-pi/tmux.conf"
            for answer, tmux_mode, start_status, ready in (
                ("\n", True, "0", "yes"), ("x", True, "0", "yes"),
                ("", True, "0", "yes"), ("\n", False, "0", "yes"),
                ("\n", True, "1", "yes"), ("\n", True, "0", "no"),
            ):
                with self.subTest(answer=answer, tmux_mode=tmux_mode, start_status=start_status, ready=ready):
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    (home / "started").unlink(missing_ok=True)
                    environment = dict(
                        os.environ, HOME=directory, PATH=directory + os.pathsep + os.environ["PATH"],
                        CALLS=str(calls), SERVICE_COMMAND=command if tmux_mode else "/usr/bin/rathole",
                        START_STATUS=start_status, READY=ready,
                    )
                    result = subprocess.run(
                        ["bash", str(HERE / "freqhole-pi"), "attach"],
                        input=answer, env=environment, capture_output=True, text=True,
                    )
                    starts = tmux_mode and answer == "\n"
                    expected = ["-n /usr/local/libexec/freqhole-pi-control start"] if starts else []
                    if starts and start_status == "0" and ready == "yes":
                        expected.append("attached")
                    self.assertEqual(calls.read_text().splitlines() if calls.exists() else [], expected)
                    failure = not tmux_mode or (starts and (start_status != "0" or ready != "yes"))
                    self.assertEqual(result.returncode, int(failure), result.stderr)
                    if starts and start_status == "0" and ready == "no":
                        self.assertIn("session did not start", result.stderr)
                    if not tmux_mode:
                        self.assertIn("not configured for SSH/tmux", result.stderr)

    def test_tmux_tips_continue_cancel_and_persist_dismissal(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for name, body in (
                ("id", "echo 1000"),
                ("tmux", 'echo "$*" >> "$CALLS"'),
            ):
                tool = home / name
                tool.write_text("#!/bin/sh\n" + body + "\n")
                tool.chmod(0o755)
            environment = dict(os.environ, HOME=directory,
                               PATH=directory + os.pathsep + os.environ["PATH"],
                               CALLS=str(home / "calls"))
            state = home / ".local/share/freqhole-pi/tmux-tips-dismissed"
            for answer in ("x", "", "\n", "n", ""):
                with self.subTest(answer=answer, dismissed=state.exists()):
                    dismissed = state.exists()
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    result = subprocess.run(
                        ["bash", str(HERE / "freqhole-pi"), "attach"],
                        input=answer, env=environment, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual("tmux quick help" in result.stdout, not dismissed)
                    self.assertEqual(calls.exists(), dismissed or answer in ("\n", "n"))
                    self.assertEqual(state.exists(), dismissed or answer == "n")
                    if not dismissed:
                        for shortcut in ("Ctrl+B, D", "Ctrl+B, [", "Ctrl+B, ?"):
                            self.assertIn(shortcut, result.stdout)
                    if state.exists():
                        self.assertEqual(state.stat().st_mode & 0o777, 0o600)

    def test_service_commands_forward_only_fixed_actions_to_privileged_helper(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            for name, body in (
                ("id", "echo 1000"),
                ("sudo", 'printf "%s\\n" "$*"; exit 7'),
            ):
                tool = home / name
                tool.write_text("#!/bin/sh\n" + body + "\n")
                tool.chmod(0o755)
            environment = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"])
            for action in ("start", "stop", "restart", "poweroff", "wifi-start", "wifi-stop"):
                with self.subTest(action=action):
                    result = subprocess.run(
                        ["bash", str(HERE / "freqhole-pi"), action],
                        env=environment, capture_output=True, text=True,
                    )
                    self.assertEqual(result.stdout.strip(), f"-n /usr/local/libexec/freqhole-pi-control {action}")
                    self.assertEqual(result.returncode, 7)

    def test_setup_selects_one_app_and_only_its_autostart_prompt(self):
        script = (HERE / "setup.sh").read_text()
        selection = script[script.index("charnel=false\n"):script.index('config_home="${XDG_CONFIG_HOME')]
        startup = script[script.index("autostart=false\n"):script.index('if "$hardware"; then\n    echo "hardware setup')]
        with tempfile.TemporaryDirectory() as directory:
            selection = selection.replace("/usr/share/xsessions", directory)
            for answer, architecture, expected in (
                ("1\ny\nn\nkeep\n", "arm64", "true 3 false true charnel"),
                ("2\n1\ny\n", "arm64", "false 1 true false rathole"),
                ("2\n\nn\n", "armhf", "false 2 false false rathole"),
                ("1\n", "armhf", None),
                ("2\n3\n", "arm64", None),
            ):
                with self.subTest(answer=answer, architecture=architecture):
                    prefix = ('set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\n'
                              f'dpkg() {{ echo "{architecture}"; }}\n'
                              'ask() { local answer; read -r -p "$1" answer; [ "$answer" = y ]; }\n')
                    result = subprocess.run(
                        ["bash", "-c", prefix + selection + startup +
                         '\necho "$charnel $mode $autostart $charnel_boot $menu_player"\n'],
                        input=answer, capture_output=True, text=True,
                    )
                    if expected is None:
                        self.assertNotEqual(result.returncode, 0)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(result.stdout.splitlines()[-1], expected)

    def test_charnel_service_sets_both_webkit_graphics_workarounds(self):
        unit = (HERE / "charnel.service").read_text()
        for variable in ("WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_DISABLE_DMABUF_RENDERER"):
            self.assertIn(f"Environment={variable}=1", unit.splitlines())

    def test_setup_launches_selected_app_only_on_enter_and_checks_health(self):
        script = (HERE / "setup.sh").read_text()
        ending = script[script.index('echo "setup complete;'):]
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            launcher = home / ".local/bin/charnel-session"
            launcher.parent.mkdir(parents=True)
            launcher.write_text('#!/bin/sh\necho launched >> "$CALLS"\n')
            launcher.chmod(0o755)
            attach = launcher.with_name("freqhole-pi")
            attach.write_text('#!/bin/sh\necho "$*" >> "$CALLS"\n')
            attach.chmod(0o755)
            prefix = (
                'set -euo pipefail\nroot="$HOME/root"\n'
                'die() { echo "$*" >&2; exit 1; }\n'
                'sleep() { :; }\n'
                'sudo() { echo "sudo $*" >> "$CALLS"; return "$START"; }\n'
                'systemctl() { echo "$*" >> "$CALLS"; return "$HEALTH"; }\n'
            )
            for selected, mode, display, answer, health, start in (
                ("true", 3, ":0", "\n", "0", "0"),
                ("true", 3, "", "\n", "0", "0"),
                ("true", 3, ":0", "\n", "1", "0"),
                ("true", 3, ":0", "x", "0", "0"),
                ("true", 3, ":0", "", "0", "0"),
                ("false", 1, "", "\n", "0", "0"),
                ("false", 2, "", "\n", "0", "0"),
                ("false", 2, "", "\n", "1", "0"),
                ("false", 2, "", "\n", "0", "1"),
                ("false", 2, "", "x", "0", "0"),
                ("false", 1, "", "", "0", "0"),
            ):
                with self.subTest(selected=selected, mode=mode, answer=answer, health=health, start=start):
                    calls = home / "calls"
                    calls.unlink(missing_ok=True)
                    env = dict(os.environ, HOME=str(home), DISPLAY=display, WAYLAND_DISPLAY="",
                               CALLS=str(calls), HEALTH=health, START=start)
                    result = subprocess.run(
                        ["bash", "-c", prefix + f"charnel={selected}\nmode={mode}\n" + ending],
                        input=answer, env=env, capture_output=True, text=True,
                    )
                    launches = answer == "\n" and (selected == "false" or bool(display))
                    self.assertEqual(calls.exists(), launches)
                    failed = launches and (health == "1" or (selected == "false" and start == "1"))
                    self.assertEqual(result.returncode, 1 if failed else 0, result.stderr)
                    if launches:
                        if selected == "true":
                            expected = ["launched", "--user is-active --quiet charnel.service"]
                        else:
                            expected = ["sudo -n /usr/local/libexec/freqhole-pi-control start"]
                            if start == "0":
                                expected.append("is-active --quiet rathole.service")
                            if not failed and mode == 2:
                                expected.append("attach")
                        self.assertEqual(calls.read_text().splitlines(), expected)
                    elif selected == "true" and answer == "\n":
                        self.assertIn("no graphical session", result.stdout)

    def test_wifi_status_requires_loaded_unit_and_reports_failure(self):
        for state in ("LoadState=loaded\nActiveState=failed\nResult=timeout\n",
                      "LoadState=not-found\nActiveState=inactive\nResult=\n"):
            with self.subTest(state=state), patch.object(
                wifi_control.subprocess, "run", return_value=Mock(stdout=state),
            ):
                if "not-found" in state:
                    with self.assertRaisesRegex(ValueError, "not installed"):
                        wifi_control.status()
                else:
                    self.assertEqual(wifi_control.status(), {"state": "failed", "result": "timeout"})

    def test_desktop_launcher_requires_a_real_session(self):
        environment = {key: value for key, value in os.environ.items() if key not in ("DISPLAY", "WAYLAND_DISPLAY")}
        result = subprocess.run(["bash", str(HERE / "charnel-session")], env=environment, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("existing graphical", result.stderr)

    def test_desktop_launcher_imports_session_and_starts_user_unit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tool = root / "systemctl"
            tool.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n')
            tool.chmod(0o755)
            environment = dict(os.environ, DISPLAY=":0", WAYLAND_DISPLAY="wayland-0",
                               PATH=directory + os.pathsep + os.environ["PATH"], CALLS=str(root / "calls"))
            result = subprocess.run(["bash", str(HERE / "charnel-session")], env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = (root / "calls").read_text().splitlines()
            self.assertIn("--user import-environment DISPLAY WAYLAND_DISPLAY", calls[0])
            self.assertEqual(calls[1], "--user start charnel.service")

    def test_wifi_recovery_limits_changes_to_its_own_ap(self):
        mock = """#!{python}
import os, pathlib, sys
args = sys.argv[1:]
with pathlib.Path(os.environ["CALLS"]).open("a") as output:
    output.write(" ".join(args) + "\\n")
if "GENERAL.CON-UUID" in args:
    print("own-uuid" if os.environ["CASE"] != "offline" else "--")
elif "802-11-wireless.mode" in args:
    print("infrastructure" if os.environ["CASE"] == "connected" else "ap")
elif "802-11-wireless.ssid" in args:
    print("unrelated-hotspot" if os.environ["CASE"] == "other-ap" else "freqhole-setup-test")
elif "GENERAL.STATE" in args:
    print("100 (connected)" if os.environ["CASE"] == "connected" else "30 (disconnected)")
elif "connect" in args and os.environ["CASE"] == "offline":
    sys.exit(1)
"""
        for case in ("connected", "stale-ap", "other-ap", "offline"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                nmcli = root / "nmcli"
                nmcli.write_text(mock.format(python=sys.executable))
                nmcli.chmod(0o755)
                recovery = root / "recover"
                recovery.write_text((HERE / "freqhole-pi-wifi-recover").read_text().replace("/usr/bin/nmcli", str(nmcli)))
                environment = dict(os.environ, PORTAL_INTERFACE="wlan0", PORTAL_SSID="freqhole-setup-test",
                                   CASE=case, CALLS=str(root / "calls"))
                result = subprocess.run(["sh", str(recovery)], env=environment, capture_output=True, text=True)
                calls = (root / "calls").read_text()
                if case in ("connected", "stale-ap"):
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                self.assertEqual("connection delete" in calls, case == "stale-ap")
                self.assertEqual("device connect" in calls, case in ("stale-ap", "offline"))


@unittest.skipUnless(shutil.which("tmux"), "tmux runtime not installed")
class TmuxTests(unittest.TestCase):
    def test_foreground_server_owns_session_and_exits_with_it(self):
        with tempfile.TemporaryDirectory(prefix="pi-") as directory:
            root = Path(directory)
            binary = root / ".local/bin/rathole"
            binary.parent.mkdir(parents=True)
            binary.write_text(
                '#!/bin/sh\n[ "$#" -eq 0 ] || exit 42\n'
                'printf "%s" "$PWD" > "$PWD/launched-cwd"\nexec sleep 120\n'
            )
            binary.chmod(0o755)
            config = root / "tmux.conf"
            config.write_text((HERE / "tmux.conf").read_text().replace("@HOME@", directory).replace("@ROOT@", directory))
            socket = str(root / "tmux.sock")
            process = subprocess.Popen(
                ["tmux", "-D", "-S", socket, "-f", str(config)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            try:
                for _ in range(50):
                    if (root / "launched-cwd").exists() or process.poll() is not None:
                        break
                    time.sleep(0.1)
                result = subprocess.run(
                    ["tmux", "-S", socket, "list-sessions", "-F", "#{session_name}"],
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), "rathole")
                self.assertEqual((root / "launched-cwd").read_text(), directory)
                self.assertIsNone(process.poll())
                subprocess.run(["tmux", "-S", socket, "kill-session", "-t", "rathole"], check=True)
                self.assertEqual(process.wait(timeout=5), 0)
            finally:
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=5)

    @unittest.skipUnless(shutil.which("systemd-analyze"), "systemd validation not installed")
    def test_rendered_systemd_units(self):
        with tempfile.TemporaryDirectory(prefix="pi-unit-") as directory:
            root = Path(directory)
            for relative in (".local/bin/rathole", ".venv/bin/python3"):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("#!/bin/sh\nexit 0\n")
                path.chmod(0o755)
            units = []
            # validate dependency/exec wiring without installing actual hardware/network services.
            network = root / "NetworkManager.service"
            network.write_text("[Service]\nExecStart=/bin/true\n")
            units.append(str(network))
            for template in ("rathole.service", "rathole-tmux.service", "rathole-ctrl.service",
                             "freqhole-wifi.service", "charnel.service"):
                content = (HERE / template).read_text()
                for key, value in (("@USER@", "root"), ("@HOME@", directory), ("@ROOT@", directory), ("@UID@", "0")):
                    content = content.replace(key, value)
                for executable in ("/usr/bin/charnel", "/usr/local/bin/wifi-connect",
                                   "/usr/local/libexec/freqhole-pi-wifi-recover", "/usr/bin/nmcli"):
                    content = content.replace(executable, "/bin/true")
                self.assertNotIn("@", content.replace("getty@tty1", "getty-tty1"))
                path = root / template
                path.write_text(content)
                units.append(str(path))
            result = subprocess.run(
                ["systemd-analyze", "verify", "--man=no", *units], capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
