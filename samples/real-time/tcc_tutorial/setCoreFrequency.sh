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

# Function for basefrequency
basefrequency() {
    # Iterate through all CPU directories
    for cpu_dir in /sys/devices/system/cpu/cpu*/cpufreq; 
    do
        cpu_id=$(basename "$(dirname "$cpu_dir")" | sed 's/cpu//')

        # Check if the cpuinfo_min_freq file exists
        if [ -f "$cpu_dir/cpuinfo_min_freq" ]; then
            # Read the cpuinfo_min_freq value
            min_freq=$(cat "$cpu_dir/cpuinfo_min_freq")
            
            # Write the cpuinfo_min_freq value to scaling_min_freq
            sudo bash -c "echo $min_freq > $cpu_dir/scaling_min_freq"
        else
            echo "cpuinfo_min_freq file not found in $cpu_dir"
        fi

        # Check if the base_frequency file exists
        if [ -f "$cpu_dir/base_frequency" ]; then
            # Read the base frequency value
            base_freq=$(cat "$cpu_dir/base_frequency")
            
            # Write the base frequency value to scaling_max_freq
            sudo bash -c "echo $base_freq > $cpu_dir/scaling_max_freq"
            # Write the base frequency value to scaling_min_freq
            sudo bash -c "echo $base_freq > $cpu_dir/scaling_min_freq"
        else
            echo "base_frequency file not found in $cpu_dir"
        fi

        # Check if the energy_performance_preference file exists
        if [ -f "$cpu_dir/energy_performance_preference" ]; then
            # Set energy_performance_preference to "performance" by default
            sudo bash -c "echo performance > $cpu_dir/energy_performance_preference"
        else
            echo "energy_performance_preference file not found in $cpu_dir"
        fi

        echo "Set CPU $cpu_id to power mode with min freq $min_freq and max freq $base_freq"
    done
}

# Function for rt-boost
rt_boost() {
    local selected_cpus=("$@")
    local desired_min_freq=${selected_cpus[-2]}
    local desired_max_freq=${selected_cpus[-1]}
    unset "selected_cpus[-1]"
    unset "selected_cpus[-1]"

    # Iterate through all CPU directories
    for cpu_dir in /sys/devices/system/cpu/cpu*/cpufreq; 
    do
        cpu_id=$(basename "$(dirname "$cpu_dir")" | sed 's/cpu//')

        # Check if the current CPU is in the selected CPUs list
        cpu_selected=false
        for selected_cpu in "${selected_cpus[@]}"; do
            if [ "$selected_cpu" == "$cpu_id" ]; then
                cpu_selected=true
                break
            fi
        done

        if [ "$cpu_selected" == true ]; then
            # Set energy_performance_preference to "performance"
            sudo bash -c "echo performance > $cpu_dir/energy_performance_preference"
        
            # Set scaling_min_freq and scaling_max_freq to the desired values
            sudo bash -c "echo $desired_min_freq > $cpu_dir/scaling_min_freq"
            sudo bash -c "echo $desired_max_freq > $cpu_dir/scaling_max_freq"
        
            echo "Set CPU $cpu_id to performance mode with min freq $desired_min_freq and max freq $desired_max_freq"
        else
            # Check if the cpuinfo_min_freq file exists
            if [ -f "$cpu_dir/cpuinfo_min_freq" ]; then
                # Read the cpuinfo_min_freq value
                min_freq=$(cat "$cpu_dir/cpuinfo_min_freq")
                
                # Write the cpuinfo_min_freq value to scaling_min_freq
                sudo bash -c "echo $min_freq > $cpu_dir/scaling_min_freq"
            else
                echo "cpuinfo_min_freq file not found in $cpu_dir"
            fi

            # Check if the base_frequency file exists
            if [ -f "$cpu_dir/base_frequency" ]; then
                # Read the base frequency value
                base_freq=$(cat "$cpu_dir/base_frequency")
                
                # Write the base frequency value to scaling_max_freq
                sudo bash -c "echo $base_freq > $cpu_dir/scaling_max_freq"
            else
                echo "base_frequency file not found in $cpu_dir"
            fi

            # Check if the energy_performance_preference file exists
            if [ -f "$cpu_dir/energy_performance_preference" ]; then
                # Set energy_performance_preference to "power" by default
                sudo bash -c "echo balance_power > $cpu_dir/energy_performance_preference"
            else
                echo "energy_performance_preference file not found in $cpu_dir"
            fi

            echo "Set CPU $cpu_id to power mode with min freq $min_freq and max freq $base_freq"
        fi
    done
}

# Main script logic
if [ "$1" == "basefrequency" ]; then
    basefrequency
elif [ "$1" == "rt-boost" ]; then
    if [ $# -lt 4 ]; then
        echo "Usage: $0 rt-boost <cpu_list> <min_freq> <max_freq>"
        echo "Example: $0 rt-boost '0 2' 2000000 3000000"
        exit 1
    fi
    IFS=' ' read -r -a selected_cpus <<< "$2"
    selected_cpus+=("$3" "$4")
    rt_boost "${selected_cpus[@]}"
else
    echo "Usage: $0 {basefrequency|rt-boost}"
    exit 1
fi