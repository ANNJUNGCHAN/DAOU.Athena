import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

for (const provider of ['claude', 'grok']) {
  test(`${provider} cold turn transports a 640KiB snapshot outside Windows argv and cleans up`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cold-transport-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const receiver = path.join(dir, 'receiver.cjs');
    fs.writeFileSync(receiver, `const fs=require('fs'),crypto=require('crypto');
const finish=s=>console.log(JSON.stringify({type:'result',is_error:false,result:crypto.createHash('sha256').update(s).digest('hex')}));
if(process.argv[2])finish(fs.readFileSync(process.argv[2]));else{let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>finish(s));}`);
    const prompt = '한글\n"quoted"\\path '.repeat(42000);
    let promptFile;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL(`./${provider}-runner.js`, import.meta.url), 'utf8'), {
      module, process, Buffer, setTimeout, clearTimeout,
      require: name => {
        if (name === './mcp-env') return { buildEnvOverrides: () => ({}) };
        if (name === 'child_process') return { spawn: (_bin, args, options) => {
          assert.ok(args.join(' ').length < 4000);
          assert.ok(!args.includes(prompt));
          if (provider === 'grok') {
            promptFile = args[args.indexOf('--prompt-file') + 1];
            assert.equal(fs.readFileSync(promptFile, 'utf8'), prompt);
          } else assert.equal(options.stdio[0], 'pipe');
          return spawn(process.execPath, [receiver, ...(promptFile ? [promptFile] : [])], options);
        } };
        return require(name);
      },
    });
    const run = module.exports[provider === 'grok' ? 'runGrokQuery' : 'runClaudeQuery'];
    const result = await run({ prompt, cwd: dir, claudeBin: 'fixture', grokBin: 'fixture', timeoutMs: 5000 });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.finalResult.result, createHash('sha256').update(prompt).digest('hex'));
    if (promptFile) assert.equal(fs.existsSync(path.dirname(promptFile)), false);
  });
}

for (const synchronous of [true, false]) {
  test(`Grok removes prompt snapshot after ${synchronous ? 'synchronous' : 'asynchronous'} spawn failure`, async () => {
    let promptFile;
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('./grok-runner.js', import.meta.url), 'utf8'), {
      module, process, Buffer, setTimeout, clearTimeout,
      require: name => {
        if (name === './mcp-env') return { buildEnvOverrides: () => ({}) };
        if (name === 'child_process') return { spawn: (_bin, args, options) => {
          promptFile = args[args.indexOf('--prompt-file') + 1];
          if (synchronous) throw new Error('fixture spawn failure');
          return spawn(path.join(path.dirname(promptFile), 'missing-executable.exe'), [], options);
        } };
        return require(name);
      },
    });
    const result = await module.exports.runGrokQuery({ prompt: 'private fixture', cwd: os.tmpdir(), grokBin: 'fixture', timeoutMs: 5000 });
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(path.dirname(promptFile)), false);
  });
}

for (const ending of ['close', 'error', 'throw']) {
  test(`Grok settles ${ending} even when snapshot cleanup is denied`, async t => {
    let snapshotDir;
    t.after(() => { if (snapshotDir) fs.rmSync(snapshotDir, { recursive: true, force: true }); });
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(new URL('./grok-runner.js', import.meta.url), 'utf8'), {
      module, process, Buffer, setTimeout, clearTimeout,
      require: name => {
        if (name === './mcp-env') return { buildEnvOverrides: () => ({}) };
        if (name === 'node:fs') return { ...fs, rmSync: (_dir, options) => {
          assert.equal(options.maxRetries, 2);
          throw Object.assign(new Error('held by scanner'), { code: 'EPERM' });
        } };
        if (name === 'child_process') return { spawn: (_bin, args) => {
          snapshotDir = path.dirname(args[args.indexOf('--prompt-file') + 1]);
          if (ending === 'throw') throw new Error('fixture spawn failed');
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough();
          queueMicrotask(() => {
            if (ending === 'error') child.emit('error', new Error('fixture process error'));
            else {
              child.stdout.write(`${JSON.stringify({ type: 'result', is_error: false, result: 'done' })}\n`);
              child.emit('close', 0);
            }
          });
          return child;
        } };
        return require(name);
      },
    });
    const result = await module.exports.runGrokQuery({ prompt: 'fixture', cwd: os.tmpdir(), grokBin: 'fixture', timeoutMs: 5000 });
    assert.equal(result.ok, ending === 'close');
    assert.match(result.promptCleanupError, /EPERM/);
  });
}
