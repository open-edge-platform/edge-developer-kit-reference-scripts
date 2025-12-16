# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import cv2
import math
import numpy as np

def create_dynamic_grid(images: list[np.ndarray], max_cols: int = 2) -> np.ndarray:
    num_images = len(images)
    
    if num_images == 0:
        return None
    
    num_cols = min(num_images, max_cols)
    num_rows = math.ceil(num_images / num_cols)
    h, w, c = images[0].shape
    blank_img = np.zeros((h, w, c), dtype=images[0].dtype)

    num_blanks = (num_rows * num_cols) - num_images
    padded_images = images + [blank_img] * num_blanks
    
    concatenated_rows = []
    
    for i in range(num_rows):
        start_index = i * num_cols
        end_index = (i + 1) * num_cols
        row_images = padded_images[start_index:end_index]
    
        current_row = cv2.hconcat(row_images)
        concatenated_rows.append(current_row)

    final_grid = cv2.vconcat(concatenated_rows)
    
    return final_grid