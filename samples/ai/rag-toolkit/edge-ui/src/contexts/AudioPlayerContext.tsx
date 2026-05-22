// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FetchAPI } from '@/utils/api';
import React, { useState, useEffect, createContext, type ReactNode, useCallback } from 'react';

const STTAPI = new FetchAPI(`http://${process.env.NEXT_PUBLIC_STT_API_URL ?? "localhost"}:${process.env.NEXT_PUBLIC_STT_API_PORT ?? "8013"}`);

export interface AudioClipProps {
    audioUrl: string;
    audioElement: HTMLAudioElement;
    text: string;
};

export interface AudioQueueProps {
    text: string;
    audio: string | undefined;
}

export interface AudioPlayerContextProps {
    addQueue: (text: string) => void;
    addToAudioQueue: (audioQueue: AudioQueueProps) => void;
    clearAudioQueue: () => void;
    isPlaying: boolean;
    currentAudioClip: AudioClipProps | null;
    queueEmpty: boolean
}
export const AudioPlayerContext = createContext<AudioPlayerContextProps>({} as AudioPlayerContextProps);

export function AudioPlayerProvider({ children }: { children: ReactNode }): React.JSX.Element {
    const [queue, setQueue] = useState<AudioQueueProps[]>([]);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [currentAudioClip, setCurrentAudioClip] = useState<AudioClipProps | null>(null);

    useEffect(() => {
        const playAudio = async (audioClipUri: string, text: string): Promise<void> => {
            setIsPlaying(true);
            const audioUrl: string = audioClipUri;
            const audio = new Audio(audioUrl);
            audio.preload = 'auto';
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                setQueue((oldQueue) => {
                    return oldQueue.slice(1);
                });
                setIsPlaying(false);

                setCurrentAudioClip(null);
            };
            audio.onerror = () => {
                URL.revokeObjectURL(audioUrl);
                setQueue((oldQueue) => {
                    return oldQueue.slice(1);
                });
                setIsPlaying(false);

                setCurrentAudioClip(null);
            }
            void audio.play();
            setCurrentAudioClip({
                text,
                audioElement: audio,
                audioUrl,
            });
        };

        if (!isPlaying && queue.length > 0 && queue[0].audio) {
            if (!queue[1] || (queue[1]?.audio))
                void playAudio(queue[0].audio, queue[0].text);
        }
    }, [queue, isPlaying]);

    const addToAudioQueue = (audioQueue: AudioQueueProps): void => {
        if (!audioQueue.audio) return;
        setQueue((oldQueue) => {
            return oldQueue.map((q) => {
                if (q.text === audioQueue.text) {
                    q.audio = audioQueue.audio;
                }

                return q;
            });
        });
    };

    const removeAudioFromQueue = (text: string): void => {
        if (text) {
            setQueue((oldQueue) => {
                return oldQueue.filter(q => q.text !== text)
            })
        }
    }

    const textToSpeech = useCallback(
        async (text: string) => {
            try {
                const response = await STTAPI.file('audio/speech', { input: text, voice: "EN-US", model: "-", speed: 1.25 });
                const blobData = await response.blob();
                const objectURL = URL.createObjectURL(blobData);
                addToAudioQueue({ text, audio: objectURL });
            } catch (err) {
                console.log(err)
                removeAudioFromQueue(text)
            }
        },
        []
    );

    const addQueue = async (text: string): Promise<void> => {
        setQueue((oldQueue) => [...oldQueue, { text, audio: undefined }]);
        // Request for tts
        await textToSpeech(text)
    };

    const clearAudioQueue = (): void => {
        if (currentAudioClip) {
            // Stop currently playing audio
            currentAudioClip.audioElement.pause();
            URL.revokeObjectURL(currentAudioClip.audioUrl);

            setCurrentAudioClip(null);
            setIsPlaying(false);
        }

        // Flush all the remaining audio clips
        setQueue([]);
    };

    const queueEmpty = queue.length < 1

    const value = { addQueue, addToAudioQueue, clearAudioQueue, isPlaying, currentAudioClip, queueEmpty };

    return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>;
};