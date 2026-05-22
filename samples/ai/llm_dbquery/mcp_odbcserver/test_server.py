# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import unittest
import os
import sys
import json
import time
import subprocess # nosec B404 - test file only, subprocess used safely with no shell=True
import signal
from pathlib import Path

class TestOdbcserverServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_process = None
        cls.port = int(os.getenv('MCP_ODBCSERVER_PORT', 7906))
        cls.server_path = "server.py"

    def setUp(self):
        # Start server before each test
        self.server_process = subprocess.Popen(
            [sys.executable, self.server_path, "start", "--json"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        time.sleep(3)  # Wait for server to start

    def tearDown(self):
        # Stop server after each test
        if self.server_process:
            try:
                # Try to stop gracefully first
                subprocess.run([sys.executable, self.server_path, "stop", "--json"], 
                             timeout=5, capture_output=True)
            except:
                pass
            finally:
                self.server_process.stdout.close()
                self.server_process.stderr.close()
                self.server_process.terminate()
                self.server_process.wait(timeout=5)

    def test_server_version(self):
        """Test that server version command works"""
        result = subprocess.run(
            [sys.executable, self.server_path, "version", "--json"],
            capture_output=True, text=True, timeout=10
        )
        self.assertEqual(result.returncode, 0)
        
        # Parse JSON response - handle mixed output robustly
        response = self._parse_json_from_output(result.stdout)
        self.assertTrue(response.get('success', False))
        self.assertIn('version', response.get('data', {}))

    def test_server_status(self):
        """Test that server status command works"""
        result = subprocess.run(
            [sys.executable, self.server_path, "status", "--json"],
            capture_output=True, text=True, timeout=10
        )
        self.assertEqual(result.returncode, 0)
        
        # Parse JSON response - handle mixed output robustly
        response = self._parse_json_from_output(result.stdout)
        self.assertIn('success', response)
        self.assertIn('message', response)

    def test_server_ping(self):
        """Test that server ping command works"""
        result = subprocess.run(
            [sys.executable, self.server_path, "ping", "--json"],
            capture_output=True, text=True, timeout=10
        )
        self.assertEqual(result.returncode, 0)
        
        # Parse JSON response - handle mixed output robustly
        response = self._parse_json_from_output(result.stdout)
        self.assertIn('success', response)
        self.assertIn('message', response)

    def _parse_json_from_output(self, output):
        """
        Robustly parse JSON from mixed output that may contain logging messages.
        Looks for lines that start with '{' or '[' and attempts to parse them as JSON.
        """
        lines = output.strip().split('\n')
        
        # Try to find and parse JSON lines
        for line in lines:
            line_stripped = line.strip()
            # Only attempt JSON parsing if line looks like JSON (starts with '{' or '[')
            if line_stripped.startswith('{') or line_stripped.startswith('['):
                try:
                    return json.loads(line_stripped)
                except json.JSONDecodeError:
                    continue
        
        # If no valid JSON found, try parsing the entire output as a fallback
        try:
            return json.loads(output.strip())
        except json.JSONDecodeError as e:
            self.fail(f"Could not parse JSON from output: {output}\nError: {e}")

if __name__ == '__main__':
    unittest.main()