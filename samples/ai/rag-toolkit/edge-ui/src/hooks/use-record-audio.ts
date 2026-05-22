// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable @typescript-eslint/no-unsafe-call -- client imported module*/
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- client imported module*/
/* eslint-disable @typescript-eslint/no-unsafe-argument -- client imported module*/
"use client"
import { FetchAPI } from '@/utils/api';

import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const TTSAPI = new FetchAPI(`http://${process.env.NEXT_PUBLIC_TTS_API_URL ?? "localhost"}:${process.env.NEXT_PUBLIC_TTS_API_PORT ?? "8014"}`);

export interface LanguageProps {
  value: string,
  type: "transcriptions" | "translations"
}

export const useRecordAudio = (): {
  speechProcessing: boolean;
  noiseThreshold: number;
  dbLevel: number;
  recording: boolean;
  thresholdActivation: boolean;
  text: Record<string, string>;
  updateThresholdActivation: (status: boolean) => void;
  languages: {
    name: string;
    value: string;
  }[];
  language: LanguageProps;
  updateLanguage: (selectedLanguage: LanguageProps) => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearText: () => void;
  setDisabled: Dispatch<SetStateAction<boolean>>;
} => {
  const languages = [
    { name: 'English', value: 'english' },
    { name: 'Chinese', value: 'chinese' },
    { name: 'Korean', value: 'korean' }
  ];
  const noiseThreshold = 90
  // stop timer threhold in seconds*100
  const timerThreshold = 100

  const [initialLoad, setInitialLoad] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState({ type: "none", result: "" });
  const [language, setLanguage] = useState<LanguageProps>({ value: languages[0].value, type: "transcriptions" });
  const chunks = useRef<Blob[]>([]);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [dbLevel, setDBLevel] = useState(0)
  const [speechProcessing, setSpeechProcessing] = useState(false)
  const [thresholdActivation, setThresholdActivation] = useState(false)
  const [disabled, setDisabled] = useState(false)
  // eslint-disable-next-line no-undef -- NodeJS not found somehow
  const intervals: NodeJS.Timeout[] = useMemo(() => {
    return []
  }, [])

  const getText = useCallback(
    async (audioBlob: Blob, mimeType: string, selectedLanguage: LanguageProps) => {
      const form = new FormData();
      form.append('file', new File([audioBlob], 'test.wav', { type: mimeType }));
      form.append('language', selectedLanguage.value);
      const response = await TTSAPI.post(`audio/${selectedLanguage.type}`, form, {
        headers: {}
      });

      return response;
    },
    []
  );

  const updateLanguage = useCallback((selectedLanguage: LanguageProps): void => {
    setLanguage(selectedLanguage)
    setMediaRecorder(recorder => {
      const tempRecorder = recorder
      if (!tempRecorder)
        return tempRecorder

      tempRecorder.onstop = () => {
        const mimeType = tempRecorder.mimeType;
        const audioBlob = new Blob(chunks.current, { type: mimeType });
        setRecording(false);
        setSpeechProcessing(true)
        getText(audioBlob, mimeType, selectedLanguage).then((result) => {
          if (result.status)
            setText({ type: "success", result: result.text ?? "" });
          else
            setText({ type: "error", result: result.data });

        }).catch((err: unknown) => {
          console.log(err)
        }).finally(() => {
          setSpeechProcessing(false)
        });
      }

      return tempRecorder
    })
  }, [getText])

  const clearText = (): void => {
    setText({ type: "none", result: "" })
  }

  const initialMediaRecorder = useCallback(
    (stream: MediaStream, MediaRecorder: any) => {
      const wavRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      // Event handler when recording starts
      wavRecorder.onstart = () => {
        chunks.current = []; // Resetting chunks array
      };

      // Event handler when data becomes available during recording
      wavRecorder.ondataavailable = (ev: BlobEvent) => {
        chunks.current.push(ev.data); // Storing data chunks
      };

      // Event handler when recording stops
      wavRecorder.onstop = () => {
        const mimeType = wavRecorder.mimeType;
        const audioBlob = new Blob(chunks.current, { type: mimeType });
        setRecording(false);
        setSpeechProcessing(true)
        getText(audioBlob, mimeType, language).then((result) => {
          if (result.status)
            setText({ type: "success", result: result.text ?? "" });
          else
            setText({ type: "error", result: result.data });

        }).catch((err: unknown) => {
          console.log(err)
        }).finally(() => {
          setSpeechProcessing(false)
        });
      };

      setMediaRecorder(wavRecorder);

      // Analyzer to activate only on certain noise level
      const audioCtx = new AudioContext();
      const sourceAnalyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(sourceAnalyser);

      setAnalyser(sourceAnalyser)
    },
    [getText, language]
  );

  const updateThresholdActivation = (status: boolean): void => {
    setThresholdActivation(status)
  }

  const startRecording = useCallback(() => {
    if (mediaRecorder) {
      setText({ type: "none", result: "" })
      mediaRecorder.start();
      setRecording(true);
    }
  }, [mediaRecorder])

  const stopRecording = useCallback(() => {
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
  }, [mediaRecorder]);

  // check noise level and activate base on noise level
  useEffect(() => {
    if (!thresholdActivation && intervals.length > 0) {
      intervals.forEach(interval => {
        clearInterval(interval)
      })
    }

    if (!analyser)
      return
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function getDbLevel(): number | null {
      if (!analyser)
        return null
      analyser.getByteFrequencyData(dataArray);

      // Compute the RMS (root mean square) of the audio data
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSquares / bufferLength);

      // Avoid log of zero by adding a small epsilon value
      const epsilon = 1e-8;
      const dB = 20 * Math.log10(rms + epsilon);

      // Handle the case where rms is very small
      if (isNaN(dB) || dB === -Infinity) {
        return -160; // A value representing silence or very low sound
      }

      // *2 to assume that as percentage
      return Math.trunc(dB) * 2;
    }
    let stopTimer = 0
    let isRecording = false
    // Example: Log the dB level every second
    const intervalID = setInterval(() => {
      const db = getDbLevel()
      if (db) {
        setDBLevel(Math.min(db, 100))
        if (!thresholdActivation || disabled)
          return

        if (db >= noiseThreshold) {
          if (!isRecording) {
            startRecording()
            isRecording = true
          }
          stopTimer = 0
        }
        else if (db < noiseThreshold && isRecording) {
          if (stopTimer > timerThreshold) {
            stopTimer = 0
            stopRecording()
            isRecording = false
          }
          else {
            stopTimer += 1
          }
        }
      }
    }, 10);

    intervals.push(intervalID)
  }, [analyser, disabled, intervals, startRecording, stopRecording, thresholdActivation])

  useEffect(() => {
    async function loadRecorder(): Promise<void> {
      const { connect } = (await import('extendable-media-recorder-wav-encoder'));
      const { MediaRecorder, register } = (await import('extendable-media-recorder'))
      connect().then(async (res) => {
        if (!MediaRecorder.isTypeSupported("audio/wav")) {
          await register(res)
        }
        try {
          const recorder = navigator.mediaDevices;
          if (recorder)
            recorder.getUserMedia({ audio: true })
              .then((stream) => { initialMediaRecorder(stream, MediaRecorder) })
              .catch((err: unknown) => {
                console.log(err)
              })
        } catch (error) {
          console.log(error);
        }
      }).catch((err: unknown) => {
        console.log(err)
      });
    }

    if (typeof window !== 'undefined' && !mediaRecorder && !initialLoad) {
      setInitialLoad(true);
      void loadRecorder()
    }
  }, [mediaRecorder, initialLoad, initialMediaRecorder]);

  return {
    speechProcessing, noiseThreshold, dbLevel, recording, text,
    thresholdActivation, updateThresholdActivation,
    languages, language, updateLanguage,
    startRecording, stopRecording, clearText, setDisabled
  };
};

export const preferredRegion = 'home'