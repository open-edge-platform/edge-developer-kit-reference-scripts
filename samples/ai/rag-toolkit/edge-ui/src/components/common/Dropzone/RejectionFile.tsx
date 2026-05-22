// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// material-ui
import React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { alpha } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
// third-party
import { type FileRejection } from 'react-dropzone';

import { type CustomFile } from '@/types/dropzone';

interface RejectionFilesProps {
  fileRejections: FileRejection[];
}

export default function RejectionFiles({ fileRejections }: RejectionFilesProps): React.JSX.Element {
  function getDropzoneData(file: CustomFile | string, index?: number): Record<string, any> {
    if (typeof file === 'string') {
      return {
        key: index ? `${file}-${index}` : file,
        preview: file,
      };
    }

    return {
      key: index ? `${file.name}-${index}` : file.name,
      name: file.name,
      size: file.size,
      path: file.path,
      type: file.type,
      preview: file.preview,
      lastModified: file.lastModified,
      lastModifiedDate: file.lastModifiedDate,
    };
  }
  return (
    <Paper
      variant="outlined"
      sx={{
        py: 1,
        px: 2,
        borderColor: 'error.light',
        bgcolor: (theme) => alpha(theme.palette.error.main, 0.08),
      }}
    >
      {fileRejections.map(({ file, errors }) => {
        const { path, size } = getDropzoneData(file);

        return (
          <Box key={path} sx={{ my: 1 }}>
            <Typography variant="subtitle2" noWrap>
              {path} - {size ? size : ''}
            </Typography>

            {errors.map((error) => (
              <Box key={error.code} component="li" sx={{ typography: 'caption' }}>
                {error.message}
              </Box>
            ))}
          </Box>
        );
      })}
    </Paper>
  );
}
