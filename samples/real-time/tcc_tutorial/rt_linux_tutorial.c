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
#define _GNU_SOURCE
#include <sched.h>
#include <cpuid.h>
#include <stdio.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#include <pthread.h>
#include <errno.h>
#include <fcntl.h> // Include for open
#include <string.h> // Include for strerror
#include <getopt.h>
#include <stdbool.h>
#include <MQTTClient.h>
#include <cjson/cJSON.h>
#include "pointer_chasing.h"

#define NANOSECONDS_PER_SECOND 1000000000

// Pointer Chasing Settings
// The size of the array must be larger than the L2 cache size 
// in order to observe an optimization with LLC partitioning.
#define WORKLOAD_BUFFER_SIZE (3UL * 1024 *1024) // Size of the pointer chasing array
// How many nodes should be randomly touched during one cycle 
// (NumNode = WORLOAD_BUFFER_SIZE / Cacheline_Size)
// e.g. Buffer Size = 2MB => 2MB / 64Byte per Cache line = 32768 Nodes 
// => each cycle WORKLOAD_NUM_NODE_ACCESSES nodes are randomly touched.
#define WORKLOAD_NUM_NODE_ACCESSES (5*1024) 

// Core ID for Control thread and the cycle time in us
#define CONTROL_THREAD_CORE 3
#define CYCLE_TIME_US 250
// Core ID for Statistics thread
#define STATS_THREAD_CORE 1

// MQTT Settings
//#define ADDRESS     "tcp://localhost:1883" // use localhost if app does not run in container
#define ADDRESS     "tcp://mosquitto:1883"
#define CLIENTID    "TCC_ClientPub"
#define TOPIC       "sensor/data"
#define QOS         1
#define TIMEOUT     10000L
#define BATCH_SIZE  1000

// PMC from ring3 first needs to be enabled  
// echo 2 > /sys/devices/cpu/rdpmc done in init_rdpmc()
#define rdpmc(counter, result) \
    do { \
        unsigned int low, high; \
        __asm__ __volatile__("rdpmc" \
            : "=a" (low), "=d" (high) \
            : "c" (counter)); \
        result = ((unsigned long long)high << 32) | low; \
    } while (0)

typedef struct {
    long exec_time;
    long wakeup_jitter;
    long cache_misses;
    float ipc;
    long long time;
} statistics_t;

typedef struct {
    long min_exec_time;
    long max_exec_time;
    double avg_exec_time;
    long min_wakeup_jitter;
    long max_wakeup_jitter;
    double avg_wakeup_jitter;
    long min_cache_misses;
    long max_cache_misses;
    double avg_cache_misses;
} glb_statistics_t;

// Define the Node structure which now holds statistics_t
typedef struct Node {
    statistics_t stats;
    struct Node* next;
} Node;

// Define the Lock-Free Queue structure with atomic pointers to Nodes
typedef struct LockFreeQueue {
    _Atomic(Node*) head;
    _Atomic(Node*) tail;
    _Atomic int fill_level;
} LockFreeQueue;

typedef struct {
    long cycletime;
    LockFreeQueue* statistics_info_queue;
} ctrl_thread_args_t;

typedef struct {
    int useMqtt;
    LockFreeQueue* statistics_info_queue;
} stat_thread_args_t;

// Define an enum for core type
typedef enum {
    PERFORMANCE_CORE,
    EFFICIENCY_CORE,
    UNKNOWN_CORE
} core_type;


//////////////////////////////
// Lock free queue functions 
// @ToDo: Check if it is better to replace the dynamic queue with a static queue
//////////////////////////////

// Helper function to create a new node with statistics_t data
Node* new_node(long exec_time, long wakeup_jitter, long cache_misses, float ipc) {
    Node* node = (Node*)malloc(sizeof(Node));
    if (node == NULL) {
        fprintf(stderr,"Memory allocation failed.\n");
        exit(EXIT_FAILURE);
    }
    node->stats.exec_time = exec_time;
    node->stats.wakeup_jitter = wakeup_jitter;
    node->stats.cache_misses = cache_misses;
    node->stats.ipc = ipc;

    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    long long microseconds_since_epoch = (long long)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
    node->stats.time = microseconds_since_epoch;

    node->next = NULL;

    return node;
}

// Initialize the lock-free queue with a dummy node
void init_queue(LockFreeQueue* queue) {
    Node* dummy = new_node(0, 0, 0, 0);  // Dummy node with zeroed statistics
    atomic_store(&queue->head, dummy);
    atomic_store(&queue->tail, dummy);
    atomic_store(&queue->fill_level, 0);
}

// Enqueue operation (lock-free) with statistics_t data
void enqueue(LockFreeQueue* queue, long exec_time, long wakeup_jitter, long cache_misses, float ipc) {
    Node* newNode = new_node(exec_time, wakeup_jitter, cache_misses, ipc);
    while (1) {
        Node* tail = atomic_load(&queue->tail);
        Node* next = tail->next;
        if (tail == atomic_load(&queue->tail)) {  // Check tail consistency
            if (next == NULL) {  // Tail is the last node
                if (atomic_compare_exchange_weak(&tail->next, &next, newNode)) {
                    atomic_compare_exchange_weak(&queue->tail, &tail, newNode);
                    atomic_fetch_add(&queue->fill_level, 1); //Increment the fill level atomically
                    return;
                }
            } else {
                // Tail not pointing to the last node, update tail
                atomic_compare_exchange_weak(&queue->tail, &tail, next);
            }
        }
    }
}

// Dequeue operation (lock-free) and return statistics_t data
int dequeue(LockFreeQueue* queue, statistics_t* result) {
    while (1) {
        Node* head = atomic_load(&queue->head);
        Node* tail = atomic_load(&queue->tail);
        Node* next = head->next;

        if (head == atomic_load(&queue->head)) {  // Check head consistency
            if (head == tail) {  // Is the queue empty?
                if (next == NULL) {
                    return 0;  // Queue is empty
                }
                // Tail is behind, try to advance it
                atomic_compare_exchange_weak(&queue->tail, &tail, next);
            } else {
                // Read the statistics and try to dequeue
                *result = next->stats;
                if (atomic_compare_exchange_weak(&queue->head, &head, next)) {
                    free(head);  // Free old dummy node
                    atomic_fetch_sub(&queue->fill_level, 1); //Decrement the fill level atomically
                    return 1;  // Dequeue success
                }
            }
        }
    }
}

//Query current fill level of the queue
int query_fill_level(LockFreeQueue* queue) {
    return atomic_load(&queue->fill_level);
}

// Free the queue nodes
void free_queue(LockFreeQueue* queue) {
    statistics_t stats;
    while (dequeue(queue, &stats));  // Dequeue until empty
    Node* head = atomic_load(&queue->head);
    free(head);  // Free the remaining dummy node
}

////////////////////////////
// Helper funtions 
////////////////////////////

int init_cache_miss_counter(int cpu) {
    char fpath[32];
    unsigned long long perfGblCtrl;
    unsigned long long l3Miss = 0x4320d1; // code for L3 Miss
    unsigned long long enablePmc0 = 0x1;
    int IA32_PERFEVTSEL0 = 0x186;
    int IA32_PERF_GLOBAL_CTRL = 0x38f;
    int fd = 0;
    sprintf(fpath, "/dev/cpu/%d/msr", cpu);
    fd = open(fpath, O_RDWR);
    if (fd == -1) {
        fprintf(stderr,"Failed to open MSR file");
        return EXIT_FAILURE;
    }

    // read PERF global control register
    if (pread(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
            fprintf(stderr,"Cannot read MSR IA32_PERF_GLOBAL_CTRL from %s\n", fpath);
            return EXIT_FAILURE;
    }

    // check if PMC0 counter is enabled if not enable it
    if (0 == (perfGblCtrl & enablePmc0)){
            perfGblCtrl |= enablePmc0;
            //  Enable PMC0 counter
            if (pwrite(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
                    fprintf(stderr,"Cannot write MSR IA32_PERF_GLOBAL_CTRL to %s\n", fpath);
                    return EXIT_FAILURE;
            }
    }

    // Configure PERF Event Selector 0 for L3 misses
    if (pwrite(fd, &l3Miss, sizeof l3Miss, IA32_PERFEVTSEL0) != sizeof l3Miss) {
            fprintf(stderr,"Cannot write MSR IA32_PERFEVTSEL0 to %s\n", fpath);
            return EXIT_FAILURE;
    }

    close(fd);
    return EXIT_SUCCESS; // Return 0 on success
}

int init_insRetired_counter(int cpu) {
    char fpath[32];
    unsigned long long perfGblCtrl;
    unsigned long long insRetired = 0x4300c0; // code for instructions retired
    unsigned long long enablePmc1 = 0x1;
    int IA32_PERFEVTSEL1 = 0x187;
    int IA32_PERF_GLOBAL_CTRL = 0x38f;
    int fd = 0;
    sprintf(fpath, "/dev/cpu/%d/msr", cpu);
    fd = open(fpath, O_RDWR);
    if (fd == -1) {
        fprintf(stderr,"Failed to open MSR file");
        return EXIT_FAILURE;
    }

    // read PERF global control register
    if (pread(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
            fprintf(stderr,"Cannot read MSR IA32_PERF_GLOBAL_CTRL from %s\n", fpath);
            return EXIT_FAILURE;
    }

    // check if PMC1 counter is enabled if not enable it
    if (0 == (perfGblCtrl & enablePmc1)){
            perfGblCtrl |= enablePmc1;
            //  Enable PMC1 counter
            if (pwrite(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
                    fprintf(stderr,"Cannot write MSR IA32_PERF_GLOBAL_CTRL to %s\n", fpath);
                    return EXIT_FAILURE;
            }
    }

    // Configure PERF Event Selector 1 for instructions retired
    if (pwrite(fd, &insRetired, sizeof insRetired, IA32_PERFEVTSEL1) != sizeof insRetired) {
            fprintf(stderr,"Cannot write MSR IA32_PERFEVTSEL1 to %s\n", fpath);
            return EXIT_FAILURE;
    }

    close(fd);
    return EXIT_SUCCESS; // Return 0 on success
}

int init_unHaltedCoreCycles_counter(int cpu) {
    char fpath[32];
    unsigned long long perfGblCtrl;
    unsigned long long unHaltedCoreCycles = 0x43003c; // code for unhalted core cycles
    unsigned long long enablePmc2 = 0x2;
    int IA32_PERFEVTSEL2 = 0x188;
    int IA32_PERF_GLOBAL_CTRL = 0x38f;
    int fd = 0;
    sprintf(fpath, "/dev/cpu/%d/msr", cpu);
    fd = open(fpath, O_RDWR);
    if (fd == -1) {
        fprintf(stderr,"Failed to open MSR file");
        return EXIT_FAILURE;
    }

    // read PERF global control register
    if (pread(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
            fprintf(stderr,"Cannot read MSR IA32_PERF_GLOBAL_CTRL from %s\n", fpath);
            return EXIT_FAILURE;
    }

    // check if PMC2 counter is enabled if not enable it
    if (0 == (perfGblCtrl & enablePmc2)){
            perfGblCtrl |= enablePmc2;
            //  Enable PMC1 counter
            if (pwrite(fd, &perfGblCtrl, sizeof perfGblCtrl, IA32_PERF_GLOBAL_CTRL) != sizeof perfGblCtrl) {
                    fprintf(stderr,"Cannot write MSR IA32_PERF_GLOBAL_CTRL to %s\n", fpath);
                    return EXIT_FAILURE;
            }
    }

    // Configure PERF Event Selector 1 for unhalted core cycles
    if (pwrite(fd, &unHaltedCoreCycles, sizeof unHaltedCoreCycles, IA32_PERFEVTSEL2) != sizeof unHaltedCoreCycles) {
            fprintf(stderr,"Cannot write MSR IA32_PERFEVTSEL2 to %s\n", fpath);
            return EXIT_FAILURE;
    }

    close(fd);
    return EXIT_SUCCESS; // Return 0 on success
}

core_type get_core_type() {
    unsigned int eax, ebx, ecx, edx;
    
    //CPUID leaf 0x1A - Native Model ID Enumeration Leaf (SDM Vol2a Table 3-8)
    __cpuid(0x1A, eax, ebx, ecx, edx);
    //Check Bit 29 or 30 of eax
    if (eax & (1 << 29)) {
        return EFFICIENCY_CORE;
    }
    else if(eax & (1 << 30)) {
        return PERFORMANCE_CORE;
        }
    return UNKNOWN_CORE;
}

int is_hybrid_platform() {
    unsigned int eax, ebx, ecx, edx;
    
    //CPUID leaf 0x07 - bit 15 of EBX register
    __cpuid(0x07, eax, ebx, ecx, edx);
     return (edx & (1 << 15)) != 0; // 1 is hybrid
}

int init_rdpmc() {

    char *path = "";
    if( !is_hybrid_platform()) {
        path = "/sys/devices/cpu/rdpmc";
    } 
    else {
        switch (get_core_type()) {
            case EFFICIENCY_CORE:
                path = "/sys/devices/cpu_atom/rdpmc";
                break;
            case PERFORMANCE_CORE:
                path = "/sys/devices/cpu_core/rdpmc";
                break;
            case UNKNOWN_CORE:
                return EXIT_FAILURE;
            default:
                return EXIT_FAILURE;
        }
    }
    int fd = open(path, O_WRONLY); // Open the file for writing only

    if (fd == -1) {
        fprintf(stderr, "Error opening file: %s\n", strerror(errno));
        return EXIT_FAILURE;
    }

    const char *value = "2"; // Write the string "2" to the file to allow rdpmc for all tasks
    ssize_t bytes_written = write(fd, value, strlen(value)); 

    if (bytes_written == -1) {
        fprintf(stderr, "Error writing to file: %s\n", strerror(errno));
        close(fd);
        return EXIT_FAILURE;
    }

    close(fd); // Close the file descriptor
    return EXIT_SUCCESS;
}

int set_thread_affinity(pthread_t thread, int core_id) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);

    int result = pthread_setaffinity_np(thread, sizeof(cpu_set_t), &cpuset);
    if (result != 0) {
        errno = result;
        fprintf(stderr,"pthread_setaffinity_np failed \n");
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}

inline long time_delta(struct timespec *start, struct timespec *end) {
    long delta_sec = end->tv_sec - start->tv_sec;
    long delta_nsec = end->tv_nsec - start->tv_nsec;
    long delta = delta_sec * 1000000000L + delta_nsec; // Convert seconds to nanoseconds and add nanoseconds
    return delta;
}

// Function to serialize a batch of statistics into a JSON payload
char* serialize_statistics(statistics_t* stats_batch, int batch_size) {
    // Create a JSON array to hold the data points
    cJSON *json_array = cJSON_CreateArray();
    if (json_array == NULL) {
        // Handle error
        return NULL;
    }

    // Populate the JSON array with data points
    for (int i = 0; i < batch_size; ++i) {
        cJSON *json_object = cJSON_CreateObject();
        if (json_object == NULL) {
            // Handle error
            cJSON_Delete(json_array);
            return NULL;
        }

        // Add data to the JSON object
        cJSON_AddItemToObject(json_object, "exec_time", cJSON_CreateNumber(stats_batch[i].exec_time));
        cJSON_AddItemToObject(json_object, "wakeup_jitter", cJSON_CreateNumber(stats_batch[i].wakeup_jitter));
        cJSON_AddItemToObject(json_object, "cache_misses", cJSON_CreateNumber(stats_batch[i].cache_misses));
        cJSON_AddItemToObject(json_object, "ipc", cJSON_CreateNumber(stats_batch[i].ipc));
        cJSON_AddItemToObject(json_object, "timestamp", cJSON_CreateNumber((double)stats_batch[i].time));

        // Add the JSON object to the array
        cJSON_AddItemToArray(json_array, json_object);
    }

    // Print the JSON array to a string
    char *serialized_string = cJSON_PrintUnformatted(json_array);
    if (serialized_string == NULL) {
        // Handle error
        cJSON_Delete(json_array);
        return NULL;
    }

    // Clean up
    cJSON_Delete(json_array);

    return serialized_string;
}

void plot_statistics(statistics_t* stats_batch, int batch_size, glb_statistics_t* glb_stats, bool first_call) {

    for (int i = 0; i < batch_size; i++) {
        if (stats_batch[i].exec_time < glb_stats->min_exec_time) glb_stats->min_exec_time = stats_batch[i].exec_time;
        if (stats_batch[i].exec_time > glb_stats->max_exec_time) glb_stats->max_exec_time = stats_batch[i].exec_time;
        glb_stats->avg_exec_time += stats_batch[i].exec_time;
        if (stats_batch[i].wakeup_jitter < glb_stats->min_wakeup_jitter) glb_stats->min_wakeup_jitter = stats_batch[i].wakeup_jitter;
        if (stats_batch[i].wakeup_jitter > glb_stats->max_wakeup_jitter) glb_stats->max_wakeup_jitter = stats_batch[i].wakeup_jitter;
        glb_stats->avg_wakeup_jitter += stats_batch[i].wakeup_jitter;
        if (stats_batch[i].cache_misses < glb_stats->min_cache_misses) glb_stats->min_cache_misses = stats_batch[i].cache_misses;
        if (stats_batch[i].cache_misses > glb_stats->max_cache_misses) glb_stats->max_cache_misses = stats_batch[i].cache_misses;
        glb_stats->avg_cache_misses += stats_batch[i].cache_misses;   
    }
        glb_stats->avg_exec_time = glb_stats->avg_exec_time / (batch_size + 1);
        glb_stats->avg_wakeup_jitter = glb_stats->avg_wakeup_jitter / (batch_size + 1);
        glb_stats->avg_cache_misses = glb_stats->avg_cache_misses / (batch_size + 1);   

    if (first_call == false){
       // Move the cursor up four lines
       printf("\033[4A");
    }
    fprintf(stdout, "#### Control Thread Statistics \n");
    fprintf(stdout, "Execution Time: Min: %5ldus Max: %5ldus Avg: %5.2fus\n", glb_stats->min_exec_time/1000, glb_stats->max_exec_time/1000, glb_stats->avg_exec_time/1000);
    fprintf(stdout, "Wakeup Jitter:  Min: %5ldus Max: %5ldus Avg: %5.2fus\n", glb_stats->min_wakeup_jitter/1000, glb_stats->max_wakeup_jitter/1000, glb_stats->avg_wakeup_jitter/1000);
    fprintf(stdout, "Cache Misses:   Min: %5ld   Max: %5ld   Avg: %5.2f\n", glb_stats->min_cache_misses, glb_stats->max_cache_misses, glb_stats->avg_cache_misses);
    
    fflush(stdout); // Ensure the output is immediately written to the console
}

////////////////////////////
// Main funtions 
////////////////////////////

// Function to perform the control task
//TODO: Check if we need to reset PMU counter at the begining of every cycle to avoid overflows
void control_task(long cycle_time_ns, cache_line_node_t* workload_pointer_chasing, LockFreeQueue *lf_queue) {
    struct timespec next_wake_time;
    struct timespec actual_wake_time;
    struct timespec task_start_time;
    struct timespec task_end_time;
    long cache_misses_start = 0;
    long cache_misses_end = 0;
    long ins_retired_start = 0;
    long ins_retired_end = 0;
    long unhalted_core_cycles_start = 0;
    long unhalted_core_cycles_end = 0;
    
    int cpu_core;

    cpu_core = sched_getcpu();
    if (cpu_core == -1) {
        fprintf(stderr,"sched_getcpu() failed\n");
        goto end;
    }

    fprintf(stdout,"Control thread is running on CPU core: %d\n", cpu_core);
    
    if (init_cache_miss_counter(cpu_core) != 0) {
        fprintf(stderr, "Failed to initialize cache miss counter\n");
        goto end;
    }
        
    if (init_insRetired_counter(cpu_core) != 0) {
        fprintf(stderr, "Failed to initialize instructions retired counter\n");
        goto end;
    }

    if (init_unHaltedCoreCycles_counter(cpu_core) != 0) {
        fprintf(stderr, "Failed to initialize unhalted Core cycles counter\n");
        goto end;
    }

    if (init_rdpmc() != 0) {
        fprintf(stderr, "Initialization of rdpmc failed\n");
        goto end;
    }

    clock_gettime(CLOCK_MONOTONIC, &next_wake_time);

    while (1) {
        // Calculate the next wake-up time
        long next_sec = next_wake_time.tv_sec;
        long next_nsec = next_wake_time.tv_nsec + cycle_time_ns;

        while (next_nsec >= NANOSECONDS_PER_SECOND) {
            next_nsec -= NANOSECONDS_PER_SECOND;
            next_sec++;
        }

        next_wake_time.tv_sec = next_sec;
        next_wake_time.tv_nsec = next_nsec;

        // Sleep until the next cycle
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_wake_time, NULL);

        // Get the actual wake-up time
        clock_gettime(CLOCK_MONOTONIC, &actual_wake_time);

        //read LLC Cache Miss Counter before the workload 
        rdpmc(0/*counter 0*/,cache_misses_start);
        // Call the workload function (pointer chasing)
        clock_gettime(CLOCK_MONOTONIC, &task_start_time);

        rdpmc(1 /*counter 1*/,ins_retired_start);
        rdpmc(2 /*counter 2*/,unhalted_core_cycles_start);
        workload_pointer_chasing = pointer_chase_run_read_workload(workload_pointer_chasing, WORKLOAD_NUM_NODE_ACCESSES);
        rdpmc(1 /*counter 1*/,ins_retired_end);
        rdpmc(2 /*counter 2*/,unhalted_core_cycles_end);

        clock_gettime(CLOCK_MONOTONIC, &task_end_time);
        //read LLC Cache Miss Counter after the workload 
        rdpmc(0/*counter 0*/,cache_misses_end);

        // Push generated data into the statistic handler queue
        enqueue(lf_queue, time_delta(&task_start_time, &task_end_time), time_delta(&next_wake_time ,&actual_wake_time), \
                cache_misses_end - cache_misses_start, \
                (float)((float)(ins_retired_end-ins_retired_start)/(float)(unhalted_core_cycles_end-unhalted_core_cycles_start)));
    }
end:

}

// Thread function for the control loop
void *control_loop_thread(void *arg) {
    long cycle_time_ns = ((ctrl_thread_args_t *)arg)->cycletime;

    void* ptr_chasing_mem = malloc(WORKLOAD_BUFFER_SIZE);

	if (ptr_chasing_mem == NULL) {
        fprintf(stderr,"Failed to allocate memory for ptr chasing\n");
        return NULL;
    }
	cache_line_node_t* workload_pointer_chasing = pointer_chase_create_random(ptr_chasing_mem,  WORKLOAD_BUFFER_SIZE, random);

    // Run the control task with pointer chasing workload
    control_task(cycle_time_ns, workload_pointer_chasing, ((ctrl_thread_args_t *)arg)->statistics_info_queue);

    free(ptr_chasing_mem);
    return NULL;
}

void *statistics_handler(void *arg) {
    LockFreeQueue* lf_queue = ((stat_thread_args_t *)arg)->statistics_info_queue;
    int use_mqtt = ((stat_thread_args_t *)arg)->useMqtt; 

    MQTTClient client;
    MQTTClient_connectOptions conn_opts = MQTTClient_connectOptions_initializer;
    MQTTClient_message pubmsg = MQTTClient_message_initializer;
    MQTTClient_deliveryToken token;
    int rc;
    bool first_call = true;

    if (use_mqtt) {
        MQTTClient_create(&client, ADDRESS, CLIENTID, MQTTCLIENT_PERSISTENCE_NONE, NULL);
        conn_opts.keepAliveInterval = 20;
        conn_opts.cleansession = 1;

        if ((rc = MQTTClient_connect(client, &conn_opts)) != MQTTCLIENT_SUCCESS) {
            fprintf(stderr,"Failed to connect, return code %d\n", rc);
            exit(EXIT_FAILURE);
        }
    }

    statistics_t stats_batch[BATCH_SIZE];
    int batch_index = 0;
    glb_statistics_t glb_stats;
    glb_stats.min_exec_time = 1e9;
    glb_stats.max_exec_time = 0;
    glb_stats.avg_exec_time = 0.0;
    glb_stats.min_wakeup_jitter = 1e9;
    glb_stats.max_wakeup_jitter = 0;
    glb_stats.avg_wakeup_jitter = 0.0;
    glb_stats.min_cache_misses = 1e9;
    glb_stats.max_cache_misses = 0;
    glb_stats.avg_cache_misses = 0.0;

    int cpu_core = sched_getcpu();
    if (cpu_core == -1) {
        fprintf(stderr,"sched_getcpu() failed\n");
        goto end;
    }

    fprintf(stdout,"Statistic thread is running on CPU core: %d\n", cpu_core);

    while (1) {
        // Dequeue statistics and put it in a batch array to send in bursts
        statistics_t stat;
        if (dequeue(lf_queue, &stat)) {
            // Add statistic to batch
            stats_batch[batch_index++] = stat;

            // If batch is full, process it
            if (batch_index >= BATCH_SIZE) {
                if (use_mqtt) {
                    char* payload = serialize_statistics(stats_batch, BATCH_SIZE);
                    pubmsg.payload = payload;
                    pubmsg.payloadlen = strlen(payload);
                    pubmsg.qos = QOS;
                    pubmsg.retained = 0;
                    MQTTClient_publishMessage(client, TOPIC, &pubmsg, &token);
                    MQTTClient_waitForCompletion(client, token, TIMEOUT);
                    free(payload);
                } else {
                    plot_statistics(stats_batch, BATCH_SIZE, &glb_stats, first_call);
                    first_call = false;
                }
                batch_index = 0;
            }
        }
    }

    if (use_mqtt) {
        MQTTClient_disconnect(client, 10000);
        MQTTClient_destroy(&client);
    }

end:
    return NULL;
}


void print_help() {
    fprintf(stdout, "Usage: rt_linux_tutorial [OPTIONS]\n");
    fprintf(stdout,"Options:\n");
    fprintf(stdout,"  -h        Display this help message\n");
    fprintf(stdout,"  -i <time> Set the cycle time of the control thread in microseconds - default is 500us\n");
    fprintf(stdout,"  -s <0|1>  Set the output method for statistics (0 for stdout, 1 for MQTT to localhost) - default stdout\n");
}

int main(int argc, char *argv[]) {

    (void) argc;
    (void) argv;
    pthread_t control_thread, stats_thread;
    pthread_attr_t attr;
    struct sched_param param;
    ctrl_thread_args_t control_thread_args;
    stat_thread_args_t statistics_thread_args;

    int statistics_out = 0;
    control_thread_args.cycletime = CYCLE_TIME_US * 1000;
    
    int opt;
    while ((opt = getopt(argc, argv, "hi:s:")) != -1) {
        switch (opt) {
            case 'h':
                print_help();
                return EXIT_SUCCESS;
            case 'i':
                control_thread_args.cycletime = atoi(optarg) * 1000;
                break;
            case 's':
                statistics_out = atoi(optarg);
                break;
            default:
                print_help();
                return EXIT_FAILURE;
        }
    }

    // print cycletime 
    fprintf(stdout, "The control thread runs with a cycle time of %lius\n", control_thread_args.cycletime/1000);
    // print statistic output
    if (statistics_out == 0){
        fprintf(stdout, "Statistics output to console.\n");
    }
    else {
        fprintf(stdout, "Statistics output to Mqtt.\n");
    }
    // Lock-free queue to handle statistics 
    LockFreeQueue lf_queue;
    init_queue(&lf_queue);

    control_thread_args.statistics_info_queue = &lf_queue;

    // Initialize thread attributes for the control thread
    pthread_attr_init(&attr);

    // Set the scheduling policy to FIFO for the control thread
    pthread_attr_setschedpolicy(&attr, SCHED_FIFO);

    // Set the priority to the maximum allowed for the FIFO policy
    param.sched_priority = sched_get_priority_max(SCHED_FIFO);
    pthread_attr_setschedparam(&attr, &param);

    // Use the scheduling attributes specified
    pthread_attr_setinheritsched(&attr, PTHREAD_EXPLICIT_SCHED);

    // Create the control loop thread with the specified attributes
    int ret = pthread_create(&control_thread, &attr, control_loop_thread, &control_thread_args);
    if (ret) {
        errno = ret;
        fprintf(stderr,"Failed to create control thread");
        return EXIT_FAILURE;
    }

    // Pin the control thread to core 3
    if (set_thread_affinity(control_thread, CONTROL_THREAD_CORE) != 0) {
        fprintf(stderr, "Failed to set affinity for control thread\n");
        return EXIT_FAILURE;
    }

    // Destroy the thread attributes object, since it is no longer needed
    pthread_attr_destroy(&attr);

    //Init Statistic Handler
    statistics_thread_args.useMqtt = statistics_out;
    statistics_thread_args.statistics_info_queue = &lf_queue;

    // Initialize thread attributes for the statistics handler thread
    pthread_attr_init(&attr);

    // Set the scheduling policy to SCHED_OTHER (default) for the statistics handler thread
    pthread_attr_setschedpolicy(&attr, SCHED_OTHER);

    // Set the priority to 0 (normal priority for SCHED_OTHER)
    param.sched_priority = 0;
    pthread_attr_setschedparam(&attr, &param);

    // Create the statistics handler thread with the specified attributes
    ret = pthread_create(&stats_thread, &attr, statistics_handler, &statistics_thread_args);
    if (ret) {
        errno = ret;
        fprintf(stderr,"Failed to create statistics handler thread");
        return EXIT_FAILURE;
    }

    // Pin the statistics thread to core 1
    if (set_thread_affinity(stats_thread, STATS_THREAD_CORE) != 0) {
        fprintf(stderr, "Failed to set affinity for statistics thread\n");
        return EXIT_FAILURE;
    }

    // Destroy the thread attributes object, since it is no longer needed
    pthread_attr_destroy(&attr);
 
    // Wait for the threads to finish (they won't, so this program will need to be killed)
    pthread_join(control_thread, NULL);
    pthread_join(stats_thread, NULL);

    // Clean up
    free_queue(&lf_queue);

    return EXIT_SUCCESS;
}
