'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function dependency(name){try{return require(name)}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;return require(path.join(process.env.ATHENA_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),name))}}
const command=(name,env)=>process.env[env]||(fs.existsSync(path.resolve(__dirname,'../../tools/ffmpeg',name+'.exe'))?path.resolve(__dirname,'../../tools/ffmpeg',name+'.exe'):name);
module.exports={dependency,ffmpeg:command('ffmpeg','FFMPEG_PATH'),ffprobe:command('ffprobe','FFPROBE_PATH')};
