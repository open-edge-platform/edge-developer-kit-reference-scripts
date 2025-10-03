# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import fractions

class CONSTANTS:
    # Audio
    AUDIO_FPS = 25
    AUDIO_SAMPLE_RATE = 16000
    AUDIO_CHUNK_SIZE = AUDIO_SAMPLE_RATE // AUDIO_FPS // 2

    # WebRTC
    VIDEO_CLOCK_RATE = 90000
    VIDEO_PTIME = 0.040 # 1 / 25 fps
    VIDEO_TIME_BASE = fractions.Fraction(1, VIDEO_CLOCK_RATE)

    AUDIO_SAMPLE_RATE = 16000
    AUDIO_PTIME = 0.020
    AUDIO_TIME_BASE = fractions.Fraction(1, AUDIO_SAMPLE_RATE)

    PUNCTUATION = {
        "#": "", 
        "*": "", 
        ":": "", 
        "\"": "", 
        "\'": "",
        "。": "",
        "；": "",
        "：": "",
        "！": "",
        "，": "",
        "！": "",
        "？": "",
        "-": " ",  
        "?": " ", 
        "—": " ",
    }