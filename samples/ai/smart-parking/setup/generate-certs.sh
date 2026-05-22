#!/bin/bash

# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

HOME_DIR=$PWD

echo "Removing old certs"
rm -rf "$HOME_DIR"/data

echo "Generating self-signed certs."
mkdir -p "$HOME_DIR"/data/certs
cd "$HOME_DIR"/data/certs || exit

openssl genrsa -out smart-parking-key.pem 2048
openssl req -new -key smart-parking-key.pem -out smart-parking-csr.csr -subj "/C=US/ST=CA/L=SmartParking/O=Intel/OU=IT/CN=intel.com/emailAddress=intel@intel.com"
openssl x509 -req -days 365 -in smart-parking-csr.csr -signkey smart-parking-key.pem -out smart-parking.pem
openssl x509 -req -days 365 -in smart-parking-csr.csr -signkey smart-parking-key.pem -out smart-parking.crt 
