# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

from ui import build
from config import PORT

if __name__ == "__main__":
    build().queue(max_size=10).launch(debug=True, server_name="0.0.0.0", server_port=PORT)
