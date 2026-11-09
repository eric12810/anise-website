#!/usr/bin/env python3
"""Resolve one successful, deployed staging release through the GitHub API."""
import json, os, sys, urllib.request
repo=os.environ.get('GITHUB_REPOSITORY',''); token=os.environ.get('GITHUB_TOKEN',''); run_id=os.environ.get('STAGING_RUN_ID','')
if not repo or not token or not run_id.isdigit(): raise SystemExit('A numeric staging Run ID and GitHub token are required')
def get(path):
    req=urllib.request.Request('https://api.github.com/repos/'+repo+path, headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(req, timeout=20) as r: return json.load(r)
run=get('/actions/runs/'+run_id)
if run.get('repository',{}).get('full_name') != repo or run.get('head_branch') != 'staging' or run.get('status') != 'completed' or run.get('conclusion') != 'success': raise SystemExit('Run is not a successful staging run for this repository')
workflow=get('/actions/workflows/'+str(run.get('workflow_id')))
if workflow.get('path') != '.github/workflows/staging-preview.yml' or workflow.get('name') != 'Staging file preview': raise SystemExit('Run is not the approved automatic staging release workflow')
expected='anise-website-staging-release-'+run.get('head_sha','')
matches=[a for a in get('/actions/runs/'+run_id+'/artifacts').get('artifacts',[]) if a.get('name') == expected and not a.get('expired')]
if len(matches) != 1: raise SystemExit('Expected one non-expired staging release artifact; found '+str(len(matches)))
with open(os.environ['GITHUB_OUTPUT'],'a') as f: f.write('artifact_name='+expected+'\ncommit_sha='+run['head_sha']+'\n')
print('Resolved approved deployed staging release '+expected)
