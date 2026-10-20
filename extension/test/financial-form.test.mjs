import test from "node:test";
import assert from "node:assert/strict";
import { compileFinancialArguments, compileFinancialFormDefinition } from "../src/sidepanel/financial-form.mjs";

test("form compiler preserves omitted, null, empty, and non-empty strings exactly", () => {
  const definition = compileFinancialFormDefinition({
    operationRef: "base:test",
    domain: "quotes",
    name: "테스트 조회",
    requiredArguments: [{ alias: "required_value", required: true, jsonSchema: { type: "string" } }],
    optionalArguments: [
      { alias: "omitted", required: false, jsonSchema: { type: "string" } },
      { alias: "nullable", required: false, jsonSchema: { anyOf: [{ type: "string" }, { type: "null" }], default: null } },
      { alias: "empty", required: false, jsonSchema: { type: "string" } },
    ],
  });
  assert.deepEqual(compileFinancialArguments(definition, {
    required_value: { mode: "value", value: "005930" },
    omitted: { mode: "omit", value: "ignored" },
    nullable: { mode: "null", value: "ignored" },
    empty: { mode: "value", value: "" },
  }), { required_value: "005930", nullable: null, empty: "" });
});

test("compiler handles a synthetic 697-field string/nullable boundary fixture", () => {
  let compiled = 0;
  for (let operation = 0; operation < 11; operation += 1) {
    const count = operation === 10 ? 57 : 64;
    const requiredArguments = Array.from({ length: count }, (_, index) => ({
      alias: `f_${operation}_${index}`,
      required: true,
      jsonSchema: index % 8 === 0 ? { anyOf: [{ type: "string" }, { type: "null" }], default: null } : { type: "string" },
    }));
    const definition = compileFinancialFormDefinition({
      operationRef: `base:operation${operation}`,
      domain: "quotes",
      name: `operation ${operation}`,
      requiredArguments,
      optionalArguments: [],
    });
    compiled += definition.fields.length;
  }
  assert.equal(compiled, 697);
});

test("non-nullable and missing required values fail before transport", () => {
  const definition = compileFinancialFormDefinition({
    operationRef: "base:test",
    domain: "quotes",
    requiredArguments: [{ alias: "stk_cd", required: true, jsonSchema: { type: "string" } }],
    optionalArguments: [],
  });
  assert.throws(() => compileFinancialArguments(definition, {}), /입력이 필요/);
  assert.throws(() => compileFinancialArguments(definition, { stk_cd: { mode: "null" } }), /null을 허용하지/);
});

test("form compiler accepts only canonical camel-case string schemas", () => {
  assert.throws(() => compileFinancialFormDefinition({
    operationRef: "base:missing", domain: "quotes", requiredArguments: [{ alias: "stk_cd", required: true }], optionalArguments: [],
  }), /스키마가 제공되지/);
  assert.throws(() => compileFinancialFormDefinition({
    operationRef: "base:ambiguous",
    domain: "quotes",
    requiredArguments: [{ alias: "value", required: true, jsonSchema: { anyOf: [{ type: "string" }, { type: "integer" }] } }],
    optionalArguments: [],
  }), /nullable/);
  assert.throws(() => compileFinancialFormDefinition({
    operationRef: "base:snake", domain: "quotes", requiredArguments: [{
      alias: "stk_cd", required: true, json_schema: { type: "string" },
    }], optionalArguments: [],
  }), /스키마가 제공되지/);
  assert.throws(() => compileFinancialFormDefinition({
    operationRef: "base:extra", domain: "quotes", requiredArguments: [{
      alias: "stk_cd", required: true, jsonSchema: { type: "string", title: "extra" },
    }], optionalArguments: [],
  }), /nullable/);
});

test("form compiler preserves domain and classifies account, password, and PIN aliases as sensitive", () => {
  const account = compileFinancialFormDefinition({
    operationRef: "base:account", domain: "account",
    requiredArguments: [
      { alias: "stk_cd", required: true, jsonSchema: { type: "string" } },
      { alias: "acnt_no", required: true, jsonSchema: { type: "string" } },
    ], optionalArguments: [],
  });
  assert.equal(account.domain, "account");
  assert.equal(account.fields.every((field) => field.sensitive), true);

  const quotes = compileFinancialFormDefinition({
    operationRef: "base:quotes", domain: "quotes",
    requiredArguments: [
      { alias: "stk_cd", required: true, jsonSchema: { type: "string" } },
      { alias: "account_no", required: true, jsonSchema: { type: "string" } },
      { alias: "trade_pwd", required: true, jsonSchema: { type: "string" } },
      { alias: "pin_no", required: true, jsonSchema: { type: "string" } },
    ], optionalArguments: [],
  });
  assert.deepEqual(quotes.fields.map((field) => field.sensitive), [false, true, true, true]);
});
