#!/usr/bin/env python3
"""Negative tests prove unsafe invocation stops before any subprocess/SQL."""
import contextlib
import copy
import json
from types import SimpleNamespace
import importlib.util
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

path=Path(__file__).with_name('test-external-guard-adoption-native.py')
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
        for key in ('DATABASE_URL','SUPABASE_DB_URL','POSTGRES_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):
            self.rejects_without_execution({'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted',key:'production-shaped.invalid'},['--disposable-ci-postgres'])
    def test_rejects_unsafe_container_before_any_sql(self):
        base={'Config':{'Image':'postgres:17','Labels':{'com.dvnt.test-purpose':'external-guard-adoption-ci'}},'HostConfig':{'NetworkMode':'none','Privileged':False,'Binds':None,'Mounts':None},'State':{'Running':True},'Mounts':[]}
        variants=[]
        for field,value in [('NetworkMode','host'),('Privileged',True),('Binds',['/existing/data:/var/lib/postgresql/data']),('Mounts',[{'Type':'bind'}])]:
            candidate=copy.deepcopy(base);candidate['HostConfig'][field]=value;variants.append(candidate)
        candidate=copy.deepcopy(base);candidate['Config']['Image']='custom-production-db';variants.append(candidate)
        candidate=copy.deepcopy(base);candidate['Config']['Labels']={};variants.append(candidate)
        candidate=copy.deepcopy(base);candidate['Mounts']=[{'Type':'volume','Name':'production-data'}];variants.append(candidate)
        for candidate in variants:
            with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'},clear=True),patch.object(sys,'argv',[str(path),'--disposable-ci-postgres']),patch.object(module.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps([candidate]))) as run,contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):module.main()
                run.assert_called_once()
                self.assertEqual(run.call_args.args[0],['docker','--context','default','inspect','dvnt-external-adoption-ci'])
    def test_no_database_url_argument_is_supported(self):
        self.rejects_without_execution({'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted'},['--disposable-ci-postgres','--database-url','postgresql://production-shaped.invalid/dvnt'])

if __name__=='__main__':
    unittest.main()
