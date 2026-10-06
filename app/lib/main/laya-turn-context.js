'use strict';

// Match the provider prompt's mode scope. Hidden screen caches are not context
// for this turn and can exhaust the classifier's bounded input budget.
function buildLayaTurnContext(input) {
  const { graphContext, agentContext, pluginContext, ...context } = input;
  if (context.canvasMode === 'graph') context.graphContext = graphContext;
  if (context.canvasMode === 'agent') context.agentContext = agentContext;
  if (context.canvasMode === 'plugin') context.pluginContext = pluginContext;
  return context;
}

module.exports = { buildLayaTurnContext };
