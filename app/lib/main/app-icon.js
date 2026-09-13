'use strict';

const fs = require('fs');
const path = require('path');

function appIconPath(appRoot = path.join(__dirname, '..', '..')) {
  const png = path.join(appRoot, 'data', 'athena-icon.png');
  return fs.existsSync(png) ? png : null;
}

function appTrayIconPath(appRoot = path.join(__dirname, '..', '..'), platform = process.platform) {
  const dir = path.join(appRoot, 'data');
  const ico = path.join(dir, 'athena-icon.ico');
  const png = path.join(dir, 'athena-icon.png');
  if (platform === 'win32' && fs.existsSync(ico)) return ico;
  if (fs.existsSync(png)) return png;
  return fs.existsSync(ico) ? ico : null;
}

module.exports = { appIconPath, appTrayIconPath };
