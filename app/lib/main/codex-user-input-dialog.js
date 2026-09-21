'use strict';

// Serialize native prompts across conversations; choices belong to their original turn.
let dialogTail = Promise.resolve();

function validateQuestions(params) {
  const questions = params?.questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    throw new Error('Unsupported Codex question count');
  }
  const ids = new Set();
  for (const question of questions) {
    if (!question || typeof question.id !== 'string' || !question.id || ids.has(question.id)
      || typeof question.question !== 'string' || !question.question
      || question.isSecret === true || !Array.isArray(question.options)
      || question.options.length < 1 || question.options.length > 8) {
      throw new Error('Unsupported Codex question');
    }
    ids.add(question.id);
    const labels = new Set();
    for (const option of question.options) {
      if (typeof option?.label !== 'string' || !option.label || labels.has(option.label)
        || typeof option.description !== 'string') throw new Error('Unsupported Codex option');
      labels.add(option.label);
    }
  }
  return questions;
}

function createCodexUserInputDialog({ dialog, getWindow }) {
  return (params, { signal } = {}) => {
    const run = async () => {
      if (params?.mode !== undefined) {
        // CLI 0.155.1 requests MCP call approval as an empty standard form.
        // Other forms (including credentials, URLs and device verification) need
        // dedicated controls; never silently accept fields we cannot display.
        const schema = params.requestedSchema;
        if (params.serverName !== 'athena' || params.mode !== 'form'
          || typeof params.message !== 'string' || !params.message.trim()
          || !schema || schema.type !== 'object'
          || (schema.properties !== undefined && (!schema.properties || Array.isArray(schema.properties)
            || typeof schema.properties !== 'object' || Object.keys(schema.properties).length !== 0))
          || (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length !== 0))) {
          throw new Error('Unsupported Codex MCP approval form');
        }
        const window = getWindow();
        if (signal?.aborted || !window || window.isDestroyed()) throw new Error('Codex prompt cancelled');
        const result = await dialog.showMessageBox(window, {
          type: 'question', title: 'Athena · 도구 실행 확인',
          message: 'Codex가 Athena 도구 실행 승인을 요청했습니다.',
          detail: params.message,
          buttons: ['이번 호출 허용', '거절', '취소'], defaultId: 2, cancelId: 2,
          noLink: true, signal,
        });
        if (signal?.aborted) throw new Error('Codex prompt cancelled');
        const action = result.response === 0 ? 'accept' : result.response === 1 ? 'decline' : 'cancel';
        return { action, content: action === 'accept' ? {} : null };
      }
      const questions = validateQuestions(params);
      const answers = Object.create(null);
      for (const question of questions) {
        const window = getWindow();
        if (signal?.aborted || !window || window.isDestroyed()) throw new Error('Codex prompt cancelled');
        const cancelId = question.options.length;
        const result = await dialog.showMessageBox(window, {
          type: 'question', title: 'Athena · Codex 확인',
          message: question.question,
          detail: [question.header || '', ...question.options.map((option) => `${option.label}: ${option.description}`)].join('\n\n'),
          buttons: [...question.options.map((option) => option.label), '요청 취소'],
          defaultId: cancelId, cancelId, noLink: true, signal,
        });
        if (signal?.aborted || !Number.isInteger(result.response)
          || result.response < 0 || result.response >= cancelId) throw new Error('Codex prompt cancelled');
        answers[question.id] = { answers: [question.options[result.response].label] };
      }
      return { answers };
    };
    const result = dialogTail.then(run, run);
    dialogTail = result.catch(() => {});
    return result;
  };
}

module.exports = { createCodexUserInputDialog, validateQuestions };
