// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from 'react';
import { Article, CloudUpload, Delete } from '@mui/icons-material';
import { Box, Button, CircularProgress, IconButton, List, ListItem, ListItemText, Typography } from '@mui/material';
import { Stack } from '@mui/system';
import { useDropzone } from 'react-dropzone';

import { type CustomFile, type UploadMultiFileProps } from '@/types/dropzone';

import RejectionFiles from './RejectionFile';

export default function Dropzone({
  files = [],
  setFieldValue,
  acceptFileType,
  isMultiple = true,
  isUploading,
  onUpload,
}: UploadMultiFileProps): React.JSX.Element {
  const acceptedFileString = useMemo(() => {
    if (acceptFileType) return `(Only ${Object.values(acceptFileType).flat().join(', ')} files are accepted)`;
    return '';
  }, [acceptFileType]);

  const { getRootProps, getInputProps, isDragActive, fileRejections, isDragReject } = useDropzone({
    multiple: isMultiple,
    accept: acceptFileType,
    disabled: isUploading,
    onDrop: (acceptedFiles: CustomFile[]) => {
      if (files) {
        setFieldValue('files', [
          ...files,
          ...acceptedFiles.map((file: CustomFile) =>
            Object.assign(file, {
              preview: URL.createObjectURL(file),
            })
          ),
        ]);
      } else {
        setFieldValue(
          'files',
          acceptedFiles.map((file: CustomFile) =>
            Object.assign(file, {
              preview: URL.createObjectURL(file),
            })
          )
        );
      }
    },
  });

  const onRemoveAll = (): void => {
    setFieldValue('files', null);
  };

  const onRemove = (file: File | string): void => {
    const filteredItems = files?.filter((_file) => _file !== file);
    setFieldValue('files', filteredItems);
  };

  return (
    <>
      <Box
        {...getRootProps()}
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          width: '100%',
          height: 200,
          borderWidth: 2,
          borderRadius: 1,
          borderColor: '#eeeeee',
          borderStyle: 'dashed',
          backgroundColor: '#fafafa',
          color: '#bdbdbd',
          outline: 'none',
          transition: 'border 0.24s ease-in-out',
          textAlign: 'center',
          '&:hover': {
            borderColor: '#2196f3',
          },
          ...(isDragActive && {
            borderColor: '#2196f3',
          }),
        }}
      >
        <input {...getInputProps()} />
        <CloudUpload sx={{ fontSize: '4rem' }} />
        <Typography>Click to upload or drag and drop</Typography>
        <Typography>{acceptedFileString}</Typography>
      </Box>
      <List sx={{ maxHeight: 200, overflow: 'auto' }}>
        {fileRejections.length > 0 && <RejectionFiles fileRejections={[...fileRejections]} />}
        {files
          ? files.map((file, index) => (
            <ListItem
              key={index}
              secondaryAction={
                <IconButton
                  color="error"
                  edge="end"
                  aria-label="delete"
                  disabled={isUploading}
                  onClick={() => {
                    onRemove(file);
                  }}
                >
                  <Delete />
                </IconButton>
              }
            >
              <Stack gap=".5rem" direction="row" alignItems="center" sx={{ overflow: 'hidden' }}>
                <Article />
                <ListItemText primary={file.name} secondary={`${(file.size / 1024).toFixed(2)} KB`} />
              </Stack>
            </ListItem>
          ))
          : null}
      </List>
      {files && files.length > 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button color="error" onClick={onRemoveAll} disabled={isUploading}>
            Remove all
          </Button>
          <Button disabled={isUploading || isDragReject} variant="contained" color="primary" onClick={onUpload}>
            {isUploading ? (
              <Stack gap=".5rem" direction="row">
                <Typography>Uploading</Typography>
                <CircularProgress sx={{ color: 'white' }} size={20} />
              </Stack>
            ) : (
              'Upload'
            )}
          </Button>
        </Box>
      ) : null}
    </>
  );
}
