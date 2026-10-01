# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import hashlib
import math


class DeterministicFixtureValues:
    """Produce repeatable fixture values without using a standard PRNG."""

    def __init__(self, seed):
        self.reseed(seed)

    def reseed(self, seed):
        self._seed = str(seed).encode("utf-8")
        self._counter = 0

    def _digest(self):
        counter = self._counter.to_bytes(16, "big")
        self._counter += 1
        return hashlib.sha256(self._seed + b":" + counter).digest()

    def integer(self, start, end):
        if start > end:
            raise ValueError("start must not exceed end")
        return start + self._below(end - start + 1)

    def fraction(self):
        return self._below(10_000_000) / 10_000_000

    def range_float(self, start, end):
        return start + (end - start) * self.fraction()

    def select(self, sequence):
        if not sequence:
            raise IndexError("cannot select from an empty sequence")
        return sequence[self._below(len(sequence))]

    def select_many(self, population, weights=None, count=1):
        if weights is None:
            return [self.select(population) for _ in range(count)]
        if len(population) != len(weights) or any(weight < 0 for weight in weights):
            raise ValueError("weights must be non-negative and match the population")

        total = sum(weights)
        if total <= 0:
            raise ValueError("weights must sum to a positive value")
        cumulative = []
        running_total = 0
        for weight in weights:
            running_total += weight
            cumulative.append(running_total)

        result = []
        for _ in range(count):
            draw = self.range_float(0, total)
            for item, boundary in zip(population, cumulative):
                if draw < boundary:
                    result.append(item)
                    break
        return result

    def take(self, population, count):
        if not 0 <= count <= len(population):
            raise ValueError("sample larger than population or negative")
        available = list(population)
        result = []
        for _ in range(count):
            result.append(available.pop(self._below(len(available))))
        return result

    def normal(self, mean, standard_deviation):
        first = self.fraction()
        while first == 0:
            first = self.fraction()
        second = self.fraction()
        standard_normal = math.sqrt(-2 * math.log(first)) * math.cos(2 * math.pi * second)
        return mean + standard_deviation * standard_normal

    def _below(self, upper_bound):
        if upper_bound <= 0:
            raise ValueError("upper bound must be positive")
        bit_length = (upper_bound - 1).bit_length()
        byte_length = max(1, (bit_length + 7) // 8)
        mask = (1 << bit_length) - 1
        while True:
            value = int.from_bytes(self._digest()[:byte_length], "big") & mask
            if value < upper_bound:
                return value
