import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executeReleasePlan, executionDigest, PHASES } from '../scripts/lib/release-execution.ts';
import type { ExecutionConfig, ExecutionState, ReleaseDriver } from '../scripts/lib/release-execution.ts';
import type { ReleasePlan } from '../scripts/lib/release-plan.ts';
import { hash, writeJson, lockRepositories } from '../scripts/lib/release-io.ts';
import { createBundle, verifyBundle } from '../scripts/lib/release-candidates.ts';
import { runCommand } from '../scripts/lib/release-driver.ts';
import { createChain } from '../scripts/lib/release-chain.ts';
import { finish } from '../scripts/lib/release-finish.ts';
import { tasks } from '../scripts/lib/release-tasks.ts';
import type { DashboardReport } from '../scripts/lib/types.ts';

function fixture() {
  const plan: ReleasePlan = { schemaVersion: 1, mode: 'plan', ready: true, applyReady: true, target: 'b',
    snapshot: { generatedAt: '2026-11-20T00:00:00Z', sha256: 'a'.repeat(64) }, order: ['a', 'b'], publishTargets: [],
    steps: ['a', 'b'].map((repo, i) => ({ repo, repository: `family/${repo}`, name: `@family/${repo}`, headSha: String(i+1).repeat(40),
      currentVersion: '1.0.0', publishedVersion: '1.0.0', nextVersion: '1.1.0', versionChange: 'minor', action: 'publish',
      reasons: ['commits-ahead'], sourceChanges: 'ahead', issues: [], dependencyUpdates: i ? [{ field: 'dependencies', name: '@family/a',
        upstreamRepo: 'a', from: '1.0.0', to: '1.1.0', targetVersion: '1.1.0', source: 'planned' }] : [] })) };
  plan.publishTargets = plan.steps.map(s => ({repository: s.repository, name: s.name!, version: s.nextVersion!, tag: 'v1.1.0', headSha: s.headSha!}));
  const config: ExecutionConfig = { schemaVersion: 1, repositories: Object.fromEntries(plan.steps.map(s => [s.repository,
    { install: [['npm','ci']], verify: [['npm','test']], publish: {mode: 'tag-workflow', workflow: 'release.yml'} }])) };
  return {plan, config};
}

test('prepare stops before writes, gates downstream, and cannot bypass candidate approval', async () => {
  const dir=await mkdtemp(join(tmpdir(),'auto-'));
  try {
    const {plan,config}=fixture(); const events: string[]=[];
    const driver=Object.fromEntries(['preflight',...PHASES.slice(1)].map(p=>[p,async(s:any,e:any)=>{events.push(s.repo+':'+p);}])) as unknown as ReleaseDriver;
    const digest=executionDigest(plan,config);
    const state=await executeReleasePlan(plan,config,dir,()=>driver,digest,()=>{},2,{prepareOnly:true});
    assert.equal(state.entries.a.phase,'prepared'); assert.equal(state.entries.b.phase,'pending');
    assert(!events.includes('a:pushed')); assert(!events.includes('b:prepared'));
    await assert.rejects(executeReleasePlan(plan,config,dir,()=>driver,digest),/candidates/);
    await executeReleasePlan(plan,config,dir,()=>driver,digest,()=>{},2,{selected:['a']});
    assert(!events.includes('b:pushed'));
  } finally {await rm(dir,{recursive:true});}
});

test('repository leases span workspaces, preserve existing owners, and release partial acquisitions', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'locks-'));
  try {
    const release=await lockRepositories(dir,['family/b'],'one');
    await assert.rejects(lockRepositories(dir,['family/a','family/b'],'two'));
    const releaseA=await lockRepositories(dir,['family/a'],'three'); await releaseA();
    await assert.rejects(lockRepositories(dir,['family/b'],'three'));
    await release();
    const releaseB=await lockRepositories(dir,['family/b'],'two'); await releaseB();
  }
  finally {await rm(dir,{recursive:true});}
});

test('candidate digest binds diff, commit, public text and a clean checkout',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'candidate-'));
  try {
    const {plan,config}=fixture();
    plan.steps=plan.steps.slice(0,1);plan.order=['a'];plan.publishTargets=plan.publishTargets.slice(0,1);
    const cwd=join(dir,'checkouts','a');await mkdir(cwd,{recursive:true});
    const git=(a:string[])=>runCommand(['git',...a],{cwd,env:{GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}});
    await git(['init']);await writeFile(join(cwd,'a.txt'),'before');await git(['add','.']);await git(['commit','-m','before']);
    plan.steps[0].headSha=await git(['rev-parse','HEAD']);plan.publishTargets[0].headSha=plan.steps[0].headSha!;
    await writeFile(join(cwd,'a.txt'),'after');await git(['add','.']);await git(['commit','-m','after']);
    const state:ExecutionState={schemaVersion:1,digest:executionDigest(plan,config),entries:{a:{phase:'prepared',base:'main',branch:'work',commit:await git(['rev-parse','HEAD']),publication:{title:'Title',body:'Body',releaseBody:'Release'}}}};
    await writeJson(join(dir,'state.json'),state);
    const bundle=await createBundle(plan,config,dir,state);
    await verifyBundle(plan,config,dir,join(dir,'candidates.json'),bundle.digest);
    await writeFile(join(cwd,'a.txt'),'dirty');
    await assert.rejects(verifyBundle(plan,config,dir,join(dir,'candidates.json'),bundle.digest));
    await git(['restore','.']);
    state.entries.a.publication!.body='different';await writeJson(join(dir,'state.json'),state);
    await assert.rejects(verifyBundle(plan,config,dir,join(dir,'candidates.json'),bundle.digest));
  }
  finally {await rm(dir,{recursive:true});}
});

test('chain keeps a failed run distinct and never reuses its directory',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chain-'));
  try {
    const snapshot:DashboardReport={owner:'family',scope:'@family',site:{},categories:[],generatedAt:'2026-11-20T00:00:00Z',packages:[{repo:'a',label:'a',category:'test',note:null,errors:[],manifest:{name:'@family/a',version:'1.0.0',private:false,license:null},dependencies:[],npm:{name:'@family/a',published:true,latest:'1.0.0',versions:['1.0.0']},revision:{state:'released',head:{oid:'1'.repeat(40),committedDate:'2026-11-20T00:00:00Z'},tag:{name:'v1.0.0',oid:'1'.repeat(40),committedDate:'2026-11-20T00:00:00Z'},release:null,aheadBy:0}}]};
    const file=join(dir,'snapshot.json');await writeJson(file,snapshot);
    const target=join(dir,'run');let writes=0;
    await assert.rejects(createChain({workspace:target,data:file,roots:['a']},async cmd=>{assert.equal(cmd[0],'git');writes++;throw new Error('network');}));
    assert.equal(JSON.parse(await readFile(join(target,'result.json'),'utf8')).mode,'failed');
    await assert.rejects(access(join(target,'preview.json')));
    await assert.rejects(createChain({workspace:target,data:file,roots:['a']},async()=>{throw new Error('must not run');}));
    assert.equal(writes,1);
  }
  finally {await rm(dir,{recursive:true});}
});

test('Pages uncertain dispatch is not repeated; resume checks the same run and public versions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'finish-'));
  try {
    const {plan,config}=fixture();const digest=executionDigest(plan,config);
    await writeJson(join(dir,'state.json'),{schemaVersion:1,digest,entries:{a:{phase:'complete'},b:{phase:'complete'}}});
    let dispatches=0, done=false;
    const run=async(cmd:string[])=>{
      if(cmd[1]==='workflow'){dispatches++;return '';}
      if(cmd.at(-1)!.includes('workflow_dispatch'))return JSON.stringify({workflow_runs:[{id:123,display_title:`Dashboard ${digest}`,head_branch:'main',created_at:'9999-01-01T00:00:00Z'}]});
      return JSON.stringify({status:done?'completed':'in_progress',conclusion:done?'success':null});
    };
    await assert.rejects(finish(plan,config,dir,digest,run),/未完了/);
    done=true;
    const get=(async()=>new Response('<time datetime="9999-01-01T00:00:00Z"></time><tr data-repo="a" data-npm-version="1.1.0"><tr data-repo="b" data-npm-version="1.1.0">')) as typeof fetch;
    await finish(plan,config,dir,digest,run,get);
    assert.equal(dispatches,1);
    await assert.rejects(finish(plan,config,dir,'wrong',run,get));
  }
  finally {await rm(dir,{recursive:true});}
});

test('AI assignments run in separate checkouts and cannot silently approve worker findings', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'assign-'));
  try {
    const {plan}=fixture();
    const snapshot={generatedAt:'2026-11-20T00:00:00Z',owner:'family',scope:'@family',site:{},categories:[],packages:plan.steps.map(s=>({repo:s.repo,label:s.repo,category:'test',note:null,errors:[],manifest:{name:s.name!,version:'1.0.0',private:false,license:null},dependencies:s.dependencyUpdates.map(u=>({name:u.name,range:'1.0.0',kind:'prod',family:true,local:false,stale:false}))}))} as DashboardReport;
    plan.snapshot.sha256=hash(snapshot);
    const run=async(cmd:string[])=>{
      if(cmd[0]==='worker') {
        const assignment=JSON.parse(await readFile(cmd[1],'utf8'));
        assert(assignment.checkout.startsWith(dir));
        await writeJson(cmd[2],{repository:assignment.repository,inputSha:assignment.inputSha,findings:['evidence'],tests:['not run'],requiresReview:false});
      }
      return '';
    };
    const jobs=await tasks(plan,snapshot,join(dir,'jobs'),join(dir,'sources'),['worker'],run);
    assert(jobs.every(j=>j.status==='review'));
    assert(jobs.every(j=>(j.findings as any).requiresReview===true));
    assert.deepEqual(jobs[1].dependencies,['a']);
  }
  finally {await rm(dir,{recursive:true});}
});

test('chain succeeds with real immutable Git inputs without publishing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chain-ok-'));
  try {
    const source=join(dir,'source');await mkdir(source);
    const git=(a:string[])=>runCommand(['git',...a],{cwd:source,env:{GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}});
    await git(['init']);await mkdir(join(source,'.github','workflows'),{recursive:true});
    await writeFile(join(source,'package.json'),JSON.stringify({name:'@family/a',version:'1.0.0',scripts:{check:'true',build:'true'}}));
    await writeFile(join(source,'.github','workflows','release.yml'),'on:\n  push:\n    tags: ["v*"]\njobs:\n  publish:\n    permissions:\n      id-token: write\n    steps:\n      - run: npm ci\n      - run: npm publish --provenance\n');
    await git(['add','.']);await git(['commit','-m','input']);const sha=await git(['rev-parse','HEAD']);
    const snapshot={generatedAt:'2026-11-20T00:00:00Z',owner:'family',scope:'@family',site:{},categories:[],packages:[{repo:'a',label:'a',category:'test',note:null,errors:[],manifest:{name:'@family/a',version:'1.0.0',private:false,license:null},dependencies:[],npm:{name:'@family/a',published:true,latest:'1.0.0',versions:['1.0.0']},revision:{state:'released',head:{oid:sha,committedDate:'2026-11-20T00:00:00Z'},tag:{name:'v1.0.0',oid:sha,committedDate:null},release:null,aheadBy:0}}]};
    await writeJson(join(dir,'data.json'),snapshot);
    const run=async(cmd:string[],options?:any)=>{
      assert.equal(cmd[0],'git');assert(!['push','tag'].includes(cmd[1]));
      if(cmd[1]==='clone')cmd=cmd.map(v=>v==='https://github.com/family/a.git'?source:v);
      return runCommand(cmd,options);
    };
    const preview=await createChain({workspace:join(dir,'run'),data:join(dir,'data.json'),roots:['a']},run);
    assert.equal(preview.mode,'dry-run');assert.equal(preview.digest.length,64);
    assert.equal(JSON.parse(await readFile(join(dir,'run','result.json'),'utf8')).mode,'ready');
  }
  finally {await rm(dir,{recursive:true});}
});

test('a selected downstream is rejected before its dependencies finish',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'selected-'));
  try {
    const {plan,config}=fixture();let pushed=false;
    const driver=Object.fromEntries(['preflight',...PHASES.slice(1)].map(p=>[p,async()=>{if(p==='pushed')pushed=true;}])) as unknown as ReleaseDriver;
    await assert.rejects(executeReleasePlan(plan,config,dir,()=>driver,executionDigest(plan,config),()=>{},1,{selected:['b']}),/依存先/);
    assert.equal(pushed,false);
  } finally {await rm(dir,{recursive:true});}
});

test('an unchanged upstream is verified and unlocks candidate preparation',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'unchanged-'));
  try {
    const {plan,config}=fixture();plan.steps[0].action='none';plan.steps[0].nextVersion=null;plan.publishTargets.shift();
    plan.steps[1].dependencyUpdates[0].source='published';plan.steps[1].dependencyUpdates[0].targetVersion='1.0.0';
    const events:string[]=[];
    const driver=Object.fromEntries(['preflight',...PHASES.slice(1)].map(p=>[p,async(s:any)=>{events.push(s.repo+':'+p);}])) as unknown as ReleaseDriver;
    const state=await executeReleasePlan(plan,config,dir,()=>driver,executionDigest(plan,config),()=>{},1,{prepareOnly:true});
    assert.equal(state.entries.a.phase,'complete');assert.equal(state.entries.b.phase,'prepared');
    assert(events.indexOf('a:complete')<events.indexOf('b:prepared'));
  } finally {await rm(dir,{recursive:true});}
});
