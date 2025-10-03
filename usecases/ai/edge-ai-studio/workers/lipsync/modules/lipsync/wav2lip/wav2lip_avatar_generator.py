# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import numpy as np
import argparse
import cv2
import os
import pickle #nosec B403 -- creating a pickle file for storing coordinates
import yaml

from uuid import uuid4
from glob import glob
from tqdm import tqdm
from pathlib import Path

import sys

script_path = Path(__file__).parent.resolve()
sys.path.append(f"{script_path}/..")
sys.path.append(f"{script_path}/wav2lip256")

from wav2lip256.face_detection import FaceAlignment, LandmarksType

IMG_COMPRESSION_LEVEL = 5


def extractImagesFromVideo(video_path, save_path, frame_count=128):
    cap = cv2.VideoCapture(video_path)
    count = 0
    while count < frame_count:
        ret, frame = cap.read()
        if not ret:
            break
        filename = os.path.join(save_path, f"{count:08d}.png")
        cv2.imwrite(
            filename, frame, [cv2.IMWRITE_PNG_COMPRESSION, IMG_COMPRESSION_LEVEL]
        )
        count += 1
    cap.release()

    return save_path


def performFaceAlignment(full_images_path, batch_size, device, pads):
    sanitized_full_images_path = Path(full_images_path).resolve()
    full_images_list = sorted(
        glob(os.path.join(sanitized_full_images_path, "*.[jpJP][pnPN]*[gG]"))
    )

    full_frames = []
    for image_path in tqdm(full_images_list):
        frame = cv2.imread(image_path)
        full_frames.append(frame)

    detector = FaceAlignment(LandmarksType._2D, flip_input=False, device=device)

    predictions = []
    for i in tqdm(range(0, len(full_frames), batch_size)):
        predictions.extend(
            detector.get_detections_for_batch(np.array(full_frames[i : i + batch_size]))
        )

    results = []

    pady1, pady2, padx1, padx2 = pads

    for rect, image in zip(predictions, full_frames):
        if rect is None:
            cv2.imwrite(
                "temp/faulty_frame.jpg", image
            )  # check this frame where the face was not detected.
            raise ValueError(
                "Face not detected! Ensure the video contains a face in all the frames."
            )

        y1 = max(0, rect[1] - pady1)
        y2 = min(image.shape[0], rect[3] + pady2)
        x1 = max(0, rect[0] - padx1)
        x2 = min(image.shape[1], rect[2] + padx2)

        results.append([x1, y1, x2, y2])

    boxes = np.array(results)

    if not args.no_smooth:
        boxes = get_smoothened_boxes(boxes, T=5)

    results = [
        [image[y1:y2, x1:x2], (y1, y2, x1, x2)]
        for image, (x1, y1, x2, y2) in zip(full_frames, boxes)
    ]

    del detector

    return results


def generateCoordinates(aligned_faces, face_image_path, coords_path, img_size):
    coord_list = []
    idx = 0

    for frame, coords in aligned_faces:
        resized_crop_frame = cv2.resize(frame, (img_size, img_size))
        cv2.imwrite(
            f"{face_image_path}/{idx:08d}.png",
            resized_crop_frame,
            [cv2.IMWRITE_PNG_COMPRESSION, IMG_COMPRESSION_LEVEL],
        )
        coord_list.append(coords)
        idx += 1

    sanitized_coords_path = Path(coords_path).resolve()
    with open(sanitized_coords_path, "wb") as f:
        pickle.dump(coord_list, f)


def get_smoothened_boxes(boxes, T):
    for i in range(len(boxes)):
        if i + T > len(boxes):
            window = boxes[len(boxes) - T :]
        else:
            window = boxes[i : i + T]
        boxes[i] = np.mean(window, axis=0)

    return boxes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Inference code to lip-sync videos in the wild using Wav2Lip models"
    )
    parser.add_argument("--video_path", default="", type=str)
    parser.add_argument("--frame_count", default=128, type=int)
    parser.add_argument("--device", default="xpu", type=str)
    parser.add_argument("--img_size", default=256, type=int)
    parser.add_argument("--batch_size", default=1, type=int)
    parser.add_argument("--avatar_id", default=None, type=str)
    parser.add_argument("--no_smooth", action="store_true")
    parser.add_argument(
        "--pads",
        nargs="+",
        type=int,
        default=[0, 0, 0, 0],
        help="Padding (top, bottom, left, right). Please adjust to include chin at least",
    )

    args = parser.parse_args()

    if args.avatar_id == None:
        args.avatar_id = f"wav2lip_avatar_{args.img_size}"
    else:
        args.avatar_id = f"wav2lip_avatar{args.avatar_id}_{args.img_size}"

    avatar_path = f"./data/avatars/{args.avatar_id}"
    full_image_path = f"{avatar_path}/full_images"
    face_image_path = f"{avatar_path}/face_images"
    coords_path = f"{avatar_path}/coords.pkl"

    Path(avatar_path).mkdir(parents=True, exist_ok=True)
    Path(full_image_path).mkdir(parents=True, exist_ok=True)
    Path(face_image_path).mkdir(parents=True, exist_ok=True)

    print(f"Extracting Images from Video")
    extractImagesFromVideo(args.video_path, full_image_path, args.frame_count)
    aligned_faces = performFaceAlignment(
        full_image_path, args.batch_size, args.device, args.pads
    )
    generateCoordinates(aligned_faces, face_image_path, coords_path, args.img_size)

    with open("config.wav2lip.yaml") as rfile:
        configs = yaml.safe_load(rfile)
    configs["wav2lip"]["avatar_path"] = f"./data/avatars/{args.avatar_id}"
    with open("config.wav2lip.yaml", "w") as wfile:
        yaml.dump(configs, wfile, default_flow_style=False, sort_keys=False)

    print(f"Avatar with Id: {args.avatar_id} is generated successfully")
