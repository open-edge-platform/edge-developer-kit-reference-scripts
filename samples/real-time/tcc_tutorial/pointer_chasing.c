/*******************************************************************************
Copyright (C) <2024> Intel Corporation

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


SPDX-License-Identifier: BSD-3-Clause
*******************************************************************************/
#include "pointer_chasing.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>

#define CACHE_LINE_SIZE 64     // Size of a cache line in bytes
#define MINIMAL_NODE_NUMBER 6  // Required for pointer_chase_run_read_write_workload

/**
 * @brief Pointer-chase list node. The size of a node is equal to the size of one cache line.
 *
 */
struct cache_line_node_t
{
    union
    {
        uint8_t buf[CACHE_LINE_SIZE];
        struct
        {
            cache_line_node_t* next;
            cache_line_node_t* prev;
        };
    };
};

static cache_line_node_t* pointer_chasing_init_linear(cache_line_node_t* nodes, size_t n_nodes)
{
    for (size_t i = 0; i < n_nodes; i++) {
        size_t next_id = (n_nodes + i + 1) % n_nodes;
        size_t prev_id = (n_nodes + i - 1) % n_nodes;
        nodes[i].prev = &(nodes[prev_id]);
        nodes[i].next = &(nodes[next_id]);
    }
    return nodes;
}

static inline void pointer_chasing_swap_lines_far(cache_line_node_t* node1, cache_line_node_t* node2)
{
    cache_line_node_t* node1_prev = node1->prev;
    cache_line_node_t* node1_next = node1->next;
    cache_line_node_t* node2_prev = node2->prev;
    cache_line_node_t* node2_next = node2->next;
    node1->prev->next = node2;
    node1->next->prev = node2;
    node2->next->prev = node1;
    node2->prev->next = node1;
    node1->prev = node2_prev;
    node1->next = node2_next;
    node2->next = node1_next;
    node2->prev = node1_prev;
}
static inline void pointer_chasing_swap_lines_near(cache_line_node_t* node1, cache_line_node_t* node2)
{
    cache_line_node_t* node1_prev = node1->prev;
    cache_line_node_t* node2_next = node2->next;
    node1->prev->next = node2;
    node2->next->prev = node1;
    node1->prev = node2;
    node1->next = node2_next;
    node2->next = node1;
    node2->prev = node1_prev;
}

static void pointer_chasing_swap_lines(cache_line_node_t* node1, cache_line_node_t* node2)
{
    if (node1->prev == node2) {
        pointer_chasing_swap_lines_near(node2, node1);
    } else if (node1->next == node2) {
        pointer_chasing_swap_lines_near(node1, node2);
    } else if (node1 != node2) {
        pointer_chasing_swap_lines_far(node1, node2);
    }
}

static inline cache_line_node_t* pointer_chase_run_read_workload_internal(cache_line_node_t* nodes, size_t n_nodes)
{
    while (n_nodes--) {
        nodes = nodes->next;
    }
    return nodes;
}

cache_line_node_t* pointer_chase_randomise(cache_line_node_t* nodes,
    size_t n_nodes,
    pointer_chase_random_generator_t generator)
{
    for (size_t i = 0; i < n_nodes; i++) {
        size_t rand = generator() % n_nodes;
        pointer_chasing_swap_lines(&nodes[i], &nodes[rand]);
    }
    return nodes;
}
cache_line_node_t* pointer_chase_create_linear(void* buffer, size_t size)
{
    size_t n_nodes = size / sizeof(cache_line_node_t);
    printf("Pointer Chasing: Buffer Size %ld\n", size);
    printf("Pointer Chasing: Number of Nodes %ld\n", n_nodes);
    if (buffer == NULL || n_nodes < MINIMAL_NODE_NUMBER) {
        errno = EINVAL;
        return NULL;
    }
    return pointer_chasing_init_linear((cache_line_node_t*)buffer, n_nodes);
}

cache_line_node_t* pointer_chase_create_random(void* buffer, size_t size, pointer_chase_random_generator_t generator)
{
    if (generator == NULL) {
        errno = EINVAL;
        return NULL;
    }
    cache_line_node_t* self = pointer_chase_create_linear((cache_line_node_t*)buffer, size);
    if (self == NULL) {
        return NULL;
    }
    return pointer_chase_randomise(self, size / sizeof(cache_line_node_t), generator);
}

__attribute__((optimize("-O0"))) cache_line_node_t* pointer_chase_run_read_workload(cache_line_node_t* nodes,
    size_t n_nodes)
{
    return pointer_chase_run_read_workload_internal(nodes, n_nodes);
}

__attribute__((optimize("-O0"))) cache_line_node_t* pointer_chase_run_workload_read_cyclic(cache_line_node_t* nodes,
    size_t n_cycles)
{
    register cache_line_node_t* start = nodes;
    for (size_t cycle = 0; cycle < n_cycles; cycle++) {
        while (nodes != start) {
            nodes = nodes->next;
        }
    }
    return nodes;
}

cache_line_node_t* pointer_chase_run_read_write_workload(cache_line_node_t* nodes, size_t n_nodes)
{
    while (n_nodes--) {
        cache_line_node_t* node1 = nodes;
        cache_line_node_t* node2 = pointer_chase_run_read_workload_internal(node1, 3);
        nodes = pointer_chase_run_read_workload_internal(node2, 3);
        pointer_chasing_swap_lines_far(node1, node2);
    }
    return nodes;
}