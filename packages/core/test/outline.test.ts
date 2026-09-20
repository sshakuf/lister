import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { parseOutline, serializeOutline } from "../src/outline.ts";

const SAMPLE = `# Bugs [id:aaaaaaaa] [parent:bbbbbbbb]
- Login fails [id:c0000001] [date:2027-09-15] [priority:1]
  Some note line
  second note line
  - Only on Safari [id:c0000002]
    - Reproduced [id:c0000003] [done:2026-09-19]
- Ideas [id:c0000004] [folder:~/proj]
- Plain [bold:styled] text [id:c0000005]
`;

test("round-trip is byte identical", () => {
  const { file, healed } = parseOutline(SAMPLE, "/x/bugs.lister");
  assert.equal(healed, false);
  assert.equal(file.name, "Bugs");
  assert.equal(file.id, "aaaaaaaa");
  assert.equal(file.parentId, "bbbbbbbb");
  assert.equal(file.bullets.length, 3);
  const login = file.bullets[0];
  assert.equal(login.text, "Login fails");
  assert.equal(login.note, "Some note line\nsecond note line");
  assert.equal(login.date, "2027-09-15");
  assert.equal(login.priority, 1);
  assert.equal(login.children[0].children[0].done, "2026-09-19");
  assert.equal(file.bullets[1].folder, `${os.homedir()}/proj`);
  assert.equal(file.bullets[2].text, "Plain [bold:styled] text");
  assert.equal(serializeOutline(file), SAMPLE);
});

test("missing ids and header are healed", () => {
  const { file, healed } = parseOutline("- one\n  - two\n- three [done]\n", "/x/todo.lister");
  assert.equal(healed, true);
  assert.equal(file.name, "todo");
  assert.match(file.id, /^[0-9a-z]{8}$/);
  assert.match(file.bullets[0].id, /^[0-9a-z]{8}$/);
  assert.equal(file.bullets[0].children[0].text, "two");
  assert.equal(file.bullets[1].done, "");
  const out = serializeOutline(file);
  assert.match(out, /^# todo \[id:[0-9a-z]{8}\]\n- one \[id:/);
  assert.match(out, /- three \[id:[0-9a-z]{8}\] \[done\]\n$/);
});

test("duplicate ids get reassigned", () => {
  const { file, healed } = parseOutline("# T [id:aaaaaaaa]\n- a [id:c0000001]\n- b [id:c0000001]\n", "/x/t.lister");
  assert.equal(healed, true);
  assert.notEqual(file.bullets[0].id, file.bullets[1].id);
});

test("over-deep indent is clamped", () => {
  const { file, healed } = parseOutline("# T [id:aaaaaaaa]\n- a [id:c0000001]\n      - b [id:c0000002]\n", "/x/t.lister");
  assert.equal(healed, true);
  assert.equal(file.bullets[0].children[0].text, "b");
});

test("blank lines and CRLF are tolerated", () => {
  const { file } = parseOutline("# T [id:aaaaaaaa]\r\n\r\n- a [id:c0000001]\r\n\r\n", "/x/t.lister");
  assert.equal(file.bullets.length, 1);
});

test('remote outline references round-trip as identities without local paths', async () => {
  const { isFolderBullet } = await import('../src/model.ts');
  const source = '# Root [id:aaaaaaaa]\n- Remote [id:bbbbbbbb] [outline:cccccccc]\n';
  const { file, healed } = parseOutline(source, '/local/root.lister');
  assert.equal(file.bullets[0].text, 'Remote');
  assert.equal(file.bullets[0].outline, 'cccccccc');
  assert.equal(file.bullets[0].folder, undefined);
  assert.equal(isFolderBullet(file.bullets[0]), true);
  assert.equal(healed, false);
  assert.equal(serializeOutline(file), source);
});
