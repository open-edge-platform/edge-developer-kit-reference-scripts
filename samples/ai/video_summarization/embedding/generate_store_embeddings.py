# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sys
import os
from tqdm import tqdm
from pathlib import Path

# Add the parent directory of the current script to the Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
VECTORDB_SERVICE_HOST_IP = os.getenv("VECTORDB_SERVICE_HOST_IP", "127.0.0.1")


# sys.path.append(os.path.abspath('../utils'))
# import config_reader as reader
import yaml
import json
import os
import argparse
import torch
from embedding.meanclip_modeling.model import MeanCLIP
from embedding.meanclip_modeling.clip_model import CLIP
from utils import config_reader as reader
from embedding.extract_store_frames import process_all_videos
from embedding.vector_stores import db
from decord import VideoReader, cpu
import numpy as np
from PIL import Image
from embedding.meanclip_datasets.preprocess import get_transforms


def setup_meanclip_model(cfg, device):

    pretrained_state_dict = CLIP.get_config(pretrained_clip_name=cfg.clip_backbone)
    state_dict = {}
    epoch = 0
    print("Loading CLIP pretrained weights ...")
    for key, val in pretrained_state_dict.items():    
        new_key = "clip." + key
        if new_key not in state_dict:
            state_dict[new_key] = val.clone()

    if cfg.sim_header != "meanP":
        for key, val in pretrained_state_dict.items():
            # initialize for the frame and type postion embedding
            if key == "positional_embedding":
                state_dict["frame_position_embeddings.weight"] = val.clone()

            # using weight of first 4 layers for initialization
            if key.find("transformer.resblocks") == 0:
                num_layer = int(key.split(".")[2])

                # initialize the 4-layer temporal transformer
                if num_layer < 4:
                    state_dict[key.replace("transformer.", "transformerClip.")] = val.clone()
                    continue

                if num_layer == 4: # for 1-layer transformer sim_header
                    state_dict[key.replace(str(num_layer), "0")] = val.clone()

    model = MeanCLIP(cfg, pretrained_state_dict)
    missing_keys = []
    unexpected_keys = []
    error_msgs = []
    # copy state_dict so _load_from_state_dict can modify it
    metadata = getattr(state_dict, '_metadata', None)
    state_dict = state_dict.copy()
    if metadata is not None:
        state_dict._metadata = metadata

    def load(module, prefix=''):
        local_metadata = {} if metadata is None else metadata.get(prefix[:-1], {})
        module._load_from_state_dict(
            state_dict, prefix, local_metadata, True, missing_keys, unexpected_keys, error_msgs)
        for name, child in module._modules.items():
            if child is not None:
                load(child, prefix + name + '.')

    load(model, prefix='')

    if str(device) == "cpu":
        model.float()

    model.to(device)

    print("Setup model done!")
    return model, epoch

def read_json(path):
    with open(path) as f:
        x = json.load(f)
    return x

def read_file(path):
    content = None
    with open(path, 'r') as file:
        content = file.read()
    return content

def store_into_vectordb(vs, metadata_file_path, embedding_model, config):
    GMetadata = read_json(metadata_file_path)
    global_counter = 0

    total_videos = len(GMetadata.keys())
    
    for idx, (video, data) in enumerate(tqdm(GMetadata.items())):
        image_name_list = []
        embedding_list = []
        metadata_list = []
        ids = []
        
        if config['embeddings']['type'] == 'video':
            data['video'] = video
            video_name_list = [data["video_path"]]
            metadata_list = [data]
            if vs.selected_db == 'vdms':
                vs.video_db.add_videos(
                    paths=video_name_list,
                    metadatas=metadata_list,
                    start_time=[data['timestamp']],
                    clip_duration=[data['clip_duration']]
                )
            else:
                print(f"ERROR: selected_db {vs.selected_db} not supported. Supported:[vdms]")

    # clean up tmp_ folders containing frames (jpeg)
    for i in os.listdir():
        if i.startswith("tmp_"):
            print("removing tmp_*")
            os.system(f"rm -r tmp_*")
            print("done.")
            break

def generate_embeddings(config, embedding_model, vs):
    process_all_videos(config)
    global_metadata_file_path = os.path.join(config["meta_output_dir"], 'metadata.json')
    print(f'global metadata file available at {global_metadata_file_path}')
    store_into_vectordb(vs, global_metadata_file_path, embedding_model, config)

def retrieval_testing(vs):
    Q = 'Man holding red shopping basket'
    print (f'Testing Query: {Q}')
    top_k = 3
    results = vs.MultiModalRetrieval(Q, top_k=top_k)

    print(f"top-{top_k} returned results:", results)

def main():
    # read config yaml
    print ('Reading config file')
    # config = reader.read_config('../docs/config.yaml')

    # Create argument parser
    parser = argparse.ArgumentParser(description='Process configuration file for generating and storing embeddings.')
    parser.add_argument('--config_file', type=str, help='Path to configuration file (e.g., config.yaml)')

    # Parse command-line arguments
    args = parser.parse_args()
    # Read configuration file
    config_path = Path(args.config_file)
    config = reader.read_config(config_path.as_posix())
    # Read MeanCLIP
    meanclip_cfg_json = json.load(open(config['meanclip_cfg_path'], 'r'))
    meanclip_cfg = argparse.Namespace(**meanclip_cfg_json)


    print ('Config file data \n', yaml.dump(config, default_flow_style=False, sort_keys=False))

    generate_frames = config['generate_frames']
    #embed_frames = config['embed_frames']
    path = config['videos'] #args.videos_folder #
    meta_output_dir = config['meta_output_dir']
    emb_path = config['embeddings']['path']

    host = VECTORDB_SERVICE_HOST_IP
    port = int(config['vector_db']['port'])
    selected_db = config['vector_db']['choice_of_db']

    # Creating DB
    print ('Creating DB with video embedding and metadata support, \nIt may take few minutes to download and load all required models if you are running for first time.')
    print('Connecting to {} at {}:{}'.format(selected_db, host, port))

    if config['embeddings']['type'] == 'video':
        # init meanclip model
        model, _ = setup_meanclip_model(meanclip_cfg, device="cpu")
        vs = db.VideoVS(host, port, selected_db, model)
    else:
        print(f"ERROR: Selected embedding type in config.yaml {config['embeddings']['type']} is not in [\'video\', \'frame\']")
        return
    generate_embeddings(config, model, vs)
    retrieval_testing(vs)
    return vs

if __name__ == '__main__':
    main()
