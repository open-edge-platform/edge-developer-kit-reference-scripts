#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# Old name of upstream-setup.sh (its catalogue, oep-services.json, is now upstream.json): the
# catalogue lists plain git sources as well as OEP microservices. Kept so commands and branches
# written before the rename keep working; delete once nothing calls it.

echo "NOTE: oep-setup.sh is now upstream-setup.sh." >&2
exec "$(dirname "${BASH_SOURCE[0]}")/upstream-setup.sh" "$@"
