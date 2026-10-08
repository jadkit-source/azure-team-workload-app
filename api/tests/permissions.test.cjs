
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canDeleteTask,
  canPurgeData,
  canUploadAttachment,
  canDeleteAttachment
} = require("../dist/src/shared/permissions.js");

const now = Date.parse("2026-10-08T12:00:00Z");

const creator = {
  id: "day6-member",
  isAdmin: false
};

const otherMember = {
  id: "day6-member2",
  isAdmin: false
};

const admin = {
  id: "day6-admin",
  isAdmin: true
};

function taskCreated(minutesAgo) {
  return {
    CreatedBy: creator.id,
    OwnerId: creator.id,
    CreatedAt: new Date(
      now - minutesAgo * 60 * 1000
    ).toISOString()
  };
}

test("Creator can delete within one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), creator, now),
    true
  );
});

test("Another member cannot delete creator's task", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), otherMember, now),
    false
  );
});

test("Admin can delete within one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(30), admin, now),
    true
  );
});

test("Creator cannot delete after one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(61), creator, now),
    false
  );
});

test("Admin cannot delete after one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(61), admin, now),
    false
  );
});

test("Deletion is denied at exactly one hour", () => {
  assert.equal(
    canDeleteTask(taskCreated(60), creator, now),
    false
  );
});

test("Another member cannot upload attachments", () => {
  assert.equal(
    canUploadAttachment(taskCreated(30), otherMember),
    false
  );
});

test("Creator can upload attachments", () => {
  assert.equal(
    canUploadAttachment(taskCreated(30), creator),
    true
  );
});

test("Another member cannot delete attachments", () => {
  assert.equal(
    canDeleteAttachment(taskCreated(30), otherMember),
    false
  );
});

test("Only admin can purge data", () => {
  assert.equal(canPurgeData(creator), false);
  assert.equal(canPurgeData(otherMember), false);
  assert.equal(canPurgeData(admin), true);
});
