#!/usr/bin/env python3
"""Capture real watchOS renders. Design treatments are synthetic DEBUG fixtures.
Creates one disposable simulator at a time; preserves the existing 41mm device.
"""
import argparse, pathlib, subprocess, time, json
p=argparse.ArgumentParser(); p.add_argument('--app',required=True); p.add_argument('--output',required=True); p.add_argument('--sizes',default='40mm,41mm,45mm,49mm'); p.add_argument('--states',default='unpaired,largest-type,treatment-a,treatment-b'); args=p.parse_args()
out=pathlib.Path(args.output).resolve(); out.mkdir(parents=True,exist_ok=True)
def run(*parts,check=True):
 return subprocess.run(['xcrun','simctl',*parts],text=True,capture_output=True,check=check).stdout.strip()
runtime='com.apple.CoreSimulator.SimRuntime.watchOS-26-4'
sizes=[('40mm','Apple-Watch-SE-3-40mm'),('41mm','Apple-Watch-Series-9-41mm'),('45mm','Apple-Watch-Series-9-45mm'),('49mm','Apple-Watch-Ultra-2-49mm')]
records=[]
variants=[('unpaired',[]),('largest-type',['--watch-qa-largest']),('treatment-a',['--watch-qa-treatment-a','--watch-qa-expanded-door']),('treatment-b',['--watch-qa-treatment-b'])]
for screen in ['inbox','conversation','event','ticket']:
 for treatment in ['a','b']:
  variants.append((screen+'-'+treatment,['--watch-qa-native','--watch-qa-screen='+screen]+(['--watch-qa-expanded-door'] if treatment=='a' else [])))
for label,kind in sizes:
 if label not in args.sizes.split(','): continue
 udid=run('create','DVNT v2 disposable capture '+label,'com.apple.CoreSimulator.SimDeviceType.'+kind,runtime)
 try:
  run('boot',udid); run('bootstatus',udid,'-b'); run('install',udid,str(pathlib.Path(args.app).resolve()))
  for state,flags in variants:
   if state not in args.states.split(','): continue
   run('terminate',udid,'com.dvnt.app.watchkitapp',check=False)
   run('launch',udid,'com.dvnt.app.watchkitapp',*flags)
   time.sleep(2)
   path=out/f'apple-watch-{label}-{state}.png'
   run('io',udid,'screenshot',str(path))
   records.append({'size':label,'state':state,'file':path.name,'synthetic':state not in ['unpaired','largest-type'],'paired':False})
   print(path,flush=True)
 finally:
  run('shutdown',udid,check=False); run('delete',udid,check=False)
manifest=out/'capture-manifest.json'
prior=json.loads(manifest.read_text()) if manifest.exists() else []
files={r['file'] for r in records}
manifest.write_text(json.dumps([r for r in prior if r['file'] not in files]+records,indent=2)+'\n')
