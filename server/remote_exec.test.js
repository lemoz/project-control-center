import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteExecError, __test__ } from "./remote_exec.ts";

const { resolveRemotePath, resolveLocalPath, buildEnvPrefix, assertNoAbsoluteDelete } =
  __test__;

function withVmRoot(t, root) {
  const envKey = "CONTROL_CENTER_VM_REPO_ROOT";
  const previous = process.env[envKey];
  process.env[envKey] = root;
  t.after(() => {
    if (previous === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = previous;
    }
  });
}

test("resolveRemotePath rejects traversal segments", (t) => {
  withVmRoot(t, "/home/project/repo");

  assert.throws(
    () => resolveRemotePath("../secrets"),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );

  assert.throws(
    () => resolveRemotePath("repo/../secrets"),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );
});

test("resolveRemotePath blocks absolute paths outside the VM root", (t) => {
  withVmRoot(t, "/home/project/repo");

  assert.throws(
    () => resolveRemotePath("/etc", { allowAbsolute: true }),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );
});

test("resolveRemotePath rejects empty input", (t) => {
  withVmRoot(t, "/home/project/repo");

  assert.throws(
    () => resolveRemotePath("   "),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );
});

test("absolute delete guardrails reject absolute remote paths", (t) => {
  withVmRoot(t, "/home/project/repo");

  const remote = resolveRemotePath("/home/project/repo/app", { allowAbsolute: true });
  assert.throws(
    () => assertNoAbsoluteDelete("Remote upload", true, remote),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );
});

test("resolveLocalPath rejects empty input", () => {
  assert.throws(
    () => resolveLocalPath(" \n "),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_path");
      return true;
    }
  );
});

test("buildEnvPrefix rejects invalid env keys", () => {
  assert.throws(
    () => buildEnvPrefix({ "BAD-KEY": "value" }),
    (err) => {
      assert.ok(err instanceof RemoteExecError);
      assert.equal(err.code, "invalid_env");
      return true;
    }
  );
});
