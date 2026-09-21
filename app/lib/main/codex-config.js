// Codex 인증과 모델 설정은 모두 Athena 전용 codex-runtime 홈에 보관한다.
// 최초 설정 파일이 없을 때만 기존 공용 설정의 모델·강도 두 키를 가져온다.
// 공용 파일은 수정하지 않으며 private 파일의 주석·다른 설정은 보존한다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isValidModel } = require('./model-prefs');

// codex config model_reasoning_effort 화이트리스트 — model-prefs.js의 claude
// 화이트리스트(low/medium/high/xhigh/max)와 다르다. 여기서 독립적으로 정의한다
// (model-prefs.js는 이제 claude 전용이라 codex 값을 모른다).
const CODEX_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

function isValidCodexEffort(effort) {
  return typeof effort === 'string' && CODEX_EFFORTS.has(effort);
}

function createCodexConfig({ fsImpl = fs, osImpl = os, env = process.env, userDataPath } = {}) {
const fs = fsImpl;
function codexHome() {
  const dataPath = userDataPath || require('electron').app.getPath('userData');
  return path.join(dataPath, 'codex-runtime');
}

function configPath() {
  return path.join(codexHome(), 'config.toml');
}

// `key = value` 라인의 value 쪽을 해석한다 — 따옴표(작은/큰) 문자열이면 안쪽만,
// 안 따옴표면 인라인 주석(#) 이전까지 트림해서 돌려준다. 못 읽으면 null.
function unquoteValue(raw) {
  const v = raw.trim();
  if (!v) return null;
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1);
    if (end === -1) return null;
    return v.slice(1, end);
  }
  const hashIdx = v.indexOf('#');
  const bare = (hashIdx === -1 ? v : v.slice(0, hashIdx)).trim();
  return bare || null;
}

// trimmed 라인이 최상위 `<key> = ...` 형태인지 — "model"과 "model_reasoning_effort"를
// 서로 오독하지 않는다("model" 뒤에 공백/`=`가 바로 와야 매치되므로 "model_..."은
// "model" 키로 안 걸린다).
function isKeyLine(trimmedLine, key) {
  const re = new RegExp(`^${key}\\s*=`);
  return re.test(trimmedLine);
}

// 지정한 파일의 최상위 모델·강도만 읽는다. 읽을 수 없으면 exists:false다.
function readSettingsFile(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch {
    return { model: null, effort: null, exists: false };
  }
  const lines = raw.split(/\r\n|\n/);
  let inTopLevel = true;
  let model = null;
  let effort = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^\[/.test(t)) { inTopLevel = false; continue; }
    if (!inTopLevel) continue;
    if (isKeyLine(t, 'model')) {
      model = unquoteValue(t.slice(t.indexOf('=') + 1));
      continue;
    }
    if (isKeyLine(t, 'model_reasoning_effort')) {
      effort = unquoteValue(t.slice(t.indexOf('=') + 1));
    }
  }
  return { model, effort, exists: true };
}

// This is the private CLI's last fetched picker list, not proof of current account access.
// Account changes can make it stale; actual provider failures remain authoritative.
function readModelCatalog() {
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8'));
    const models = [...new Set((Array.isArray(cached.models) ? cached.models : [])
      .filter(item => item?.visibility === 'list' && isValidModel(item.slug))
      .map(item => item.slug))];
    return { status: models.length ? 'cached' : 'unavailable', models };
  } catch { return { status: 'unavailable', models: [] }; }
}

function ensurePrivateConfig() {
  const target = configPath();
  if (fs.existsSync(target)) return;
  const legacy = readSettingsFile(path.join(env.CODEX_HOME || path.join(osImpl.homedir(), '.codex'), 'config.toml'));
  const lines = [];
  if (legacy.model && isValidModel(legacy.model)) lines.push(`model = ${JSON.stringify(legacy.model)}`);
  if (isValidCodexEffort(legacy.effort)) lines.push(`model_reasoning_effort = ${JSON.stringify(legacy.effort)}`);
  fs.mkdirSync(codexHome(), { recursive: true });
  try {
    // Exclusive creation preserves another settings writer's first selection.
    fs.writeFileSync(target, lines.length ? `${lines.join('\n')}\n` : '', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function readModelSettings() {
  ensurePrivateConfig();
  return readSettingsFile(configPath());
}

// athena:model-set({provider:'codex', patch}) → { ok:true, model, effort } |
// { ok:false, error }. patch.model/patch.effort가 null이면 그 라인을 제거한다
// (기본값으로 되돌림 = codex CLI 자체 기본값을 쓰겠다는 뜻). patch에 없는 키는
// 건드리지 않는다. 검증 실패면 파일을 전혀 건드리지 않고 거부한다(부분 적용 없음).
function writeModelSettings(patch = {}) {
  if ('model' in patch && patch.model !== null && !isValidModel(patch.model)) {
    return { ok: false, error: 'invalid-model' };
  }
  if ('effort' in patch && patch.effort !== null && !isValidCodexEffort(patch.effort)) {
    return { ok: false, error: 'invalid-effort' };
  }

  if (patch.model != null) {
    const current = readSettingsFile(configPath());
    const catalog = readModelCatalog();
    if (patch.model !== current.model && !catalog.models.includes(patch.model)) {
      return { ok: false, error: catalog.models.length
        ? 'Codex CLI 저장 목록에 없는 모델입니다. 목록에서 모델을 선택해 주세요.'
        : 'Codex 모델 목록을 확인하지 못했습니다. Codex 로그인·네트워크를 확인하고 앱을 다시 시작해 주세요.' };
    }
  }
  ensurePrivateConfig();
  const p = configPath();
  let raw = '';
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch {
    raw = '';
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.length ? raw.split(/\r\n|\n/) : [];

  // 이번 호출에서 새로 삽입한 라인 다음 자리를 기억해, model·effort를 둘 다
  // 새로 추가할 때 파일 맨 위(주석 뒤)에 나란히 붙게 한다(둘 다 매번 "주석
  // 바로 뒤"를 다시 계산하면 나중 키가 먼저 온 키 위로 끼어든다).
  let nextInsertAt = null;

  function findTopLevelIndex(key) {
    let inTop = true;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^\[/.test(t)) { inTop = false; continue; }
      if (!inTop) continue;
      if (isKeyLine(t, key)) return i;
    }
    return -1;
  }

  function leadingCommentSkip() {
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('#')) { i++; continue; }
      break;
    }
    return i;
  }

  function applyKey(key, value) {
    const foundIdx = findTopLevelIndex(key);
    if (value === null) {
      if (foundIdx !== -1) lines.splice(foundIdx, 1);
      return;
    }
    const newLine = `${key} = ${JSON.stringify(value)}`;
    if (foundIdx !== -1) {
      lines[foundIdx] = newLine;
      return;
    }
    const insertAt = nextInsertAt !== null ? nextInsertAt : leadingCommentSkip();
    lines.splice(insertAt, 0, newLine);
    nextInsertAt = insertAt + 1;
  }

  if ('model' in patch) applyKey('model', patch.model);
  if ('effort' in patch) applyKey('model_reasoning_effort', patch.effort);

  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = lines.length ? lines.join(eol) : '';
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);

  return { ok: true, ...readModelSettings() };
}

return { codexHome, configPath, readModelSettings, writeModelSettings, readModelCatalog };
}

const defaultConfig = createCodexConfig();
module.exports = { ...defaultConfig, createCodexConfig, isValidCodexEffort };
