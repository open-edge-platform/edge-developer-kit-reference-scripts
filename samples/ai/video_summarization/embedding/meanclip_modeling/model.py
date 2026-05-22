# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import torch
import torch.nn as nn
import torch.nn.functional as F

from einops import rearrange
from embedding.meanclip_modeling.transformer import LayerNorm
from embedding.meanclip_modeling.clip_model import build_model

class MeanCLIP(nn.Module):
    def __init__(self, cfg, clip_state_dict):
        super().__init__()

        self.num_frm = cfg.num_frm
        self.sim_header = cfg.sim_header
        self.frame_agg = cfg.frame_agg


        self.clip = build_model(clip_state_dict)

        self.initializer_range = 0.02
        self.apply(self.init_weights)

    def init_weights(self, module):
        """ Initialize the weights.
        """
        if isinstance(module, (nn.Linear, nn.Embedding)):
            # Slightly different from the TF version which uses truncated_normal for initialization
            # cf https://github.com/pytorch/pytorch/pull/5617
            module.weight.data.normal_(mean=0.0, std=self.initializer_range)
        elif isinstance(module, LayerNorm):
            if "beta" in dir(module) and "gamma" in dir(module):
                module.beta.data.zero_()
                module.gamma.data.fill_(1.0)
            else:
                module.bias.data.zero_()
                module.weight.data.fill_(1.0)
        if isinstance(module, nn.Linear) and module.bias is not None:
            module.bias.data.zero_()

    def get_video_embeddings(self, clip_inputs):
        """
        clip_inputs: (B, num_frm, C, H, W)
        """
        frame_embd = self.get_visual_output(clip_inputs)
        # get video embeddings
        frame_embd = frame_embd / frame_embd.norm(dim=-1, keepdim=True) 
        video_embd = frame_embd.mean(dim=1)
        video_embd = video_embd / video_embd.norm(dim=-1, keepdim=True)
        return video_embd

    def get_text_output(self, text_input_ids, return_hidden=False):
        b = text_input_ids.shape[0]
        text_input_ids = rearrange(text_input_ids, "b n l -> (b n) l")
        text_embd, word_embd = self.clip.encode_text(text_input_ids, return_hidden)
        text_embd = rearrange(text_embd, "(b n) d -> b n d", b=b).float()
        if return_hidden:
            word_embd = rearrange(word_embd, "(b n) l d -> b n l d", b=b).float()
        return text_embd, word_embd

    def get_visual_output(self, visual_inputs):
        b = visual_inputs.shape[0]
        visual_inputs = rearrange(visual_inputs, "b n c h w -> (b n) c h w")
        frame_embd = self.clip.encode_image(visual_inputs).float()
        frame_embd = rearrange(frame_embd, "(b n) d -> b n d", b=b)
        return frame_embd

