// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { AudioPlayerContext, type AudioPlayerContextProps } from '@/contexts/AudioPlayerContext';
import { useContext } from 'react';

const useAudioPlayer: () => AudioPlayerContextProps = () => useContext(AudioPlayerContext);

export default useAudioPlayer;