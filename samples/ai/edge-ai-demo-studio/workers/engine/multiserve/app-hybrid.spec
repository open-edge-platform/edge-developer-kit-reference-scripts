# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

hiddenimports = collect_submodules('uvicorn')
hiddenimports += collect_submodules('tiktoken')
hiddenimports += collect_submodules('openvino')
hiddenimports += collect_submodules('openvino_tokenizers')
hiddenimports += [
    'tiktoken_ext.openai_public',
    'tiktoken_ext'
]

datas = [
    ('engine/llama.cpp-vulkan', './engine/llama.cpp-vulkan'), 
    ('engine/xpu-smi', './engine/xpu-smi'), 
    ('engine/gguf-parser-windows-amd64.exe', './engine/'), 
    ('static', './static')
]
datas += collect_data_files("openvino", include_py_files=True)
datas += collect_data_files("openvino_tokenizers", include_py_files=True)

a = Analysis(
    ['app-hybrid.py'],
    pathex=[],
    binaries=[('icon.ico', '.'), ('config.yaml', '.'), ('verified.yaml', '.')],
    datas=datas,
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
    name='InferenceServerManager-Hybrid',
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
