'use strict';

const fs = require('fs');
const path = require('path');

function appIconPath(appRoot = path.join(__dirname, '..', '..')) {
  const png = path.join(appRoot, 'data', 'athena-icon.png');
  return fs.existsSync(png) ? png : null;
}

module.exports = { appIconPath };
