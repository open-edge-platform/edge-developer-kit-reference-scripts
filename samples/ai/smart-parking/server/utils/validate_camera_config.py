# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import json


class ConfigException(Exception):
    pass


def read_model_proc(model_proc_path):
    """
    Read model proc file and sanitize it
    """
    if not os.path.isfile(model_proc_path):
        raise ConfigException(f'Model Proc file not found: {model_proc_path}')
    with open(model_proc_path, 'r') as proc:
        try:
            proc_data = json.loads(proc.read())
        except json.decoder.JSONDecodeError as err:
            raise ConfigException(f'Invalid model proc file. Error: {err} ')
    keys = ["json_schema_version", "input_preproc", "output_postproc"]
    for key in keys:
        if key not in proc_data.keys():
            raise ConfigException(f'Invalid model proc file. Key  `{key}` not found.')
    return proc_data


def read_config(config_path):
    """
    Read configuration file and sanitize it
    """
    if not os.path.isfile(config_path):
        raise ConfigException(f'Config file not found: {config_path}')
    with open(config_path, 'r') as conf:
        try:
            conf_data = json.loads(conf.read())
            num_ch = len(conf_data['cameras'])
        except json.decoder.JSONDecodeError as err:
            raise ConfigException(f'Invalid config file. Error: {err} ')
        except KeyError:
            raise ConfigException(f'Invalid config file. Key `cameras` is missing')
    if num_ch == 0:
        raise ConfigException(f'Config file is empty')
    compatible_devices = ['CPU', 'GPU', 'GPU.0', 'GPU.1', 'HDDL', 'MYRIAD']
    required_keys = ['address', 'latitude', 'longitude', 'analytics', 'device', 'path', 'bboxes']
    given_devices = []
    for cam_detail in conf_data['cameras']:
        for key in cam_detail.keys():
            if key not in required_keys:
                raise ConfigException(f'Invalid key `{key}` in config file.')
        if not "".join(cam_detail['address'].split("_")).isalnum():
            raise ConfigException(f'Invalid address value in config file: `{cam_detail["address"]}`'
                                  f'\nDebug: Address must be a non-empty alpha numeric string.')
        # if not isinstance(cam_detail['latitude'], float) or not isinstance(cam_detail['longitude'], float):
        #     raise ConfigException(f'Invalid latitide/longitude in config file. '
        #                           f'Latitude/longitude should be of type float.')
        if not ('pedestrian' in cam_detail['analytics'] or 'vehicle' in cam_detail['analytics'] or
           'bike' in cam_detail['analytics']) or not "".join(cam_detail['analytics'].split()).isalnum():
            raise ConfigException(f'Invalid analytics in config file. '
                                  f'Possible values can be any combination of '
                                  f'`pdestrian`, `vehicle` or `bike` seperateed by space')
        if not cam_detail['device'] in compatible_devices and cam_detail['device'][:6] == 'MULTI:':
            multi_devices = cam_detail['device'][6:].split(',')
            if list(filter(lambda x: x not in compatible_devices, multi_devices)):
                raise ConfigException(f'Invalid device in config file. '
                                      f'Possible devices are - {" ".join(compatible_devices)}')
            given_devices.extend(multi_devices)
        elif cam_detail['device'] in compatible_devices:
            given_devices.append(cam_detail['device'])
        else:
            raise ConfigException(f'Invalid device in config file - `{cam_detail["device"]}`. '
                                  f'Possible devices are - {" ".join(compatible_devices)}')
        if "://" not in cam_detail['path']:
            if not os.path.exists(cam_detail['path']):
                raise ConfigException(f'Source path `{cam_detail["path"]}` does not exists. Check config file.')
            elif "/dev/video" not in cam_detail['path'] and \
               cam_detail['path'].split('.')[-1] not in ['mp4', 'mov', 'avi', 'wmv', 'mkv', 'webm', 'flv']:
                raise ConfigException(f'Source path `{cam_detail["path"]}` is not a valid video file. Check config file.')
        if "://" not in cam_detail['bboxes']:
            if not os.path.exists(cam_detail['bboxes']):
                raise ConfigException(f'Source path `{cam_detail["bboxes"]}` does not exists. Check config file.')
    return num_ch, conf_data, list(set(given_devices))
