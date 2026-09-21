import test from 'node:test';
import assert from 'node:assert/strict';
Object.defineProperty(globalThis, 'location', {configurable:true, value:{hash:''}});
const { convertToCheckbox } = await import('../src/ops.ts');
const { useStore } = await import('../src/store.ts');
import { findBullet, updateBullet } from '../src/tree.ts';
import type { OutlineFile } from '../src/types.ts';

test('collapsed folder conversion persists one level and undo/redo restores the whole action', async () => {
  const files: Record<string, OutlineFile> = {
    '/root.lister': { path: '/root.lister', id: 'root', name: 'Root', bullets: [{id:'parent', text:'Projects', folder:'/projects', children:[]}] },
    '/projects/projects.lister': { path: '/projects/projects.lister', id: 'childfile', name:'Projects', bullets:[
      {id:'child', text:'Task', children:[{id:'grandchild', text:'Leave alone', children:[]}]},
      {id:'checked', text:'[checked:Finished]', children:[]},
    ] },
  };
  const original = structuredClone(files);
  const previousFetch = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:()=>null}});
  // Transport fixture: keep the real operation, API, store and undo stack.
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/files') return Response.json(files[url.searchParams.get('path')!]);
    const id = url.pathname.split('/').at(-1)!;
    for (const file of Object.values(files)) {
      const found = findBullet(file.bullets, id);
      if (!found) continue;
      if (options?.method === 'PATCH') {
        file.bullets = updateBullet(file.bullets, id, JSON.parse(String(options.body)));
        return Response.json(findBullet(file.bullets,id)!.bullet);
      }
      return Response.json({bullet:found.bullet,filePath:file.path,fileName:file.name,parentId:found.parent?.id??null,index:found.index});
    }
    return Response.json({error:'Not found'}, {status:404});
  };
  try {
    useStore.setState({files:{'/root.lister':structuredClone(files['/root.lister'])}, undoStack:[], redoStack:[], expandedFolders:{},error:null});
    await convertToCheckbox('/root.lister', 'parent');
    assert.equal(files['/root.lister'].bullets[0].text, '[checkbox:Projects]');
    assert.equal(files['/projects/projects.lister'].bullets[0].text, '[checkbox:Task]');
    assert.equal(files['/projects/projects.lister'].bullets[0].children[0].text, 'Leave alone');
    assert.equal(files['/projects/projects.lister'].bullets[1].text, '[checked:Finished]');
    assert.equal(useStore.getState().undoStack.length, 1);
    assert.equal(useStore.getState().error, null);
    await useStore.getState().undo();
    assert.deepEqual(files, original);
    await useStore.getState().redo();
    assert.equal(files['/projects/projects.lister'].bullets[0].text, '[checkbox:Task]');
  } finally {
    globalThis.fetch=previousFetch;
    if(storage) Object.defineProperty(globalThis,'localStorage',storage);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
