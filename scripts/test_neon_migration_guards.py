"""Failure guards; subprocesses and target connections are mocked, never real."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import neon_preflight
import restore_neon


class RestoreGuards(unittest.TestCase):
    def setUp(self):
        self.root = (Path(__file__).resolve().parents[1] / ".local/neon/guard-tests").resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="isolated-", dir=self.root)
        self.directory = Path(self.temp.name).resolve()
        assert self.directory.parent == self.root
        self.archive = self.directory / "fixture.dump"
        self.archive.write_bytes(b"PGDMP-isolated-guard-fixture")
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.target = {"host": "ep-fixture.us-east-1.aws.neon.tech", "database": "fixture", "role": "fixture",
                       "server_version_num": 180006, "project": "savra-real", "direct_connection": True}
        self.preflight = self.directory / "preflight.json"
        self.preflight.write_text(json.dumps(self.target), encoding="utf-8")
        self.argv = ["restore_neon.py", str(self.archive), "--confirm-empty-neon", "--expected-sha256", self.digest,
                     "--preflight", str(self.preflight)]
        self.url = "postgresql://fixture:test-only-password@ep-fixture.us-east-1.aws.neon.tech/fixture?sslmode=require&channel_binding=require"

    def tearDown(self):
        assert self.directory.parent == self.root
        self.temp.cleanup()

    def invoke(self, target=None, empty=b"0", checksum=None):
        argv = list(self.argv)
        if checksum is not None:
            argv[argv.index("--expected-sha256") + 1] = checksum
        calls = []
        def command(args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, stdout=empty, stderr=b"")
        with patch("sys.argv", argv), patch.dict(os.environ, {"NEON_DATABASE_URL": self.url}), \
             patch.object(restore_neon, "check_target", return_value=target or self.target) as probe, \
             patch.object(restore_neon.subprocess, "run", side_effect=command), \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                restore_neon.main()
                status = 0
            except SystemExit as error:
                status = error.code
        return status, calls, probe.call_count

    def test_checksum_failure_prevents_any_target_access(self):
        status, calls, probes = self.invoke(checksum="0" * 64)
        self.assertEqual((status, calls, probes), (1, [], 0))

    def test_target_identity_change_prevents_restore(self):
        status, calls, _ = self.invoke(target={**self.target, "database": "another_database"})
        self.assertEqual((status, calls), (1, []))

    def test_nonempty_destination_never_starts_restore(self):
        status, calls, _ = self.invoke(empty=b"1")
        self.assertEqual(status, 1)
        self.assertEqual(len(calls), 1)
        self.assertIn("psql", calls[0])

    def test_restore_is_single_transaction_and_has_no_destructive_flags(self):
        status, calls, _ = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 2)
        self.assertIn("postgres:18.6-alpine", calls[1])
        for flag in ("--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--no-tablespaces"):
            self.assertIn(flag, calls[1])
        for flag in ("--clean", "--create", "--disable-triggers"):
            self.assertNotIn(flag, calls[1])

    def test_pooled_connection_is_rejected_before_connecting(self):
        url = self.url.replace("ep-fixture.", "ep-fixture-pooler.")
        with patch("psycopg.connect", side_effect=AssertionError("No network expected")) as connection:
            with self.assertRaises(neon_preflight.PreflightError):
                neon_preflight.check_target(url)
            connection.assert_not_called()


if __name__ == "__main__":
    unittest.main()
