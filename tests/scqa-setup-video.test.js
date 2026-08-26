const assert = require('node:assert/strict');
const fs = require('node:fs');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const contextFlow = fs.readFileSync('assets/exercise-context-flow.js', 'utf8');
const appHeader = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const newFileId = '1qrngkvMOp3wkzrPnIuIe2CX9z7Tk1_NU';
const oldFileId = '168tYlq9fRUKl7NrlELHuwAPwAxC2_5yD';

assert(workspace.includes(newFileId), 'Learning Journey uses the new SCQA setup video');
assert(contextFlow.includes(newFileId), 'direct SCQA setup flow uses the new video');
assert(admin.includes(newFileId), 'Admin content defaults use the new video');
assert(appHeader.includes('exercise-context-flow.js?v=20260803-scqa-video-1'), 'shared setup loader bypasses the cached former context');
assert(scqa.includes('app-reward-header.js?v=20260803-scqa-video-1'), 'SCQA bypasses its cached former setup loader');
assert(workspace.includes(oldFileId), 'member settings migrate the former built-in video');
assert(admin.includes(`/${oldFileId}/.test(existing.url)`), 'admin settings migrate the former built-in video');

console.log('SCQA setup video source and migration contracts passed');
