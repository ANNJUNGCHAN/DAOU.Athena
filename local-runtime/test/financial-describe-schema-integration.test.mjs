import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createProtocolValidator,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../../contracts/wts-foundation.mjs';
import { compileFinancialArguments, compileFinancialFormDefinition } from '../../extension/src/sidepanel/financial-form.mjs';
import { normalizeSourceCard } from '../../extension/src/sidepanel/source-cards.mjs';
import { BackendSupervisor } from '../src/backend-supervisor.mjs';
import { encodeNativeMessage, NativeMessageDecoder } from '../src/framing.mjs';
import { createRequestHandler } from '../src/host.mjs';
import { SourceBridge } from '../src/source-bridge.mjs';

const BACKEND_ROOT = fileURLToPath(new URL('../../backend/', import.meta.url));
const PYTHON_EXECUTABLE = path.join(BACKEND_ROOT, '.venv', 'Scripts', 'python.exe');

async function removeOwnedTemporaryRoot(root, tempBase) {
  const value = await lstat(root);
  const physicalRoot = await realpath(root);
  const physicalBase = await realpath(tempBase);
  const expectedPrefix = `athena-wts-financial-describe-`;
  const insideBase = physicalRoot.startsWith(`${physicalBase}${path.sep}`);
  if (!value.isDirectory() || value.isSymbolicLink() || !insideBase ||
      !path.basename(physicalRoot).startsWith(expectedPrefix)) {
    return false;
  }
  await rm(physicalRoot, { recursive: true, maxRetries: 5, retryDelay: 100 });
  return true;
}

function decodeSingleFrame(frame) {
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);
  const payloads = decoder.push(frame);
  decoder.finish();
  assert.equal(payloads.length, 1);
  return JSON.parse(payloads[0].toString('utf8'));
}

test('all real readonly descriptions preserve canonical financial form schemas', {
  timeout: 120_000,
}, async () => {
  const tempBase = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(tempBase, 'athena-wts-financial-describe-'));
  const stateDir = path.join(root, 'metadata-child');
  const supervisor = new BackendSupervisor({
    backendRoot: BACKEND_ROOT,
    pythonExecutable: PYTHON_EXECUTABLE,
    stateDir,
    startTimeoutMs: 30_000,
    requestTimeoutMs: 10_000,
    stopTimeoutMs: 5_000,
  });
  let cleanupSafe = false;
  try {
    const schema = JSON.parse(await readFile(
      new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url),
      'utf8',
    ));
    const validator = createProtocolValidator(schema);
    const sourceBridge = new SourceBridge(supervisor);
    const signal = new AbortController().signal;
    const handleRequest = createRequestHandler({
      validator,
      store: {},
      planner: {},
      receiptStore: {},
      taskEngine: {},
      runtimeVersion: '0.8.0',
      backendSupervisor: supervisor,
      sourceBridge,
      signal,
    });

    const rawManifest = await supervisor.request('manifest', undefined, { signal });
    assert.equal(rawManifest.profile, 'wts-readonly-v1');
    assert.equal(rawManifest.apiVersion, 'selector-readonly-v1');
    assert.equal(rawManifest.operations.length, 264);
    const operationRefs = rawManifest.operations.map((operation) => operation.operation_ref);
    assert.equal(new Set(operationRefs).size, 264);

    const hello = await handleRequest({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'financial-schema-hello',
      method: 'runtime.hello',
      params: {},
    });
    assert.equal(hello.ok, true);
    assert.equal(hello.result.source.metadataOnly, true);
    assert.equal(hello.result.source.financialQuery, false);

    let fieldCount = 0;
    let nonNullableCount = 0;
    let nullableCount = 0;
    let framingCount = 0;
    let nullableExample = null;
    for (let index = 0; index < operationRefs.length; index += 1) {
      const response = await handleRequest({
        protocolVersion: PROTOCOL_VERSION,
        requestId: `financial-schema-${String(index).padStart(4, '0')}`,
        method: 'source.describe',
        params: {
          operationRef: operationRefs[index],
          expectedCatalogVersion: rawManifest.catalogVersion,
        },
      });
      assert.equal(
        response.ok,
        true,
        `${operationRefs[index]}: ${JSON.stringify(response.error ?? null)}`,
      );
      assert.equal(Buffer.byteLength(JSON.stringify(response), 'utf8') < MAX_MESSAGE_BYTES, true);
      const framed = decodeSingleFrame(encodeNativeMessage(response, MAX_MESSAGE_BYTES));
      assert.deepEqual(framed, response);
      framingCount += 1;

      const card = normalizeSourceCard(response.result);
      const definition = compileFinancialFormDefinition(card);
      const argumentFields = [...card.requiredArguments, ...card.optionalArguments];
      assert.equal(definition.fields.length, argumentFields.length);
      for (let fieldIndex = 0; fieldIndex < argumentFields.length; fieldIndex += 1) {
        const argument = argumentFields[fieldIndex];
        const formField = definition.fields[fieldIndex];
        assert.deepEqual(Object.keys(argument).sort(), [
          'alias', 'description', 'jsonSchema', 'required',
        ]);
        const schemaKeys = Object.keys(argument.jsonSchema).sort();
        if (schemaKeys.length === 1) {
          assert.deepEqual(argument.jsonSchema, { type: 'string' });
          assert.equal(formField.nullable, false);
          nonNullableCount += 1;
        } else {
          assert.deepEqual(argument.jsonSchema, {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            default: null,
          });
          assert.equal(formField.nullable, true);
          nullableCount += 1;
          if (!argument.required && nullableExample === null) {
            nullableExample = { definition, name: argument.alias };
          }
        }
        assert.equal(formField.name, argument.alias);
        assert.equal(formField.required, argument.required);
        fieldCount += 1;
      }
    }

    assert.equal(framingCount, 264);
    assert.equal(fieldCount, 697);
    assert.equal(nonNullableCount, 609);
    assert.equal(nullableCount, 88);
    assert.notEqual(nullableExample, null);

    const baseValues = Object.fromEntries(
      nullableExample.definition.fields
        .filter((field) => field.required)
        .map((field) => [field.name, { mode: 'value', value: 'required-value' }]),
    );
    const omitted = compileFinancialArguments(nullableExample.definition, baseValues);
    assert.equal(Object.hasOwn(omitted, nullableExample.name), false);
    const explicitNull = compileFinancialArguments(nullableExample.definition, {
      ...baseValues,
      [nullableExample.name]: { mode: 'null' },
    });
    assert.equal(explicitNull[nullableExample.name], null);
    const emptyString = compileFinancialArguments(nullableExample.definition, {
      ...baseValues,
      [nullableExample.name]: { mode: 'value', value: '' },
    });
    assert.equal(emptyString[nullableExample.name], '');
  } finally {
    await supervisor.stop().catch(() => {});
    cleanupSafe = await removeOwnedTemporaryRoot(root, tempBase).catch(() => false);
    if (!cleanupSafe) {
      process.stderr.write(`Owned integration temp directory was preserved: ${root}\n`);
    }
  }
  assert.equal(cleanupSafe, true);
});
