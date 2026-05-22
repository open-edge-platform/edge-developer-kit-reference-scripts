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

/**
 * The pointer-chase workload represents a simple linked list. Each node in this
 * list contains pointers to the previous element and the next element of the list.
 * The size of a node is equal to the size of a cache line (64 bytes).
 *
 * The pointer-chase workload has two modes of initialization:
 * linear and random. In the linear mode, for each node in the list, the pointer to the
 * previous element points to the previous element in memory. The pointer to the next
 * element points to the next element in memory.
 * In the random mode, for each node of the list, the pointer to the previous element
 * and the pointer to the next element point to random elements in memory.
 *
 * In the linear mode, the hardware prefetchers can “read-ahead”
 * and prime the cache with the data.
 * In the random mode, there is no spatial locality,
 * and the data is generally not prefetched into cache. As a result, each access
 * of an element of the buffer incurs the latency for whatever level of the memory
 * hierarchy that the library “locked” the buffer into.
 *
 */

#ifndef _TCC_POINTER_CHASING_H_
#define _TCC_POINTER_CHASING_H_

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct cache_line_node_t cache_line_node_t;
typedef struct cache_line_it_t cache_line_it_t;
typedef long int (*pointer_chase_random_generator_t)(void);


/**
 * \brief Creates a linear pointer-chase node list.
 * Creates a cyclical linked list from the input buffer of elements continuously placed in memory.
 * The last element refers to the first element of the list. The size of each node is equal to the size of a cache line.
 * \param buffer [in] pointer to the memory buffer where the pointer-chase list will be located
 * \param size [in] size of the memory buffer in bytes
 * \return pointer to the first node of the linked list
 **/
cache_line_node_t* pointer_chase_create_linear(void* buffer, size_t size);


/**
 * \brief Creates a random pointer-chase node list.
 * Creates a cyclical linked list from the input buffer with elements that randomly connect with each other.
 * The last element refers to the first element. The size of each node is equal to the size of a cache line.
 * \param buffer [in] pointer to the memory buffer where the pointer-chase list will be located
 * \param size [in] size of the memory buffer in bytes
 * \return pointer to the first node of the linked list
 **/
cache_line_node_t* pointer_chase_create_random(void* buffer, size_t size, pointer_chase_random_generator_t generator);

/**
 * \brief Executes the pointer-chase read workload for a given number of nodes.
 * The workload accesses the next item of the linked list and generates one cache line read.
 *
 * Warning: This function does not validate input parameters to improve performance.
 * \param nodes [in] pointer to the initial pointer-chase node
 * \param n_nodes [in] number of nodes to iterate
 * \return the next node of the linked list
 **/
cache_line_node_t* pointer_chase_run_read_workload(cache_line_node_t* nodes, size_t n_nodes);


/**
 * \brief Executes the pointer-chase read workload for all nodes in a list.
 * The workload accesses the next item of the linked list and generates one cache line read. This function
 * iterates the linked list until the last element of the list.
 *
 * Warning: This function does not validate input parameters to increase performance.
 * \param nodes [in] pointer to the initial pointer-chase node
 * \param n_cycles [in] number of times the workload should iterate over the all nodes of the list
 * \return  the next node of the linked list
 **/
cache_line_node_t* pointer_chase_run_workload_read_cyclic(cache_line_node_t* nodes, size_t n_cycles);

/**
 * \brief Executes the pointer-chase read-write workload for a given number of nodes multiplied by six.
 * On each iteration, the workload reads 3 + 3 nodes and swaps it.
 *
 * Warning: This function does not validate input parameters to improve performance.
 * \param nodes [in] pointer to the initial pointer-chase node
 * \param n_nodes [in] number of nodes to iterate
 * \return the next node of the linked list
 **/
cache_line_node_t* pointer_chase_run_read_write_workload(cache_line_node_t* nodes, size_t n_nodes);

#ifdef __cplusplus
}
#endif

#endif  // _TCC_POINTER_CHASING_H_