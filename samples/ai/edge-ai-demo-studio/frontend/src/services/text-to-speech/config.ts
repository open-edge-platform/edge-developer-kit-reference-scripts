// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceConfig } from '@/services/types'

export interface VoiceInfo {
  id: string
  label: string
  language: string
}

const KOKORO_VOICES: VoiceInfo[] = [
  // American English — Female
  { id: 'af_heart', label: 'Heart', language: 'English (American)' },
  { id: 'af_alloy', label: 'Alloy', language: 'English (American)' },
  { id: 'af_aoede', label: 'Aoede', language: 'English (American)' },
  { id: 'af_bella', label: 'Bella', language: 'English (American)' },
  { id: 'af_jadzia', label: 'Jadzia', language: 'English (American)' },
  { id: 'af_jessica', label: 'Jessica', language: 'English (American)' },
  { id: 'af_kore', label: 'Kore', language: 'English (American)' },
  { id: 'af_nicole', label: 'Nicole', language: 'English (American)' },
  { id: 'af_nova', label: 'Nova', language: 'English (American)' },
  { id: 'af_river', label: 'River', language: 'English (American)' },
  { id: 'af_sarah', label: 'Sarah', language: 'English (American)' },
  { id: 'af_sky', label: 'Sky', language: 'English (American)' },
  // American English — Male
  { id: 'am_adam', label: 'Adam', language: 'English (American)' },
  { id: 'am_echo', label: 'Echo', language: 'English (American)' },
  { id: 'am_eric', label: 'Eric', language: 'English (American)' },
  { id: 'am_fenrir', label: 'Fenrir', language: 'English (American)' },
  { id: 'am_liam', label: 'Liam', language: 'English (American)' },
  { id: 'am_michael', label: 'Michael', language: 'English (American)' },
  { id: 'am_onyx', label: 'Onyx', language: 'English (American)' },
  { id: 'am_puck', label: 'Puck', language: 'English (American)' },
  { id: 'am_santa', label: 'Santa', language: 'English (American)' },
  // British English — Female
  { id: 'bf_alice', label: 'Alice', language: 'English (British)' },
  { id: 'bf_emma', label: 'Emma', language: 'English (British)' },
  { id: 'bf_lily', label: 'Lily', language: 'English (British)' },
  // British English — Male
  { id: 'bm_daniel', label: 'Daniel', language: 'English (British)' },
  { id: 'bm_fable', label: 'Fable', language: 'English (British)' },
  { id: 'bm_george', label: 'George', language: 'English (British)' },
  { id: 'bm_lewis', label: 'Lewis', language: 'English (British)' },
  // Spanish
  { id: 'ef_dora', label: 'Dora', language: 'Spanish' },
  { id: 'em_alex', label: 'Alex', language: 'Spanish' },
  { id: 'em_santa', label: 'Santa', language: 'Spanish' },
  // French
  { id: 'ff_siwis', label: 'Siwis', language: 'French' },
  // Hindi
  { id: 'hf_alpha', label: 'Alpha', language: 'Hindi' },
  { id: 'hf_beta', label: 'Beta', language: 'Hindi' },
  { id: 'hm_omega', label: 'Omega', language: 'Hindi' },
  { id: 'hm_psi', label: 'Psi', language: 'Hindi' },
  // Italian
  { id: 'if_sara', label: 'Sara', language: 'Italian' },
  { id: 'im_nicola', label: 'Nicola', language: 'Italian' },
  // Japanese
  { id: 'jf_alpha', label: 'Alpha', language: 'Japanese' },
  { id: 'jf_gongitsune', label: 'Gongitsune', language: 'Japanese' },
  { id: 'jf_nezumi', label: 'Nezumi', language: 'Japanese' },
  { id: 'jf_tebukuro', label: 'Tebukuro', language: 'Japanese' },
  { id: 'jm_kumo', label: 'Kumo', language: 'Japanese' },
  // Portuguese
  { id: 'pf_dora', label: 'Dora', language: 'Portuguese' },
  { id: 'pm_alex', label: 'Alex', language: 'Portuguese' },
  { id: 'pm_santa', label: 'Santa', language: 'Portuguese' },
  // Chinese
  { id: 'zf_xiaobei', label: 'Xiaobei', language: 'Chinese' },
  { id: 'zf_xiaoni', label: 'Xiaoni', language: 'Chinese' },
  { id: 'zf_xiaoxiao', label: 'Xiaoxiao', language: 'Chinese' },
  { id: 'zf_xiaoyi', label: 'Xiaoyi', language: 'Chinese' },
  { id: 'zm_yunjian', label: 'Yunjian', language: 'Chinese' },
  { id: 'zm_yunxi', label: 'Yunxi', language: 'Chinese' },
  { id: 'zm_yunxia', label: 'Yunxia', language: 'Chinese' },
  { id: 'zm_yunyang', label: 'Yunyang', language: 'Chinese' },
]

const MALAYA_VOICES: VoiceInfo[] = [
  { id: 'Husein', label: 'Husein', language: 'Malay' },
  { id: 'Shafiqah Idayu', label: 'Shafiqah Idayu', language: 'Malay' },
  { id: 'Anwar Ibrahim', label: 'Anwar Ibrahim', language: 'Malay' },
]

const PIPER_VOICES: VoiceInfo[] = [
  {
    id: 'en_US-amy-low',
    label: 'Amy (Low)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-amy-medium',
    label: 'Amy (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-arctic-medium',
    label: 'Arctic (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-bryce-medium',
    label: 'Bryce (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-danny-low',
    label: 'Danny (Low)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-hfc_female-medium',
    label: 'Hfc Female (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-hfc_male-medium',
    label: 'Hfc Male (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-joe-medium',
    label: 'Joe (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-john-medium',
    label: 'John (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-kathleen-low',
    label: 'Kathleen (Low)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-kristin-medium',
    label: 'Kristin (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-kusal-medium',
    label: 'Kusal (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-l2arctic-medium',
    label: 'L2arctic (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-lessac-low',
    label: 'Lessac (Low)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-lessac-medium',
    label: 'Lessac (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-lessac-high',
    label: 'Lessac (High)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-libritts-high',
    label: 'Libritts (High)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-libritts_r-medium',
    label: 'Libritts R (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-ljspeech-medium',
    label: 'Ljspeech (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-ljspeech-high',
    label: 'Ljspeech (High)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-norman-medium',
    label: 'Norman (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-reza_ibrahim-medium',
    label: 'Reza Ibrahim (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-ryan-low',
    label: 'Ryan (Low)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-ryan-medium',
    label: 'Ryan (Medium)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-ryan-high',
    label: 'Ryan (High)',
    language: 'English (United States)',
  },
  {
    id: 'en_US-sam-medium',
    label: 'Sam (Medium)',
    language: 'English (United States)',
  },
  // English (Great Britain)
  {
    id: 'en_GB-alan-low',
    label: 'Alan (Low)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-alan-medium',
    label: 'Alan (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-alba-medium',
    label: 'Alba (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-aru-medium',
    label: 'Aru (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-cori-medium',
    label: 'Cori (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-cori-high',
    label: 'Cori (High)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-jenny_dioco-medium',
    label: 'Jenny Dioco (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-northern_english_male-medium',
    label: 'Northern English Male (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-semaine-medium',
    label: 'Semaine (Medium)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-southern_english_female-low',
    label: 'Southern English Female (Low)',
    language: 'English (Great Britain)',
  },
  {
    id: 'en_GB-vctk-medium',
    label: 'Vctk (Medium)',
    language: 'English (Great Britain)',
  },
  // Albanian (Albania)
  {
    id: 'sq_AL-edon-medium',
    label: 'Edon (Medium)',
    language: 'Albanian (Albania)',
  },
  // Arabic (Jordan)
  {
    id: 'ar_JO-kareem-low',
    label: 'Kareem (Low)',
    language: 'Arabic (Jordan)',
  },
  {
    id: 'ar_JO-kareem-medium',
    label: 'Kareem (Medium)',
    language: 'Arabic (Jordan)',
  },
  // Basque (Spain)
  {
    id: 'eu_ES-antton-medium',
    label: 'Antton (Medium)',
    language: 'Basque (Spain)',
  },
  {
    id: 'eu_ES-maider-medium',
    label: 'Maider (Medium)',
    language: 'Basque (Spain)',
  },
  // Bulgarian (Bulgaria)
  {
    id: 'bg_BG-dimitar-medium',
    label: 'Dimitar (Medium)',
    language: 'Bulgarian (Bulgaria)',
  },
  // Catalan (Spain)
  {
    id: 'ca_ES-upc_ona-x_low',
    label: 'Upc Ona (Extra Low)',
    language: 'Catalan (Spain)',
  },
  {
    id: 'ca_ES-upc_ona-medium',
    label: 'Upc Ona (Medium)',
    language: 'Catalan (Spain)',
  },
  {
    id: 'ca_ES-upc_pau-x_low',
    label: 'Upc Pau (Extra Low)',
    language: 'Catalan (Spain)',
  },
  // Chinese (China)
  {
    id: 'zh_CN-chaowen-medium',
    label: 'Chaowen (Medium)',
    language: 'Chinese (China)',
  },
  {
    id: 'zh_CN-huayan-x_low',
    label: 'Huayan (Extra Low)',
    language: 'Chinese (China)',
  },
  {
    id: 'zh_CN-huayan-medium',
    label: 'Huayan (Medium)',
    language: 'Chinese (China)',
  },
  {
    id: 'zh_CN-xiao_ya-medium',
    label: 'Xiao Ya (Medium)',
    language: 'Chinese (China)',
  },
  // Czech (Czech Republic)
  {
    id: 'cs_CZ-jirka-low',
    label: 'Jirka (Low)',
    language: 'Czech (Czech Republic)',
  },
  {
    id: 'cs_CZ-jirka-medium',
    label: 'Jirka (Medium)',
    language: 'Czech (Czech Republic)',
  },
  // Danish (Denmark)
  {
    id: 'da_DK-talesyntese-medium',
    label: 'Talesyntese (Medium)',
    language: 'Danish (Denmark)',
  },
  // Dutch (Belgium)
  {
    id: 'nl_BE-nathalie-x_low',
    label: 'Nathalie (Extra Low)',
    language: 'Dutch (Belgium)',
  },
  {
    id: 'nl_BE-nathalie-medium',
    label: 'Nathalie (Medium)',
    language: 'Dutch (Belgium)',
  },
  {
    id: 'nl_BE-rdh-x_low',
    label: 'Rdh (Extra Low)',
    language: 'Dutch (Belgium)',
  },
  {
    id: 'nl_BE-rdh-medium',
    label: 'Rdh (Medium)',
    language: 'Dutch (Belgium)',
  },
  // Dutch (Netherlands)
  {
    id: 'nl_NL-alex-medium',
    label: 'Alex (Medium)',
    language: 'Dutch (Netherlands)',
  },
  {
    id: 'nl_NL-mls-medium',
    label: 'Mls (Medium)',
    language: 'Dutch (Netherlands)',
  },
  {
    id: 'nl_NL-mls_5809-low',
    label: 'Mls 5809 (Low)',
    language: 'Dutch (Netherlands)',
  },
  {
    id: 'nl_NL-mls_7432-low',
    label: 'Mls 7432 (Low)',
    language: 'Dutch (Netherlands)',
  },
  {
    id: 'nl_NL-pim-medium',
    label: 'Pim (Medium)',
    language: 'Dutch (Netherlands)',
  },
  {
    id: 'nl_NL-ronnie-medium',
    label: 'Ronnie (Medium)',
    language: 'Dutch (Netherlands)',
  },
  // Farsi (Iran)
  { id: 'fa_IR-amir-medium', label: 'Amir (Medium)', language: 'Farsi (Iran)' },
  {
    id: 'fa_IR-ganji-medium',
    label: 'Ganji (Medium)',
    language: 'Farsi (Iran)',
  },
  {
    id: 'fa_IR-ganji_adabi-medium',
    label: 'Ganji Adabi (Medium)',
    language: 'Farsi (Iran)',
  },
  { id: 'fa_IR-gyro-medium', label: 'Gyro (Medium)', language: 'Farsi (Iran)' },
  {
    id: 'fa_IR-reza_ibrahim-medium',
    label: 'Reza Ibrahim (Medium)',
    language: 'Farsi (Iran)',
  },
  // Finnish (Finland)
  {
    id: 'fi_FI-harri-low',
    label: 'Harri (Low)',
    language: 'Finnish (Finland)',
  },
  {
    id: 'fi_FI-harri-medium',
    label: 'Harri (Medium)',
    language: 'Finnish (Finland)',
  },
  // French (France)
  {
    id: 'fr_FR-gilles-low',
    label: 'Gilles (Low)',
    language: 'French (France)',
  },
  {
    id: 'fr_FR-mls-medium',
    label: 'Mls (Medium)',
    language: 'French (France)',
  },
  {
    id: 'fr_FR-mls_1840-low',
    label: 'Mls 1840 (Low)',
    language: 'French (France)',
  },
  { id: 'fr_FR-siwis-low', label: 'Siwis (Low)', language: 'French (France)' },
  {
    id: 'fr_FR-siwis-medium',
    label: 'Siwis (Medium)',
    language: 'French (France)',
  },
  {
    id: 'fr_FR-tom-medium',
    label: 'Tom (Medium)',
    language: 'French (France)',
  },
  {
    id: 'fr_FR-upmc-medium',
    label: 'Upmc (Medium)',
    language: 'French (France)',
  },
  // Georgian (Georgia)
  {
    id: 'ka_GE-natia-medium',
    label: 'Natia (Medium)',
    language: 'Georgian (Georgia)',
  },
  // German (Germany)
  {
    id: 'de_DE-eva_k-x_low',
    label: 'Eva K (Extra Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-karlsson-low',
    label: 'Karlsson (Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-kerstin-low',
    label: 'Kerstin (Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-mls-medium',
    label: 'Mls (Medium)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-pavoque-low',
    label: 'Pavoque (Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-ramona-low',
    label: 'Ramona (Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-thorsten-low',
    label: 'Thorsten (Low)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-thorsten-medium',
    label: 'Thorsten (Medium)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-thorsten-high',
    label: 'Thorsten (High)',
    language: 'German (Germany)',
  },
  {
    id: 'de_DE-thorsten_emotional-medium',
    label: 'Thorsten Emotional (Medium)',
    language: 'German (Germany)',
  },
  // Greek (Greece)
  { id: 'el_GR-joy-medium', label: 'Joy (Medium)', language: 'Greek (Greece)' },
  {
    id: 'el_GR-rapunzelina-low',
    label: 'Rapunzelina (Low)',
    language: 'Greek (Greece)',
  },
  {
    id: 'el_GR-rapunzelina-medium',
    label: 'Rapunzelina (Medium)',
    language: 'Greek (Greece)',
  },
  // Hindi (India)
  {
    id: 'hi_IN-pratham-medium',
    label: 'Pratham (Medium)',
    language: 'Hindi (India)',
  },
  {
    id: 'hi_IN-priyamvada-medium',
    label: 'Priyamvada (Medium)',
    language: 'Hindi (India)',
  },
  {
    id: 'hi_IN-rohan-medium',
    label: 'Rohan (Medium)',
    language: 'Hindi (India)',
  },
  // Hungarian (Hungary)
  {
    id: 'hu_HU-anna-medium',
    label: 'Anna (Medium)',
    language: 'Hungarian (Hungary)',
  },
  {
    id: 'hu_HU-berta-medium',
    label: 'Berta (Medium)',
    language: 'Hungarian (Hungary)',
  },
  {
    id: 'hu_HU-imre-medium',
    label: 'Imre (Medium)',
    language: 'Hungarian (Hungary)',
  },
  // Icelandic (Iceland)
  {
    id: 'is_IS-bui-medium',
    label: 'Bui (Medium)',
    language: 'Icelandic (Iceland)',
  },
  {
    id: 'is_IS-salka-medium',
    label: 'Salka (Medium)',
    language: 'Icelandic (Iceland)',
  },
  {
    id: 'is_IS-steinn-medium',
    label: 'Steinn (Medium)',
    language: 'Icelandic (Iceland)',
  },
  {
    id: 'is_IS-ugla-medium',
    label: 'Ugla (Medium)',
    language: 'Icelandic (Iceland)',
  },
  // Indonesian (Indonesia)
  {
    id: 'id_ID-news_tts-medium',
    label: 'News Tts (Medium)',
    language: 'Indonesian (Indonesia)',
  },
  // Italian (Italy)
  {
    id: 'it_IT-paola-medium',
    label: 'Paola (Medium)',
    language: 'Italian (Italy)',
  },
  {
    id: 'it_IT-riccardo-x_low',
    label: 'Riccardo (Extra Low)',
    language: 'Italian (Italy)',
  },
  // Kazakh (Kazakhstan)
  {
    id: 'kk_KZ-iseke-x_low',
    label: 'Iseke (Extra Low)',
    language: 'Kazakh (Kazakhstan)',
  },
  {
    id: 'kk_KZ-issai-high',
    label: 'Issai (High)',
    language: 'Kazakh (Kazakhstan)',
  },
  {
    id: 'kk_KZ-raya-x_low',
    label: 'Raya (Extra Low)',
    language: 'Kazakh (Kazakhstan)',
  },
  // Kurmanji Kurdish (Turkey)
  {
    id: 'ku_TR-berfin_renas-medium',
    label: 'Berfin Renas (Medium)',
    language: 'Kurmanji Kurdish (Turkey)',
  },
  // Latvian (Latvia)
  {
    id: 'lv_LV-aivars-medium',
    label: 'Aivars (Medium)',
    language: 'Latvian (Latvia)',
  },
  // Luxembourgish (Luxembourg)
  {
    id: 'lb_LU-marylux-medium',
    label: 'Marylux (Medium)',
    language: 'Luxembourgish (Luxembourg)',
  },
  // Malayalam (India)
  {
    id: 'ml_IN-arjun-medium',
    label: 'Arjun (Medium)',
    language: 'Malayalam (India)',
  },
  {
    id: 'ml_IN-meera-medium',
    label: 'Meera (Medium)',
    language: 'Malayalam (India)',
  },
  // Nepali (Nepal)
  {
    id: 'ne_NP-chitwan-medium',
    label: 'Chitwan (Medium)',
    language: 'Nepali (Nepal)',
  },
  {
    id: 'ne_NP-google-x_low',
    label: 'Google (Extra Low)',
    language: 'Nepali (Nepal)',
  },
  {
    id: 'ne_NP-google-medium',
    label: 'Google (Medium)',
    language: 'Nepali (Nepal)',
  },
  // Norwegian (Norway)
  {
    id: 'no_NO-nvcc-medium',
    label: 'Nvcc (Medium)',
    language: 'Norwegian (Norway)',
  },
  {
    id: 'no_NO-talesyntese-medium',
    label: 'Talesyntese (Medium)',
    language: 'Norwegian (Norway)',
  },
  // Polish (Poland)
  { id: 'pl_PL-bass-high', label: 'Bass (High)', language: 'Polish (Poland)' },
  {
    id: 'pl_PL-darkman-medium',
    label: 'Darkman (Medium)',
    language: 'Polish (Poland)',
  },
  {
    id: 'pl_PL-gosia-medium',
    label: 'Gosia (Medium)',
    language: 'Polish (Poland)',
  },
  {
    id: 'pl_PL-mc_speech-medium',
    label: 'Mc Speech (Medium)',
    language: 'Polish (Poland)',
  },
  {
    id: 'pl_PL-mls_6892-low',
    label: 'Mls 6892 (Low)',
    language: 'Polish (Poland)',
  },
  // Portuguese (Brazil)
  {
    id: 'pt_BR-cadu-medium',
    label: 'Cadu (Medium)',
    language: 'Portuguese (Brazil)',
  },
  {
    id: 'pt_BR-edresson-low',
    label: 'Edresson (Low)',
    language: 'Portuguese (Brazil)',
  },
  {
    id: 'pt_BR-faber-medium',
    label: 'Faber (Medium)',
    language: 'Portuguese (Brazil)',
  },
  {
    id: 'pt_BR-jeff-medium',
    label: 'Jeff (Medium)',
    language: 'Portuguese (Brazil)',
  },
  // Portuguese (Portugal)
  {
    id: 'pt_PT-tugão-medium',
    label: 'Tugão (Medium)',
    language: 'Portuguese (Portugal)',
  },
  // Romanian (Romania)
  {
    id: 'ro_RO-mihai-medium',
    label: 'Mihai (Medium)',
    language: 'Romanian (Romania)',
  },
  // Russian (Russia)
  {
    id: 'ru_RU-denis-medium',
    label: 'Denis (Medium)',
    language: 'Russian (Russia)',
  },
  {
    id: 'ru_RU-dmitri-medium',
    label: 'Dmitri (Medium)',
    language: 'Russian (Russia)',
  },
  {
    id: 'ru_RU-irina-medium',
    label: 'Irina (Medium)',
    language: 'Russian (Russia)',
  },
  {
    id: 'ru_RU-ruslan-medium',
    label: 'Ruslan (Medium)',
    language: 'Russian (Russia)',
  },
  // Serbian (Serbia)
  {
    id: 'sr_RS-serbski_institut-medium',
    label: 'Serbski Institut (Medium)',
    language: 'Serbian (Serbia)',
  },
  // Slovak (Slovakia)
  {
    id: 'sk_SK-lili-medium',
    label: 'Lili (Medium)',
    language: 'Slovak (Slovakia)',
  },
  // Slovenian (Slovenia)
  {
    id: 'sl_SI-artur-medium',
    label: 'Artur (Medium)',
    language: 'Slovenian (Slovenia)',
  },
  // Spanish (Argentina)
  {
    id: 'es_AR-daniela-high',
    label: 'Daniela (High)',
    language: 'Spanish (Argentina)',
  },
  // Spanish (Mexico)
  {
    id: 'es_MX-ald-x_low',
    label: 'Ald (Extra Low)',
    language: 'Spanish (Mexico)',
  },
  {
    id: 'es_MX-ald-medium',
    label: 'Ald (Medium)',
    language: 'Spanish (Mexico)',
  },
  {
    id: 'es_MX-claude-high',
    label: 'Claude (High)',
    language: 'Spanish (Mexico)',
  },
  // Spanish (Spain)
  {
    id: 'es_ES-carlfm-x_low',
    label: 'Carlfm (Extra Low)',
    language: 'Spanish (Spain)',
  },
  {
    id: 'es_ES-davefx-medium',
    label: 'Davefx (Medium)',
    language: 'Spanish (Spain)',
  },
  {
    id: 'es_ES-mls_10246-low',
    label: 'Mls 10246 (Low)',
    language: 'Spanish (Spain)',
  },
  {
    id: 'es_ES-mls_9972-low',
    label: 'Mls 9972 (Low)',
    language: 'Spanish (Spain)',
  },
  {
    id: 'es_ES-sharvard-medium',
    label: 'Sharvard (Medium)',
    language: 'Spanish (Spain)',
  },
  // Swahili (Democratic Republic of the Congo)
  {
    id: 'sw_CD-lanfrica-medium',
    label: 'Lanfrica (Medium)',
    language: 'Swahili (Democratic Republic of the Congo)',
  },
  // Swedish (Sweden)
  {
    id: 'sv_SE-alma-medium',
    label: 'Alma (Medium)',
    language: 'Swedish (Sweden)',
  },
  {
    id: 'sv_SE-lisa-medium',
    label: 'Lisa (Medium)',
    language: 'Swedish (Sweden)',
  },
  {
    id: 'sv_SE-nst-medium',
    label: 'Nst (Medium)',
    language: 'Swedish (Sweden)',
  },
  // Telugu (India)
  {
    id: 'te_IN-maya-medium',
    label: 'Maya (Medium)',
    language: 'Telugu (India)',
  },
  {
    id: 'te_IN-padmavathi-medium',
    label: 'Padmavathi (Medium)',
    language: 'Telugu (India)',
  },
  {
    id: 'te_IN-venkatesh-medium',
    label: 'Venkatesh (Medium)',
    language: 'Telugu (India)',
  },
  // Turkish (Turkey)
  {
    id: 'tr_TR-dfki-medium',
    label: 'Dfki (Medium)',
    language: 'Turkish (Turkey)',
  },
  // Ukrainian (Ukraine)
  {
    id: 'uk_UA-lada-x_low',
    label: 'Lada (Extra Low)',
    language: 'Ukrainian (Ukraine)',
  },
  {
    id: 'uk_UA-mykyta-high',
    label: 'Mykyta (High)',
    language: 'Ukrainian (Ukraine)',
  },
  {
    id: 'uk_UA-oleksa-high',
    label: 'Oleksa (High)',
    language: 'Ukrainian (Ukraine)',
  },
  {
    id: 'uk_UA-tetiana-high',
    label: 'Tetiana (High)',
    language: 'Ukrainian (Ukraine)',
  },
  {
    id: 'uk_UA-ukrainian_tts-medium',
    label: 'Ukrainian Tts (Medium)',
    language: 'Ukrainian (Ukraine)',
  },
  // Urdu (Pakistan)
  {
    id: 'ur_PK-fasih-medium',
    label: 'Fasih (Medium)',
    language: 'Urdu (Pakistan)',
  },
  // Vietnamese (Vietnam)
  {
    id: 'vi_VN-25hours_single-low',
    label: '25hours Single (Low)',
    language: 'Vietnamese (Vietnam)',
  },
  {
    id: 'vi_VN-vais1000-medium',
    label: 'Vais1000 (Medium)',
    language: 'Vietnamese (Vietnam)',
  },
  {
    id: 'vi_VN-vivos-x_low',
    label: 'Vivos (Extra Low)',
    language: 'Vietnamese (Vietnam)',
  },
  // Welsh (Great Britain)
  {
    id: 'cy_GB-bu_tts-medium',
    label: 'Bu Tts (Medium)',
    language: 'Welsh (Great Britain)',
  },
  {
    id: 'cy_GB-gwryw_gogleddol-medium',
    label: 'Gwryw Gogleddol (Medium)',
    language: 'Welsh (Great Britain)',
  },
]

export function getVoicesForModel(model: string): VoiceInfo[] {
  if (model === 'malaya') return MALAYA_VOICES
  if (model === 'piper') return PIPER_VOICES
  return KOKORO_VOICES
}

export function getLanguagesForModel(
  model: string,
): { value: string; label: string }[] {
  const voices = getVoicesForModel(model)
  const seen = new Set<string>()
  const result: { value: string; label: string }[] = []
  for (const v of voices) {
    if (!seen.has(v.language)) {
      seen.add(v.language)
      result.push({ value: v.language, label: v.language })
    }
  }
  return result
}

export const ttsConfig: ServiceConfig = {
  availableModels: [
    {
      value: 'kokoro',
      label: 'Kokoro (Multilingual, OpenVINO)',
      availableDevices: ['CPU', 'NPU'],
      backend: 'openvino',
    },
    {
      value: 'malaya',
      label: 'Malaya (Malay, VITS)',
      availableDevices: ['CPU', 'XPU'],
      backend: 'pytorch',
    },
    {
      value: 'piper',
      label: 'Piper (Multilingual, OpenVINO)',
      availableDevices: ['CPU', 'GPU'],
      backend: 'openvino',
    },
  ],
}
