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
#
# SPDX-License-Identifier: BSD-3-Clause
####################################################################################
CC=gcc
CFLAGS=-Wall -Wextra -fcf-protection=full -Wformat -Wmissing-field-initializers -Wformat-security -fPIC -fPIE -pie -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS -fstack-protector -O2 -I/usr/local/include
LDFLAGS=-L/usr/local/lib -lpaho-mqtt3c -lcjson
TARGET=rt_linux_tutorial
OBJ=rt_linux_tutorial.o pointer_chasing.o

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CC) $(CFLAGS) -o $(TARGET) $(OBJ) $(LDFLAGS)

main.o: rt_linux_tutorial.c pointer_chasing.h
	$(CC) $(CFLAGS) -c rt_linux_tutorial.c

pointer_chasing.o: pointer_chasing.c pointer_chasing.h
	$(CC) $(CFLAGS) -c pointer_chasing.c

clean:
	rm -f $(TARGET) $(OBJ)
