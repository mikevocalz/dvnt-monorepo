#!/usr/bin/env python3
"""Negative tests prove unsafe invocation stops before any subprocess/SQL."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

path=Path(__file__).with_name('test-external-receipt-guard-concurrency.py')
spec=importlib.util.spec_from_file_location('guard_races',path)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TargetSafety(unittest.TestCase):
    def rejects_without_execution(self,env,args):
        with patch.dict(os.environ,env,clear=True),patch.object(sys,'argv',[str(path),*args]),patch.object(module.subprocess,'run') as run,contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                module.main()
            self.assertNotEqual(caught.exception.code,0)
            run.assert_not_called()
    def test_requires_explicit_flag(self):
        self.rejects_without_execution({'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'},[])
    def test_rejects_local_and_self_hosted(self):
        for env in ({},{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'self-hosted'}):
            self.rejects_without_execution(env,['--disposable-ci-postgres'])
    def test_rejects_any_database_url_or_routing_variable(self):
        for key in ('DATABASE_URL','SUPABASE_DB_URL','POSTGRES_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE'):
            self.rejects_without_execution({'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted',key:'production-shaped.invalid'},['--disposable-ci-postgres'])
    def test_no_database_url_argument_is_supported(self):
        self.rejects_without_execution({'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'},['--disposable-ci-postgres','--database-url','postgresql://production-shaped.invalid/dvnt'])

if __name__=='__main__':
    unittest.main()
