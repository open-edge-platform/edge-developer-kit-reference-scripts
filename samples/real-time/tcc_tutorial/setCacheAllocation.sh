#!/bin/bash
####################################################################################
# Copyright (C) <2024> Intel Corporation
#
# Redistribution and use in source and binary forms, with or without modification,
# are permitted provided that the following conditions are met:
#
# 1. Redistributions of source code must retain the above copyright notice,
#    this list of conditions and the following disclaimer.
# 2. Redistributions in binary form must reproduce the above copyright notice,
#    this list of conditions and the following disclaimer in the documentation
#    and/or other materials provided with the distribution.
# 3. Neither the name of the copyright holder nor the names of its contributors
#    may be used to endorse or promote products derived from this software
#    without specific prior written permission.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
# THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
# ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
# BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
# OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
# OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
# OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
# WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
# OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
# EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
#
# SPDX-License-Identifier: BSD-3-Clause
###################################################################################

# Function for real-time optimization for RT core 2
rt_optimized() {
    info
    #define LLC Core Masks
    wrmsr 0xc90 0xF0 # best effort
    wrmsr 0xc91 0x0f # real-time
    #define LLC GT Masks
    wrmsr 0x18b0 0x80
    wrmsr 0x18b1 0x80
    wrmsr 0x18b2 0x80
    wrmsr 0x18b3 0x80
    
    #assign the masks to the cores.
    #This has to match with the core selected in the rt app
    wrmsr -a 0xc8f 0x0
    wrmsr -p 3 0xc8f 0x100000000

    echo "Current LLC partitioning"
    echo "IA32_L3_Mask_0 for best effort cores"
    rdmsr 0xc90
    echo "IA32_L3_Mask_1 for real-time core 3"
    rdmsr 0xc91
}

# Function for Script 2
default() {
    info
    # reset LLC partitions entire LLC is shared by all avialable cores
    wrmsr 0xc90 0xff # best effort
    #reset LLC GT Masks
    wrmsr 0x18b0 0xff
    wrmsr 0x18b1 0xff
    wrmsr 0x18b2 0xff
    wrmsr 0x18b3 0xff
    #assign all cores to mask 0 
    wrmsr -a 0xc8f 0x0

    echo "Current LLC paratitioning"
    echo "IA32_L3_Mask_0 for all cores"
    rdmsr 0xc90
}

info() {
        #The script is tailored for the cache sizes of i5-1350PE
    echo "Number of supported LLC size"
    cat /sys/devices/system/cpu/cpu0/cache/index3/size
    echo "Number of supported LLC ways"
    cat /sys/devices/system/cpu/cpu0/cache/index3/ways_of_associativity
    echo ""
}

# Check the command-line parameter
if [ "$1" == "rt_optimized" ]; then
    rt_optimized
elif [ "$1" == "default" ]; then
    default
else
    echo "Usage: $0 {rt_optimized|default}"
    exit 1
fi