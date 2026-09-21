import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '../src/hive/http.ts';
import { StartupContent, startupErrorMessage } from '../src/components/StartupContent.tsx';

test('authentication is presented by login while actual connectivity failures retain retry',()=>{
 assert.equal(startupErrorMessage(new ApiError(401,'Sign in')),null);
 assert.match(startupErrorMessage(new TypeError('Failed to fetch'))!,/Cannot reach.*Failed to fetch/);
 const render=(authRequired:boolean,error:string|null,ready=false)=>renderToStaticMarkup(createElement(StartupContent,{authRequired,error,ready,onRetry:()=>{}},'Saved outline'));
 assert.equal(render(true,null),'');
 assert.equal(render(true,'Old failure'),'');
 assert.match(render(false,'Network unavailable'),/Network unavailable.*Retry connection/);
 assert.equal(render(true,null,true),'Saved outline');
});
