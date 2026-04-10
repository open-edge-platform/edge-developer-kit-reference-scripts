import subprocess  # nosec - disable B404:import-subprocess check
import re


def get_git_hash():
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"])
            .decode("ascii")
            .strip()
        )
    except Exception:
        return "unknown"


def update_version_in_file(file_path, base_version):
    git_hash = get_git_hash()
    new_version = f"{base_version}+{git_hash}"

    with open(file_path, "r") as f:
        content = f.read()

    pattern = r'VERSION\s*=\s*["\'].*?["\']'
    replacement = f'VERSION = "{new_version}"'

    new_content = re.sub(pattern, replacement, content)

    with open(file_path, "w") as f:
        f.write(new_content)

    print(f"Updated {file_path} to VERSION = {new_version}")
    return new_version


if __name__ == "__main__":
    with open("VERSION", "r") as rfile:
        version = rfile.readline()
    update_version_in_file("app.py", version)

    print("Starting PyInstaller build...")
    subprocess.run(["pyinstaller", "app-vulkan.spec"])
