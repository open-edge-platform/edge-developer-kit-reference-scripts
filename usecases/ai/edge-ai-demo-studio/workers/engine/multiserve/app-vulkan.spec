# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules('uvicorn')
hiddenimports += collect_submodules('tiktoken')
hiddenimports += [
    'tiktoken_ext.openai_public',
    'tiktoken_ext'
]

a = Analysis(
    ['app.py'],
    pathex=[],
    binaries=[('icon.ico', '.'), ('config.yaml', '.'), ('verified.yaml', '.')],
    datas=[('engine/llama.cpp-vulkan', './engine/llama.cpp-vulkan'), ('engine/xpu-smi', './engine/xpu-smi'), ('engine/gguf-parser-windows-amd64.exe', './engine/'), ('static', './static')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='InferenceServerManager-Vulkan',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['icon.ico'],
)
