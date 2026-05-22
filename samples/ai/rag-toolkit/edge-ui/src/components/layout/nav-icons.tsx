// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import React from 'react';
import {
  Article,
  ArticleOutlined,
  Build,
  BuildOutlined,
  Chat,
  ChatOutlined,
  CloudUpload,
  CloudUploadOutlined,
  MenuOutlined,
  Message,
  MessageOutlined,
  Settings,
  SettingsOutlined,
  Storage,
  StorageOutlined,
  type SvgIconComponent,
} from '@mui/icons-material';

const icons = {
  message: { normal: MessageOutlined, active: Message },
  article: { normal: ArticleOutlined, active: Article },
  settings: { normal: Settings, active: SettingsOutlined },
  storage: { normal: StorageOutlined, active: Storage },
  build: { normal: BuildOutlined, active: Build },
  cloudUpload: { normal: CloudUploadOutlined, active: CloudUpload },
  chat: { normal: ChatOutlined, active: Chat }
} as Record<string, Record<string, SvgIconComponent>>;

export default function Icon({ iconName, active }: { iconName: string; active: boolean }): React.JSX.Element {
  let IconComponent = icons[iconName][active ? 'active' : 'normal'];

  if (!IconComponent) {
    IconComponent = MenuOutlined; // Fallback if icon not found
  }

  return (
    <IconComponent
      sx={{
        fontSize: 'var(--icon-fontSize-md)',
        color: active ? 'var(--NavItem-icon-active-color)' : 'var(--NavItem-icon-color)',
      }}
    />
  );
}
