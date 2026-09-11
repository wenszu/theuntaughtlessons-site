const assert = require('node:assert/strict');
const fs = require('node:fs');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const contextFlow = fs.readFileSync('assets/exercise-context-flow.js', 'utf8');
const appHeader = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const newFileId = '1224507800';
const oldFileId = '168tYlq9fRUKl7NrlELHuwAPwAxC2_5yD';

assert(workspace.includes(newFileId), 'Learning Journey uses the new SCQA setup video');
assert(contextFlow.includes(newFileId), 'direct SCQA setup flow uses the new video');
assert(admin.includes(newFileId), 'Admin content defaults use the new video');
assert(/exercise-context-flow\.js\?v=[\w-]+/.test(appHeader), 'shared setup loader cache-busts its context flow import');
assert(/app-reward-header\.js\?v=[\w-]+/.test(scqa), 'SCQA loads the shared reward header with a cache-busting version string');
assert(workspace.includes(oldFileId), 'member settings migrate the former built-in video');
assert(admin.includes(`/${oldFileId}/.test(existing.url)`), 'admin settings migrate the former built-in video');

console.log('SCQA setup video source and migration contracts passed');
