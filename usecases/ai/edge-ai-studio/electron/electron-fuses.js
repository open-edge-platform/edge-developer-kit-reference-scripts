// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

exports.default = async function (context) {
  const { electronPlatformName, appOutDir } = context;
  
  let electronBinaryPath;
  
  if (electronPlatformName === 'darwin') {
    electronBinaryPath = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'MacOS',
      context.packager.appInfo.productFilename
    );
  } else if (electronPlatformName === 'win32') {
    electronBinaryPath = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.exe`
    );
  } else {
    electronBinaryPath = path.join(
      appOutDir,
      context.packager.appInfo.productFilename
    );
  }

  console.log('Flipping Electron fuses...');
  
  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  console.log('Fuses flipped successfully!');
};
